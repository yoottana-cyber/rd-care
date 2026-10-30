'use strict';
// RD CONNECT — disposable MariaDB LAB ONLY. Atomic daily check-in prototype.
// This file is NEVER wired into Passenger app.js/http-handler.cjs.
// Requires the isolated ratsadaa_trgtest DB and a caller-owned transaction.
// The caller MUST begin a transaction and ALWAYS ROLLBACK after synthetic tests.
// Actual school writes, Push sending, and Period/truancy writes remain BLOCKED.
const {planAttendance}=require('./attendance-write-contract.cjs');
const {LAB_DATABASE}=require('../scripts/check-trigger-lab.cjs');

const OPT_IN='RUN_LAB_DAILY_ATTENDANCE_ROLLBACK_B1';
const fail=(status,code)=>{const e=Error(code);e.status=status;throw e};
const ROOM_SQL='SELECT id,advisor_user_id,advisor2_user_id FROM classrooms WHERE id=? LIMIT 1 FOR UPDATE';
const ROSTER_SQL=`SELECT s.id FROM students s
 JOIN student_enrollments h ON h.student_id=s.id
 WHERE h.classroom_id=? AND h.start_date<=?
  AND (h.end_date IS NULL OR h.end_date>?) AND s.active=1
 ORDER BY h.roll_no FOR UPDATE`;
const UPSERT=`INSERT INTO attendance_daily(student_id,school_date,status,recorded_by)
 VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE
 status=VALUES(status),recorded_by=VALUES(recorded_by),
 updated_at=CURRENT_TIMESTAMP`;
const CANCEL_OUTBOX=`UPDATE notification_outbox o
 JOIN attendance_alerts a ON a.id=o.alert_id
 SET o.state='cancelled',o.updated_at=CURRENT_TIMESTAMP
 WHERE a.student_id=? AND a.school_date=? AND a.state='pending_review'
  AND o.state='pending'`;
const RESOLVE_ALERT=`UPDATE attendance_alerts SET state='resolved',
 reviewed_by=NULL,reviewed_at=NULL
 WHERE student_id=? AND school_date=? AND state='pending_review'`;
const AUDIT=`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 VALUES(?,'attendance_saved','daily',?)`;
function assertLabFlag(env){
 if(env?.RD_TRIGGER_LAB_ALLOW_ATTENDANCE!==OPT_IN)
  throw Error('lab_daily_attendance_opt_in_required');
 if(env.RD_DB_NAME===LAB_DATABASE||env.RD_TRIGGER_LAB_DB_NAME!==LAB_DATABASE)
  throw Error('lab_daily_database_identity_required');
}
async function assertConnection(conn){
 const [[db]]=await conn.execute('SELECT DATABASE() AS db');
 if(db?.db!==LAB_DATABASE)throw Error('lab_daily_wrong_database');
}
async function applyDailyInOpenTransaction(conn,body,{
 actor,env,now=new Date(),onStep
}={}){
 // IMPORTANT: Must be run AFTER the caller begins its single transaction.
 // SELECT ... FOR UPDATE below is meaningful only in an open transaction.
 assertLabFlag(env);
 await assertConnection(conn);
 if(!body||body.kind!=='daily')fail(400,'invalid_kind');
 const roomId=body.classroom_id;
 if(!Number.isSafeInteger(roomId)||roomId<1)fail(400,'invalid_room');
 const [rooms]=await conn.execute(ROOM_SQL,[roomId]);
 const room=rooms[0];if(!room)fail(404,'not_found');
 const [rows]=await conn.execute(ROSTER_SQL,[roomId,body.date,body.date]);
 const enrolled=rows.map(r=>Number(r.id));
 const plan=planAttendance(body,{actor,room,enrolled,
  today:require('./attendance-write-contract.cjs').bangkokToday(now)});
 if(plan.mutation_allowed!==false||plan.kind!=='daily')
  throw Error('lab_daily_unexpected_write_contract');
 let upserts=0,absenceEvents=0;
 for(const item of plan.entries){
  await conn.execute(UPSERT,[item.student_id,plan.date,item.status,plan.actor_id]);
  upserts++;
  if(onStep)await onStep('daily_upsert',item);
  if(item.status==='absent'){
   // Must cancel only still-pending notifications, not delivered ones.
   await conn.execute(CANCEL_OUTBOX,[item.student_id,plan.date]);
   await conn.execute(RESOLVE_ALERT,[item.student_id,plan.date]);
   absenceEvents++;
  }
 }
 await conn.execute(AUDIT,[plan.actor_id,plan.date+':'+plan.classroom_id+':0']);
 if(onStep)await onStep('audit');
 // No COMMIT/ROLLBACK here. The single outer transaction owns both.
 return {synthetic:true,kind:'daily',rows:upserts,
  absence_followups_resolved:absenceEvents,
  push_delivered:false,requires_rollback:true};
}
module.exports={OPT_IN,ROOM_SQL,ROSTER_SQL,UPSERT,CANCEL_OUTBOX,RESOLVE_ALERT,AUDIT,
 assertLabFlag,assertConnection,applyDailyInOpenTransaction};
