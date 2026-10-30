'use strict';
// RD CONNECT / Batch 1 period attendance SIDE-EFFECT PLAN (offline only).
// Does not touch a DB, enable a route or send Push. Fails closed and returns
// actions that MUST be atomic for each full-room submission.
// Compare Worker writeAttendance / migration 0041 (per-period configurable
// truancy criterion); NEVER hard-code -10, and never offset good-deed scores.
const {planAttendance}=require('./attendance-write-contract.cjs');
const validStatuses=new Set(['present','absent','late','leave','truancy']);
const fail=(code)=>{const error=Error(code);error.status=400;throw error};
function mapStatus(value){
 if(value==null)return null;
 if(!validStatuses.has(value))fail('invalid_previous_status');
 return value;
}
function normalizeStatusMap(ids,provided,kind){
 if(provided==null)return null; // missing DB snapshot must block planning
 if(!(provided instanceof Map))fail('invalid_status_snapshot');
 const map=new Map();
 for(const studentId of ids){
  if(!provided.has(studentId))fail('incomplete_status_snapshot');
  const value=provided.get(studentId);
  if(kind==='daily'&&value==='truancy')fail('invalid_daily_status');
  map.set(studentId,mapStatus(value));
 }
 return map;
}
function actionTypes(next,previous,daily){
 const actions=['period_attendance_upsert'];
 // Period truancy is stored as 'absent' plus an explicit period_truancy row.
 // The D1 trigger uses a configured criterion, links to one score record and
 // RESTORES that SAME soft-deleted score when truancy is reclassified later.
 if(next==='truancy'){
  actions.push('period_truancy_activate');
  actions.push('truancy_events_activate');
  actions.push('conduct_score_ensure_or_restore_linked_record');
  actions.push('push_truancy_post_commit');
  actions.push('push_student_post_commit');
  actions.push('push_conduct_score_post_commit');
  // Daily absence explains the student's absence; no advisor review duplicate.
  actions.push('ordinary_advisor_review_not_created');
 }else{
  actions.push('period_truancy_deactivate_if_present');
  actions.push('truancy_events_deactivate_if_present');
  if(previous==='truancy')
   actions.push('conduct_score_soft_delete_linked_record');
  if(next==='absent'){
   if(daily==='absent'){
    actions.push('resolve_pending_advisor_alert');
    actions.push('cancel_only_pending_advisor_outbox');
   }else{
    actions.push('create_or_reopen_advisor_review');
    actions.push('queue_or_reopen_pending_advisor_outbox');
   }
  }else{
   actions.push('resolve_active_review');
   actions.push('cancel_only_pending_advisor_outbox');
  }
 }
 return actions;
}
function planPeriodEffects(body,{actor,room,slot,enrolled,today,
 dailyStatuses,previousStatuses}={}){
 const check=planAttendance(body,{actor,room,slot,enrolled,today});
 if(check.kind!=='period'||check.mutation_allowed!==false)
  fail('period_plan_not_blocked');
 const ids=check.entries.map(e=>e.student_id);
 const daily=normalizeStatusMap(ids,dailyStatuses,'daily');
 const previous=normalizeStatusMap(ids,previousStatuses,'period');
 if(!daily||!previous)fail('status_snapshot_required');
 const perStudent=check.entries.map(row=>({
  student_id:row.student_id,
  stored_status:row.status==='truancy'?'absent':row.status,
  previous_status:previous.get(row.student_id),
  daily_status:daily.get(row.student_id),
  steps:actionTypes(row.status,previous.get(row.student_id),daily.get(row.student_id))
 }));
 return {kind:'period',date:check.date,timetable_id:check.timetable_id,
  classroom_id:check.classroom_id,actor_id:check.actor_id,
  per_student:perStudent,
  teaching_note_present:Object.prototype.hasOwnProperty.call(check,'teaching_note'),
  teaching_note:check.teaching_note,
  post_transaction_audit_required:true,
  requires_fresh_locked_snapshot:true,
  requires_configured_truancy_criterion:true,
  requires_truancy_score_and_push_parity:true,
  mutation_allowed:false,
  blocker:'atomic_period_side_effects_not_implemented'};
}
module.exports={validStatuses,mapStatus,normalizeStatusMap,actionTypes,planPeriodEffects};
