'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ruleOutcome,assertAuthorizedRecorder,incidentEventKind,
 manualIncidentPlan,truancyTransitionPlan,MIGRATION_GATE}=require('../mariadb-parity/conduct-contract.cjs');

const id='b8aefc13-fb3a-49ae-b9a0-e5e81a27d28d';
const actor={role:'teacher',student_affairs:1};
const plan=(more={})=>manualIncidentPlan({
 studentId:11,ruleId:7,category:'moderate',rulePoints:-10,
 previousActiveCount:0,requestId:id,actor,...more
});

test('first two minor conduct reports warn, third deducts',()=>{
 assert.deepEqual([0,1,2,3].map(previousActiveCount=>
  ruleOutcome({category:'minor',rulePoints:-5,previousActiveCount})
   .points_applied),[0,0,-5,-5]);
 assert.deepEqual([0,1,2].map(previousActiveCount=>
  ruleOutcome({category:'minor',rulePoints:-5,previousActiveCount})
   .warning_no),[1,2,0]);
});

test('moderate first warning, second deducts; merits never cancel misconduct',()=>{
 assert.deepEqual([0,1].map(previousActiveCount=>
  ruleOutcome({category:'moderate',rulePoints:-10,previousActiveCount})
   .points_applied),[0,-10]);
 assert.equal(ruleOutcome({category:'good',rulePoints:10,previousActiveCount:5})
  .points_applied,10);
 assert.throws(()=>ruleOutcome({category:'good',rulePoints:-5,previousActiveCount:0}),
  /rule_sign_category_mismatch/);
});

test('serious/very serious recorders require student affairs role',()=>{
 for(const category of ['serious','very_serious']){
  assert.throws(()=>assertAuthorizedRecorder({role:'teacher',student_affairs:0},category),
   /serious_conduct_requires_student_affairs/);
  assert.throws(()=>assertAuthorizedRecorder({role:'staff',student_affairs:1},category),
   /serious_conduct_requires_student_affairs/);
  assert.doesNotThrow(()=>assertAuthorizedRecorder(actor,category));
  assert.doesNotThrow(()=>assertAuthorizedRecorder({role:'admin'},category));
  assert.equal(ruleOutcome({category,rulePoints:-20,previousActiveCount:0}).points_applied,-20);
 }
});

test('score and warning notifications are event intents, never immediate delivery',()=>{
 assert.equal(incidentEventKind({category:'minor',points_applied:0,warning_no:1}),'warning');
 assert.equal(incidentEventKind({category:'moderate',points_applied:-10,warning_no:0}),'deduction');
 assert.equal(incidentEventKind({category:'good',points_applied:10,warning_no:0}),null);
 assert.equal(incidentEventKind({category:'minor',points_applied:0,warning_no:1,deleted_at:'2026-01-01'}),null);
 const first=plan();
 assert.equal(first.action,'create_in_one_transaction');
 assert.equal(first.insert_score,false);
 assert.equal(first.insert_incident,true);
 assert.equal(first.enqueue_push,true);
 assert.equal(first.event_kind,'warning');
 assert.equal(first.dispatch_push_only_after_commit,true);
 const second=plan({previousActiveCount:1});
 assert.equal(second.insert_score,true);
 assert.equal(second.event_kind,'deduction');
 assert.equal(second.update_incident_score_link,true);
});

test('request replay returns original receipt without any new side effects',()=>{
 const original=plan({existingReceipt:{
  id:42,request_id:id,student_id:11,affairs_rule_id:7
 }});
 assert.equal(original.action,'return_existing_receipt');
 assert.equal(original.no_write,true);
 assert.equal(original.insert_incident,false);
 assert.equal(original.insert_score,false);
 assert.equal(original.enqueue_push,false);
 assert.equal(original.receipt_id,42);
 assert.throws(()=>plan({existingReceipt:{
  id:42,request_id:id,student_id:13,affairs_rule_id:7
 }}),/request_id_conflict/);
});

test('period truancy preserves history on undo/redone and never scores absence',()=>{
 const initial=truancyTransitionPlan({
  operation:'mark_truancy',studentId:11,timetableId:9,
  schoolDate:'2026-11-01',previousActiveCount:0
 });
 assert.equal(initial.action,'create_truancy_incident');
 assert.equal(initial.points_applied,0);
 assert.equal(initial.warning_no,1);
 assert.equal(initial.create_new_score,false);
 assert.equal(initial.atomic_with_period_attendance,true);
 const existing={id:33,behavior_record_id:45,deleted_at:'2026-11-01'};
 const redo=truancyTransitionPlan({
  operation:'mark_truancy',studentId:11,timetableId:9,
  schoolDate:'2026-11-01',existingIncident:existing
 });
 assert.equal(redo.action,'reactivate_existing_incident_and_score');
 assert.equal(redo.create_new_score,false);
 assert.equal(redo.no_new_push,true);
 assert.equal(redo.preserve_score_id,true);
 const undo=truancyTransitionPlan({
  operation:'unmark_truancy',studentId:11,timetableId:9,
  schoolDate:'2026-11-01',existingIncident:existing
 });
 assert.equal(undo.action,'soft_delete_existing_incident_and_score');
 assert.equal(undo.create_new_score,false);
 assert.equal(undo.preserve_history,true);
 assert.throws(()=>truancyTransitionPlan({
  operation:'mark_absence',studentId:11,timetableId:9,schoolDate:'2026-11-01'
 }),/unrecognized_truancy_operation/);
});

test('invalid identity/count/request are rejected; lab parity is explicitly NO GO',()=>{
 assert.throws(()=>plan({studentId:0}),/invalid_record_identity/);
 assert.throws(()=>plan({requestId:'x'}),/invalid_request_id/);
 assert.throws(()=>plan({previousActiveCount:-1}),/invalid_active_incident_count/);
 assert.equal(MIGRATION_GATE.production_import_authorized,false);
 assert.equal(MIGRATION_GATE.live_cutover_authorized,false);
 assert.equal(MIGRATION_GATE.mariadb_adapter_implemented,false);
 assert.equal(MIGRATION_GATE.transaction_adapter_implemented,false);
 assert.equal(MIGRATION_GATE.trigger_parity_verified,false);
});
