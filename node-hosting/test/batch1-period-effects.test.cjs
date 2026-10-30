'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {actionTypes,planPeriodEffects}=require('../src/period-attendance-effects.cjs');
const date='2026-10-30';
const actor={kind:'staff',id:20,role:'staff'};
const room={id:11,advisor_user_id:6,advisor2_user_id:7};
const slot={id:93,active:1,classroom_id:11,teacher_user_id:20,day_of_week:5};
const enrolled=[101,102];
function make(states=['truancy','present']){
 const dailyStatuses=new Map([[101,'present'],[102,'present']]);
 const previousStatuses=new Map([[101,null],[102,null]]);
 const body={kind:'period',classroom_id:11,date,timetable_id:93,
  entries:states.map((status,i)=>({student_id:enrolled[i],status}))};
 return {body,options:{actor,room,slot,enrolled,today:date,dailyStatuses,previousStatuses}};
}
test('truancy is stored as absent plus linked score and post-commit push requirements',()=>{
 const {body,options}=make();
 const out=planPeriodEffects(body,options);
 assert.equal(out.mutation_allowed,false);
 assert.equal(out.per_student[0].stored_status,'absent');
 assert.ok(out.per_student[0].steps.includes('period_truancy_activate'));
 assert.ok(out.per_student[0].steps.includes('conduct_score_ensure_or_restore_linked_record'));
 assert.ok(out.per_student[0].steps.includes('push_student_post_commit'));
 assert.equal(out.requires_truancy_score_and_push_parity,true);
 assert.equal(Object.prototype.hasOwnProperty.call(out.per_student[0],'points'),false);
});
test('correcting truancy revokes only its linked score, not the goodness ledger',()=>{
 const {body,options}=make(['present','leave']);
 options.previousStatuses.set(101,'truancy');
 const out=planPeriodEffects(body,options);
 assert.ok(out.per_student[0].steps.includes('conduct_score_soft_delete_linked_record'));
 assert.ok(out.per_student[0].steps.includes('period_truancy_deactivate_if_present'));
 assert.ok(!out.per_student[0].steps.some(x=>x.includes('merit')));
});
test('plain period absence with daily absent skips new advisor review; otherwise queues one',()=>{
 const {body,options}=make(['absent','present']);
 options.dailyStatuses.set(101,'absent');
 const suppressed=planPeriodEffects(body,options);
 assert.ok(suppressed.per_student[0].steps.includes('resolve_pending_advisor_alert'));
 assert.ok(!suppressed.per_student[0].steps.includes('create_or_reopen_advisor_review'));
 options.dailyStatuses.set(101,'present');
 const queued=planPeriodEffects(body,options);
 assert.ok(queued.per_student[0].steps.includes('queue_or_reopen_pending_advisor_outbox'));
});
test('delivered events are never marked for cancellation in status correction',()=>{
 for(const status of ['present','late','leave','absent']){
  const steps=actionTypes(status,'truancy','present');
  assert.ok(steps.every(x=>!x.includes('delivered')));
  assert.ok(steps.includes('conduct_score_soft_delete_linked_record'));
 }
});
test('missing/stale snapshot refuses plans rather than pretending Push and scoring are safe',()=>{
 const {body,options}=make();
 for(const changes of [
  {dailyStatuses:undefined},
  {previousStatuses:null},
  {dailyStatuses:new Map([[101,'present']])},
  {previousStatuses:new Map([[101,'truancy']])}
 ]){
  assert.throws(()=>planPeriodEffects(body,{...options,...changes}),e=>e.status===400);
 }
});
test('subject teacher ownership still applies to Student Affairs staff',()=>{
 const {body,options}=make();
 assert.throws(()=>planPeriodEffects(body,{...options,actor:{...actor,id:21}}),
  e=>e.status===403);
});
