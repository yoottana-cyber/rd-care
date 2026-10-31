'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planTruancyPush,compositeKey,retryState,eventEligible}
 =require('../src/truancy-push-offline-plan.cjs');
const NOW=Date.parse('2026-10-30T09:00:00Z');
const event={
 id:5001,generation:1,student_id:51,school_date:'2026-10-30',
 bangkok_today:'2026-10-30',updated_at_ms:NOW-60000,committed:true,
 active:true,period_truancy_active:true,period_status:'absent',
 advisor_user_id:10,advisor2_user_id:11
};
const staff={type:'advisor',subscription_id:101,user_id:10,active:true};
const secondary={...staff,subscription_id:102,user_id:11};
const guardian={type:'guardian',subscription_id:201,guardian_account_id:92,
 verified_student_ids:[51],active:true,account_active:true,must_change_password:false};
const student={type:'student',subscription_id:301,student_account_id:83,
 student_id:51,active:true,account_active:true,must_change_password:false};
const plan=(overrides={})=>planTruancyPush({event,
 devices:[staff,secondary,guardian,student],senderReady:true,now:NOW,
 ...overrides});
test('only verified recipients of active committed incident are eligible; outputs contain no keys or names',()=>{
 const x=plan();
 assert.equal(x.ready,true);
 assert.equal(x.eligible.length,4);
 assert.deepEqual(x.eligible.map(d=>d.type),['advisor','advisor','guardian','student']);
 assert.equal(x.not_sent,true);
 assert.doesNotMatch(JSON.stringify(x),/endpoint|p256dh|auth|secret|password|student_id/);
});
test('retracted, pending, invalid and stale truancy never goes to Push queue',()=>{
 for(const override of [
  {active:false},{period_truancy_active:false},{period_status:'present'},
  {school_date:'2026-10-15'}, {school_date:'2026-10-31'},
  {updated_at_ms:NOW-25*3600000}
 ]){
  assert.equal(plan({event:{...event,...override}}).ready,false);
 }
 assert.throws(()=>plan({event:{...event,committed:false}}),
  /push_plan_event_must_be_committed/);
});
test('deduplicate advisors, require true guardian link and matching student identity',()=>{
 const x=plan({devices:[staff,staff,guardian,{...guardian,subscription_id:202,
  verified_student_ids:[999]},student,{...student,subscription_id:302,student_id:999},
  {...staff,subscription_id:103,user_id:777}]});
 assert.equal(x.eligible.length,3);
 assert.equal(x.suppressed,4);
 assert.equal(x.checked,4);
});
test('disabled admin preferences independently block advisor guardian or student delivery',()=>{
 const x=plan({preferences:{truancy_advisor:false,truancy_guardian:false}});
 assert.deepEqual(x.eligible.map(d=>d.type),['student']);
 const y=plan({preferences:{truancy_advisor:false,
  truancy_guardian:false,truancy_student:false}});
 assert.equal(y.ready,false);
 assert.equal(y.reason,'no_eligible_subscribers');
 assert.throws(()=>plan({preferences:{truancy_advisor:'false'}}),
  /push_plan_invalid_preference/);
});
test('missing VAPID and no subscribers are explicitly NOT delivered',()=>{
 assert.equal(plan({senderReady:false}).reason,'missing_vapid');
 assert.equal(plan({devices:[]}).reason,'no_eligible_subscribers');
});
test('one event-generation-subscription is delivered once and attempts stop at three',()=>{
 const delivered=new Map([[compositeKey(event,staff),{
  state:'delivered',attempts:1,updated_at_ms:NOW-900000
 }]]);
 const x=plan({devices:[staff],deliveries:delivered});
 assert.equal(x.eligible.length,0);
 const exhaustion=new Map([[compositeKey(event,staff),{
  state:'failed',attempts:3,updated_at_ms:NOW-900000
 }]]);
 assert.equal(plan({devices:[staff],deliveries:exhaustion}).eligible.length,0);
 assert.equal(plan({devices:[staff],deliveries:new Map()}).eligible.length,1);
});
test('sending and recently-failed claims respect cooldown; stale retry may continue',()=>{
 for(const state of ['sending','failed']){
  const key=compositeKey(event,staff);
  const recent=new Map([[key,{state,attempts:1,updated_at_ms:NOW-30000}]]);
  assert.equal(plan({devices:[staff],deliveries:recent}).ready,false);
  const old=new Map([[key,{state,attempts:1,updated_at_ms:NOW-200000}]]);
  assert.equal(plan({devices:[staff],deliveries:old}).ready,true);
 }
 assert.equal(retryState({state:'pending',attempts:0},NOW).eligible,true);
});
test('corrected then newly reactivated incident uses new generation key',()=>{
 const old=new Map([[compositeKey(event,staff),{
  state:'delivered',attempts:1,updated_at_ms:NOW-1000
 }]]);
 const first=plan({devices:[staff],deliveries:old});
 assert.equal(first.ready,false);
 const newEvent={...event,generation:2};
 const second=plan({event:newEvent,devices:[staff],deliveries:old});
 assert.equal(second.ready,true);
});
test('guardian disabled/forced password rotation and unrelated parents cannot receive',()=>{
 const x=plan({devices:[{...guardian,account_active:false},
  {...guardian,subscription_id:202,must_change_password:true},
  {...guardian,subscription_id:203,verified_student_ids:[61]}]});
 assert.equal(x.ready,false);
});
test('all public-facing status comes from eligibility; this module never sends Push',()=>{
 const x=plan();
 assert.deepEqual(x.eligible[0],{
  type:'advisor',subscription_id:101,event_id:5001,generation:1,decision:'new'
 });
 assert.equal(eventEligible(event,NOW).ok,true);
});
