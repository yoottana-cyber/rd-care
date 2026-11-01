'use strict';
// Prototype MariaDB LAB ONLY: one-student transactional manual conduct record.
// Never imported by the live SQLite app, no credentials/network/driver here.
// mysql2/promise connection is injected; lab-transaction.cjs verifies DB identity.
// Missing features (recorded-date, bulk, truancy, dispatcher) FAIL CLOSED.
const {runLabTransaction,LAB_CONFIRM,first,rowsOf}=require('./lab-transaction.cjs');
const {manualIncidentPlan}=require('./conduct-contract.cjs');

const validId=v=>Number.isSafeInteger(v)&&v>0;
const validUuid=v=>typeof v==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const one=async(c,sql,args=[])=>first(await c.execute(sql,args));
const affected=r=>Number(r?.[0]?.affectedRows);
const insertId=r=>Number(r?.[0]?.insertId);

function strictInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_incident_input');
 const {studentId,actorId,ruleId,requestId,reason,recordedDate=null}=input;
 if(!validId(studentId)||!validId(actorId)||!validId(ruleId)||!validUuid(requestId))
  throw Error('invalid_incident_identity_or_request');
 if(typeof reason!=='string'||reason.trim().length===0||
   reason!==reason.trim()||reason.length>300)
  throw Error('invalid_incident_reason');
 // Source supports custom history dates. Lab adapter must not silently
 // substitute current date; this capability is deliberately blocked for now.
 if(recordedDate!==null)
  throw Error('selected_history_date_not_implemented_in_lab_adapter');
 return {studentId,actorId,ruleId,requestId:requestId.toLowerCase(),reason};
}

async function recordManualConductLab(connection,input,options={}){
 const values=strictInput(input);
 return runLabTransaction(connection,async c=>{
  const {studentId,actorId,ruleId,requestId,reason}=values;
  const actor=await one(c,
   'SELECT u.id,u.role,u.active, EXISTS(SELECT 1 FROM student_affairs_assignments sa WHERE sa.user_id=u.id) AS student_affairs FROM users u WHERE u.id=?',
   [actorId]);
  if(!actor||Number(actor.active)!==1||
    !['teacher','staff','admin'].includes(actor.role))
   throw Error('lab_actor_not_authorized');

  // Serialize operations for the same student on the same connection/transaction.
  const student=await one(c,
   'SELECT id,classroom_id,active FROM students WHERE id=? FOR UPDATE',
   [studentId]);
  if(!student||Number(student.active)!==1)
   throw Error('lab_student_not_active');

  if(actor.role==='teacher'&&Number(actor.student_affairs)!==1){
   const access=await one(c,
    'SELECT 1 AS ok FROM classrooms c WHERE c.id=? AND (c.advisor_user_id=? OR c.advisor2_user_id=? OR EXISTS(SELECT 1 FROM timetable t WHERE t.classroom_id=c.id AND t.teacher_user_id=? AND t.active=1))',
    [Number(student.classroom_id),actorId,actorId,actorId]);
   if(!access)throw Error('lab_teacher_has_no_student_access');
  }

  const rule=await one(c,
   'SELECT id,category,points,active,deleted_at FROM affairs_behavior_rules WHERE id=? FOR UPDATE',
   [ruleId]);
  if(!rule||Number(rule.active)!==1||rule.deleted_at!=null)
   throw Error('lab_rule_not_active');
  if(await one(c,'SELECT 1 AS managed FROM truancy_score_policy WHERE rule_id=? LIMIT 1',[ruleId]))
   throw Error('lab_managed_truancy_rule_manual_use_forbidden');

  // Do not allow both SQL triggers and backend code to create scores/push.
  const triggers=await one(c,
   "SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('behavior_incidents','behavior_records')",
   []);
  if(!triggers||!Number.isSafeInteger(Number(triggers.n))||Number(triggers.n)!==0)
   throw Error('lab_behavior_triggers_need_explicit_parity_review');

  const receipt=await one(c,
   'SELECT id,student_id,affairs_rule_id,request_id,reason,recorded_by,recorded_school_date,points_applied,warning_no,behavior_record_id FROM behavior_incidents WHERE request_id=? AND student_id=? FOR UPDATE',
   [requestId,studentId]);
  if(receipt){
   if(Number(receipt.student_id)!==studentId||
      Number(receipt.affairs_rule_id)!==ruleId||
      String(receipt.request_id).toLowerCase()!==requestId||
      receipt.reason!==reason||Number(receipt.recorded_by)!==actorId||
      receipt.recorded_school_date!==null)
    throw Error('lab_request_id_payload_conflict');
   return {reused:true,incident_id:Number(receipt.id),
    behavior_record_id:receipt.behavior_record_id==null?null:Number(receipt.behavior_record_id),
    points_applied:Number(receipt.points_applied),warning_no:Number(receipt.warning_no),
    push_event_queued:false};
  }

  const count=await one(c,
   'SELECT COUNT(*) AS n FROM behavior_incidents WHERE student_id=? AND affairs_rule_id=? AND deleted_at IS NULL',
   [studentId,ruleId]);
  if(!count||!Number.isSafeInteger(Number(count.n))||Number(count.n)<0)
   throw Error('lab_invalid_incident_counter');

  const plan=manualIncidentPlan({
   studentId,ruleId,category:rule.category,rulePoints:Number(rule.points),
   previousActiveCount:Number(count.n),requestId,actor:{
    role:actor.role,student_affairs:Number(actor.student_affairs)
   }
  });
  if(plan.action!=='create_in_one_transaction')
   throw Error('lab_unexpected_conduct_plan');
  const created=await c.execute(
   'INSERT INTO behavior_incidents (student_id,affairs_rule_id,affairs_category,rule_points,reason,recorded_by,points_applied,warning_no,request_id,recorded_school_date) VALUES (?,?,?,?,?,?,?,?,?,NULL)',
   [studentId,ruleId,rule.category,Number(rule.points),reason,actorId,
    plan.points_applied,plan.warning_no,requestId]
  );
  const incidentId=insertId(created);
  if(affected(created)!==1||!validId(incidentId))
   throw Error('lab_incident_insert_failed');
  let scoreId=null;
  if(plan.insert_score){
   // Inherit EXACT incident creation timestamp, as SQLite trigger does.
   const score=await c.execute(
    'INSERT INTO behavior_records (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category,created_at) SELECT student_id,points_applied,reason,recorded_by,affairs_rule_id,affairs_category,created_at FROM behavior_incidents WHERE id=?',
    [incidentId]
   );
   scoreId=insertId(score);
   if(affected(score)!==1||!validId(scoreId))
    throw Error('lab_behavior_score_insert_failed');
   const link=await c.execute(
    'UPDATE behavior_incidents SET behavior_record_id=? WHERE id=? AND behavior_record_id IS NULL',
    [scoreId,incidentId]
   );
   if(affected(link)!==1)throw Error('lab_behavior_score_link_failed');
  }
  const audit=await c.execute(
   'INSERT INTO audit_logs (actor_id,action,entity_type,entity_id) VALUES (?,?,?,?)',
   [actorId,plan.points_applied===0?'affairs_conduct_warned':'affairs_behavior_recorded',
    'behavior_incidents',String(incidentId)]
  );
  if(affected(audit)!==1)throw Error('lab_incident_audit_failed');

  if(plan.enqueue_push){
   const queued=await c.execute(
    'INSERT INTO behavior_score_push_events (incident_id) VALUES (?)',[incidentId]
   );
   if(affected(queued)!==1)throw Error('lab_outbox_insert_failed');
  }
  // No calls to Push service; dispatch policy and retries remain unimplemented.
  return {
   reused:false,incident_id:incidentId,behavior_record_id:scoreId,
   points_applied:plan.points_applied,warning_no:plan.warning_no,
   push_event_queued:plan.enqueue_push,dispatch_performed:false
  };
 },{confirm:options.confirm});
}

module.exports={strictInput,recordManualConductLab,LAB_CONFIRM};
