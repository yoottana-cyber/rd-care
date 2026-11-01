'use strict';
// RD CONNECT MariaDB migration laboratory: side-effect-free domain contract.
// Deliberately NO database connection, driver, SQL execution, filesystem or network.
// This code is NOT wired into the live Node/SQLite application.
// Any future MariaDB adapter must provide real transactions, row locks,
// permission checks and idempotency before this contract may be used for writes.

const CATEGORIES=Object.freeze(['good','minor','moderate','serious','very_serious']);
const WARNING_ALLOWANCE=Object.freeze({minor:2,moderate:1,good:0,serious:0,very_serious:0});
const isPositiveInt=v=>Number.isSafeInteger(v)&&v>0;
const nonnegative=v=>Number.isSafeInteger(v)&&v>=0;

function ruleOutcome({category,rulePoints,previousActiveCount}){
 if(!CATEGORIES.includes(category))throw Error('unrecognized_behavior_category');
 if(!Number.isSafeInteger(rulePoints)||rulePoints===0)throw Error('invalid_rule_points');
 if(!nonnegative(previousActiveCount))throw Error('invalid_active_incident_count');
 if((category==='good'&&rulePoints<=0)||(category!=='good'&&rulePoints>=0))
  throw Error('rule_sign_category_mismatch');
 const allowance=WARNING_ALLOWANCE[category];
 const warning=category!=='good'&&previousActiveCount<allowance;
 return Object.freeze({
  points_applied:warning?0:rulePoints,
  warning_no:warning?previousActiveCount+1:0,
  incident_category:category,
  next_active_count:previousActiveCount+1
 });
}

function assertAuthorizedRecorder({role,student_affairs},category){
 if(!CATEGORIES.includes(category))throw Error('unrecognized_behavior_category');
 if(['serious','very_serious'].includes(category) &&
   !(role==='admin'||(role==='teacher'&&Number(student_affairs)===1)))
  throw Error('serious_conduct_requires_student_affairs');
}

function incidentEventKind({category,points_applied,warning_no,deleted_at=null}){
 if(deleted_at!=null)return null;
 if(!CATEGORIES.includes(category)||!Number.isSafeInteger(points_applied)||
   !nonnegative(warning_no))throw Error('invalid_incident');
 if(points_applied<0)return 'deduction';
 if(points_applied===0&&warning_no>0&&['minor','moderate'].includes(category))
  return 'warning';
 return null;
}

// Idempotency is enforced by MariaDB UNIQUE(request_id, student_id).
// This is only a stable comparison and plan, not an actual DB lookup or insert.
function manualIncidentPlan({studentId,ruleId,category,rulePoints,
  previousActiveCount,requestId,existingReceipt=null,actor}){
 if(!isPositiveInt(studentId)||!isPositiveInt(ruleId))throw Error('invalid_record_identity');
 if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
  throw Error('invalid_request_id');
 assertAuthorizedRecorder(actor||{},category);
 if(existingReceipt){
  if(Number(existingReceipt.student_id)!==studentId||
     Number(existingReceipt.affairs_rule_id)!==ruleId||
     String(existingReceipt.request_id||'').toLowerCase()!==requestId.toLowerCase())
   throw Error('request_id_conflict');
  return Object.freeze({
   action:'return_existing_receipt',no_write:true,
   insert_incident:false,insert_score:false,enqueue_push:false,
   receipt_id:existingReceipt.id
  });
 }
 const outcome=ruleOutcome({category,rulePoints,previousActiveCount});
 return Object.freeze({
  action:'create_in_one_transaction',no_write:false,
  lock:'students.id FOR UPDATE before rule/history count',
  verify:'check rule, active state, recorder permissions and request id inside lock',
  unique_guard:'behavior_incidents(request_id,student_id)',
  insert_incident:true,
  insert_score:outcome.points_applied!==0,
  update_incident_score_link:outcome.points_applied!==0,
  insert_audit:true,
  enqueue_push:incidentEventKind({
   category,points_applied:outcome.points_applied,
   warning_no:outcome.warning_no
  })!==null,
  event_kind:incidentEventKind({
   category,points_applied:outcome.points_applied,
   warning_no:outcome.warning_no
  }),
  dispatch_push_only_after_commit:true,
  ...outcome
 });
}

// Truancy is per (student,timetable,school_date), not daily absence.
// It must keep the existing incident and score IDs when a correction is undone.
function truancyTransitionPlan({operation,studentId,timetableId,schoolDate,
  existingIncident=null,previousActiveCount=0,category='moderate',
  rulePoints=-10}){
 if(!['mark_truancy','unmark_truancy'].includes(operation))
  throw Error('unrecognized_truancy_operation');
 if(!isPositiveInt(studentId)||!isPositiveInt(timetableId)||
   typeof schoolDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(schoolDate))
  throw Error('invalid_truancy_identity');
 if(operation==='unmark_truancy'){
  return Object.freeze({
   action:existingIncident?'soft_delete_existing_incident_and_score':'noop',
   preserve_history:true,create_new_incident:false,create_new_score:false,
   no_new_push:true,write_audit:Boolean(existingIncident),
   atomic_with_period_attendance:true
  });
 }
 if(existingIncident){
  return Object.freeze({
   action:existingIncident.deleted_at?'reactivate_existing_incident_and_score':'noop',
   preserve_incident_id:true,preserve_score_id:true,
   create_new_incident:false,create_new_score:false,
   no_new_push:true,atomic_with_period_attendance:true
  });
 }
 const outcome=ruleOutcome({category,rulePoints,previousActiveCount});
 return Object.freeze({
  action:'create_truancy_incident',create_new_incident:true,
  create_new_score:outcome.points_applied!==0,
  require_unique_lesson_key:'(student_id,source_timetable_id,source_school_date)',
  link_score_when_present:outcome.points_applied!==0,
  audit:true,atomic_with_period_attendance:true,
  dispatch_push_only_after_commit:true,
  ...outcome
 });
}

const MIGRATION_GATE=Object.freeze({
 production_import_authorized:false,
 live_cutover_authorized:false,
 mariadb_adapter_implemented:false,
 transaction_adapter_implemented:false,
 concurrency_verified:false,
 trigger_parity_verified:false,
 check_semantics_verified:false
});

module.exports={
 CATEGORIES,WARNING_ALLOWANCE,ruleOutcome,assertAuthorizedRecorder,
 incidentEventKind,manualIncidentPlan,truancyTransitionPlan,MIGRATION_GATE
};
