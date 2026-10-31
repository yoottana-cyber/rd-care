'use strict';
// RD CONNECT: synthetic-only MariaDB period attendance / truancy SQL prototype.
// Isolated ratsadaa_trgtest only; NOT imported by the public HTTP handler.
// Caller MUST begin a transaction and always ROLLBACK. This source never COMMITs.
// School business-rule concurrency, live scoring and Push are NOT released.
const {planAttendance,requireWriteDate,bangkokToday,requireStaff,allowedPeriod}
 =require('./attendance-write-contract.cjs');
const {LAB_DATABASE}=require('../scripts/check-trigger-lab.cjs');
const OPT_IN='RUN_LAB_PERIOD_TRUANCY_ROLLBACK_B1';
function need(v,k){if(!v)throw Error('lab_period_'+k)}
const ROOM='SELECT id,advisor_user_id,advisor2_user_id FROM classrooms WHERE id=? LIMIT 1 FOR UPDATE';
const SLOT='SELECT id,classroom_id,teacher_user_id,day_of_week,period,end_period,active FROM timetable WHERE id=? LIMIT 1 FOR UPDATE';
const ROSTER=`SELECT s.id FROM students s JOIN student_enrollments h ON h.student_id=s.id
 WHERE h.classroom_id=? AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)
  AND s.active=1 ORDER BY h.roll_no FOR UPDATE`;
const POLICY=`SELECT r.id,r.points,r.category FROM truancy_score_policy p
 JOIN affairs_behavior_rules r ON r.id=p.rule_id
 WHERE p.id=1 AND r.active=1 LIMIT 1 FOR UPDATE`;
const DAILY='SELECT status FROM attendance_daily WHERE student_id=? AND school_date=? LIMIT 1 FOR UPDATE';
const OLD=`SELECT p.status,CASE WHEN tr.student_id IS NOT NULL THEN 1 ELSE 0 END AS truancy
 FROM attendance_period p LEFT JOIN period_truancy tr
 ON tr.student_id=p.student_id AND tr.timetable_id=p.timetable_id AND tr.school_date=p.school_date
 WHERE p.student_id=? AND p.timetable_id=? AND p.school_date=? LIMIT 1 FOR UPDATE`;
const UPSERT=`INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)
 VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE
 status=VALUES(status),recorded_by=VALUES(recorded_by),updated_at=CURRENT_TIMESTAMP`;
const TRUANCY_UPSERT=`INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
 VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE recorded_by=VALUES(recorded_by),
 updated_at=CURRENT_TIMESTAMP`;
const EVENT_UPSERT=`INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by)
 VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE
 generation=IF(active=0,generation+1,generation),active=1,
 recorded_by=VALUES(recorded_by),updated_at=CURRENT_TIMESTAMP`;
const LINK=`SELECT l.behavior_record_id,b.deleted_at FROM truancy_behavior_links l
 JOIN behavior_records b ON b.id=l.behavior_record_id
 WHERE l.student_id=? AND l.timetable_id=? AND l.school_date=? LIMIT 1 FOR UPDATE`;
const INSERT_SCORE=`INSERT INTO behavior_records
 (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
 VALUES(?,?,?,?,?,?)`;
const LINK_SCORE=`INSERT INTO truancy_behavior_links
 (student_id,timetable_id,school_date,behavior_record_id) VALUES(?,?,?,?)`;
const RESTORE_SCORE=`UPDATE behavior_records SET deleted_at=NULL,deleted_by=NULL,recorded_by=?
 WHERE id=? AND deleted_at IS NOT NULL`;
const REMOVE_TRUANCY=`DELETE FROM period_truancy WHERE student_id=? AND timetable_id=? AND school_date=?`;
const DEACTIVATE_EVENT=`UPDATE truancy_events SET active=0,updated_at=CURRENT_TIMESTAMP
 WHERE student_id=? AND timetable_id=? AND school_date=? AND active=1`;
const SOFT_DELETE_SCORE=`UPDATE behavior_records b JOIN truancy_behavior_links l ON l.behavior_record_id=b.id
 SET b.deleted_at=CURRENT_TIMESTAMP,b.deleted_by=NULL
 WHERE l.student_id=? AND l.timetable_id=? AND l.school_date=? AND b.deleted_at IS NULL`;
const ALERT_UPSERT=`INSERT INTO attendance_alerts(student_id,timetable_id,school_date,state)
 VALUES(?,?,?,'pending_review') ON DUPLICATE KEY UPDATE
 state=IF(state='resolved','pending_review',state)`;
const QUEUE_UPSERT=`INSERT INTO notification_outbox(alert_id,event_type,audience,state)
 VALUES(?,'attendance_review_requested','advisor','pending')
 ON DUPLICATE KEY UPDATE state=IF(state='cancelled','pending',state),
 updated_at=CURRENT_TIMESTAMP`;
const ALERT_LOOKUP=`SELECT id,state FROM attendance_alerts
 WHERE student_id=? AND timetable_id=? AND school_date=? LIMIT 1 FOR UPDATE`;
const RESOLVE_ALERT=`UPDATE attendance_alerts SET state='resolved',
 reviewed_by=NULL,reviewed_at=NULL
 WHERE student_id=? AND timetable_id=? AND school_date=? AND state='pending_review'`;
const CANCEL_OUTBOX=`UPDATE notification_outbox o JOIN attendance_alerts a ON a.id=o.alert_id
 SET o.state='cancelled',o.updated_at=CURRENT_TIMESTAMP
 WHERE a.student_id=? AND a.timetable_id=? AND a.school_date=? AND o.state='pending'`;
const NOTE_UPSERT=`INSERT INTO period_teaching_logs(timetable_id,school_date,note,recorded_by)
 VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE note=VALUES(note),
 recorded_by=VALUES(recorded_by),updated_at=CURRENT_TIMESTAMP`;
const NOTE_CLEAR='DELETE FROM period_teaching_logs WHERE timetable_id=? AND school_date=?';
const AUDIT=`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 VALUES(?,'attendance_saved','period',?)`;
const SCORE_AUDIT=`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 VALUES(?,?, 'behavior_records',?)`;

function assertLab(env){
 if(env?.RD_TRIGGER_LAB_ALLOW_PERIOD!==OPT_IN)
  throw Error('lab_period_opt_in_required');
 if(env.RD_DB_NAME===LAB_DATABASE||env.RD_TRIGGER_LAB_DB_NAME!==LAB_DATABASE)
  throw Error('lab_period_wrong_environment');
}
async function assertLabConnection(conn){
 const [[row]]=await conn.execute('SELECT DATABASE() AS db');
 need(row?.db===LAB_DATABASE,'wrong_database');
}
function scoreReason(date,slot){
 return 'หนีเรียนในแต่ละคาบเรียน วันที่ '+date+' คาบ '+
  slot.period+(Number(slot.end_period)>Number(slot.period)?'-'+slot.end_period:'');
}
async function applyPeriodInOpenTransaction(conn,body,{
 actor,env,now=new Date(),onStep
}={}){
 // Every caller MUST hold one open transaction and roll it back even on success.
 assertLab(env);
 requireStaff(actor);
 need(body?.kind==='period','invalid_kind');
 const today=bangkokToday(now);
 requireWriteDate(body.date,today);
 const roomId=body.classroom_id,slotId=body.timetable_id;
 need(Number.isSafeInteger(roomId)&&roomId>0&&Number.isSafeInteger(slotId)&&slotId>0,'invalid_ids');
 await assertLabConnection(conn);
 const [[room]]=await conn.execute(ROOM,[roomId]);
 need(!!room,'unknown_room');
 const [[slot]]=await conn.execute(SLOT,[slotId]);
 allowedPeriod(actor,room,slot,body.date);
 const [students]=await conn.execute(ROSTER,[roomId,body.date,body.date]);
 const plan=planAttendance(body,{actor,room,slot,
  enrolled:students.map(x=>Number(x.id)),today});
 need(plan.kind==='period'&&plan.mutation_allowed===false,'unsafe_write_contract');
 // Score rule is REQUIRED before truancy; never guess -10 or fallback silently.
 let rule=null;
 if(plan.truancy_count>0){
  const [[found]]=await conn.execute(POLICY);
  need(found&&Number.isSafeInteger(Number(found.id))&&Number(found.points)<0&&
   ['minor','moderate','serious','very_serious'].includes(found.category),
   'misconduct_policy_missing_or_invalid');
  rule=found;
 }
 let scored=0,reversed=0,advisory=0;
 for(const student of plan.entries){
  const key=[student.student_id,slot.id,plan.date];
  const [[old]]=await conn.execute(OLD,key);
  const previousTruancy=Number(old?.truancy||0)===1;
  const [[daily]]=await conn.execute(DAILY,[student.student_id,plan.date]);
  const stored=student.status==='truancy'?'absent':student.status;
  await conn.execute(UPSERT,[...key.slice(0,1),slot.id,plan.date,stored,plan.actor_id]);
  if(onStep)await onStep('attendance_upsert',student);
  if(student.status==='truancy'){
   // Standard absence review must not be reopened for classified truancy.
   await conn.execute(TRUANCY_UPSERT,[...key,plan.actor_id]);
   await conn.execute(EVENT_UPSERT,[...key,plan.actor_id]);
   const [[linked]]=await conn.execute(LINK,key);
   let scoreId=linked?.behavior_record_id??null;
   if(linked){
    await conn.execute(RESTORE_SCORE,[plan.actor_id,linked.behavior_record_id]);
   }else{
    const [saved]=await conn.execute(INSERT_SCORE,[student.student_id,
     Number(rule.points),scoreReason(plan.date,slot),plan.actor_id,
     Number(rule.id),rule.category]);
    need(Number(saved?.insertId)>0,'score_record_insert_failed');
    await conn.execute(LINK_SCORE,[...key,saved.insertId]);
    scoreId=saved.insertId;
    scored++;
   }
   if(!previousTruancy)
    await conn.execute(SCORE_AUDIT,[plan.actor_id,'truancy_auto_score_applied',
     String(scoreId)]);
   await conn.execute(RESOLVE_ALERT,key);
   await conn.execute(CANCEL_OUTBOX,key);
  }else{
   if(previousTruancy){
    await conn.execute(REMOVE_TRUANCY,key);
    await conn.execute(DEACTIVATE_EVENT,key);
    await conn.execute(SOFT_DELETE_SCORE,key);
    const [[linked]]=await conn.execute(LINK,key);
    await conn.execute(SCORE_AUDIT,[null,'truancy_auto_score_reversed',
     String(linked?.behavior_record_id||0)]);
    reversed++;
   }else{
    // Retries / repeat submissions never create a second score record.
    await conn.execute(DEACTIVATE_EVENT,key);
   }
   if(student.status==='absent'&&daily?.status!=='absent'){
    await conn.execute(ALERT_UPSERT,key);
    const [[alert]]=await conn.execute(ALERT_LOOKUP,key);
    need(Number(alert?.id)>0,'advisor_alert_missing');
    if(alert.state==='pending_review'){
     await conn.execute(QUEUE_UPSERT,[alert.id]);advisory++;
    }
   }else{
    await conn.execute(RESOLVE_ALERT,key);
    await conn.execute(CANCEL_OUTBOX,key);
   }
  }
 }
 if(Object.prototype.hasOwnProperty.call(plan,'teaching_note')){
  if(plan.teaching_note)await conn.execute(NOTE_UPSERT,
   [slot.id,plan.date,plan.teaching_note,plan.actor_id]);
  else await conn.execute(NOTE_CLEAR,[slot.id,plan.date]);
 }
 await conn.execute(AUDIT,[plan.actor_id,plan.date+':'+room.id+':'+slot.id]);
 if(onStep)await onStep('audit');
 return {kind:'period',synthetic:true,rows:plan.entries.length,
  score_created:scored,score_reversed:reversed,
  advisor_review_queued:advisory,
  push_sent:false,requires_rollback:true,production_safe:false};
}
module.exports={OPT_IN,assertLab,assertLabConnection,scoreReason,
 applyPeriodInOpenTransaction,ROOM,SLOT,ROSTER,POLICY,DAILY,OLD,UPSERT,
 TRUANCY_UPSERT,EVENT_UPSERT,LINK,INSERT_SCORE,LINK_SCORE,RESTORE_SCORE,
 REMOVE_TRUANCY,DEACTIVATE_EVENT,SOFT_DELETE_SCORE,ALERT_UPSERT,QUEUE_UPSERT,
 ALERT_LOOKUP,RESOLVE_ALERT,CANCEL_OUTBOX,NOTE_UPSERT,NOTE_CLEAR,AUDIT,SCORE_AUDIT};
