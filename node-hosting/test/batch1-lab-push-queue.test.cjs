'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 OPT_IN,checkPermission,checkConnection,ACTIVE_EVENT,
 QUEUE_ADVISORS,QUEUE_GUARDIANS,QUEUE_STUDENTS,
 queueEvent,claimSql,claim
}=require('../src/lab-truancy-push-queue.cjs');
const {run}=require('../scripts/check-lab-push-queue-rollback.cjs');
const env={RD_DB_NAME:'ratsadaa_connect',RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
 RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:OPT_IN};
const item={id:50,generation:2,student_id:9};
function fake({event=item,counts=[2,1,1],claimed=1}={}){
 const queries=[];
 return {queries,async execute(sql,args=[]){
  queries.push({sql,args});
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
  if(sql===ACTIVE_EVENT)return [[event].filter(Boolean)];
  if(sql===QUEUE_ADVISORS)return [{affectedRows:counts[0]}];
  if(sql===QUEUE_GUARDIANS)return [{affectedRows:counts[1]}];
  if(sql===QUEUE_STUDENTS)return [{affectedRows:counts[2]}];
  if(sql.startsWith('UPDATE '))return [{affectedRows:claimed}];
  throw Error('unexpected SQL');
 }};
}
test('exact temporary flag and separate lab DB required before any query',()=>{
 assert.throws(()=>checkPermission({}),/lab_push_opt_in_required/);
 assert.throws(()=>checkPermission({...env,RD_DB_NAME:'ratsadaa_trgtest'}),
  /lab_push_wrong_environment/);
 assert.throws(()=>checkPermission({...env,RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'}),
  /lab_push_wrong_environment/);
 assert.doesNotThrow(()=>checkPermission(env));
});
test('database identity cannot be staging or production',async()=>{
 await assert.rejects(()=>checkConnection({
  execute:async()=>[[{db:'ratsadaa_connect'}]]
 }),/lab_push_wrong_database/);
});
test('queue contacts only authenticated, linked active devices and 3 independent audiences',async()=>{
 const c=fake(),r=await queueEvent(c,50,{env});
 assert.deepEqual(r,{active:true,generation:2,advisor:2,guardian:1,student:1,queued:4});
 assert.deepEqual(c.queries.map(x=>x.sql),[
  'SELECT DATABASE() AS db',ACTIVE_EVENT,
  QUEUE_ADVISORS,QUEUE_GUARDIANS,QUEUE_STUDENTS
 ]);
 assert.deepEqual(c.queries[2].args,[50,2]);
 for(const sql of [QUEUE_ADVISORS,QUEUE_GUARDIANS,QUEUE_STUDENTS]){
  assert.match(sql,/notification_preferences/);
  assert.match(sql,/INSERT IGNORE/);
 }
 assert.match(QUEUE_ADVISORS,/advisor2_user_id/);
 assert.match(QUEUE_GUARDIANS,/guardian_student_links/);
 assert.match(QUEUE_GUARDIANS,/must_change_password=0/);
 assert.match(QUEUE_STUDENTS,/student_id=e.student_id/);
});
test('corrected / absent event can never queue a recipient',async()=>{
 const c=fake({event:null});
 const r=await queueEvent(c,50,{env});
 assert.equal(r.active,false);
 assert.equal(r.queued,0);
 assert.equal(c.queries.length,2);
});
test('claim is one conditional UPDATE, with max 3, cooldown, active classification, live link and policy',async()=>{
 const c=fake();
 for(const type of ['advisor','guardian','student']){
  const report=await claim(c,{event_id:50,generation:2,type,subscription_id:9},{env});
  assert.equal(report.claimed,true);
  assert.equal(report.sent,false);
  const sql=claimSql(type);
  assert.match(sql,/attempts<3/);
  assert.match(sql,/INTERVAL 2 MINUTE/);
  assert.match(sql,/period_truancy/);
  assert.match(sql,/notification_preferences/);
  assert.match(sql,/EXISTS\(SELECT/);
 }
 assert.equal(c.queries.filter(x=>x.sql.startsWith('UPDATE ')).length,3);
 assert.match(claimSql('advisor'),/staff_push_subscriptions/);
 assert.match(claimSql('guardian'),/guardian_student_links/);
 assert.match(claimSql('student'),/student_push_subscriptions/);
});
test('no delivered status can be written by the queue and claim module',()=>{
 const file=JSON.stringify([QUEUE_ADVISORS,QUEUE_GUARDIANS,QUEUE_STUDENTS,
  claimSql('advisor'),claimSql('guardian'),claimSql('student')]);
 assert.doesNotMatch(file,/SET state='delivered'/);
 assert.doesNotMatch(file,/COMMIT|fetch\(|https?:\/\//i);
});
test('invalid audience and event ID fail before mutation',async()=>{
 const c=fake();
 await assert.rejects(()=>queueEvent(c,0,{env}),/lab_push_invalid_event/);
 await assert.rejects(()=>claim(c,{event_id:50,generation:2,type:'random',subscription_id:9},{env}),
  /lab_push_invalid_audience/);
 await assert.rejects(()=>claim(c,{event_id:50,generation:2,type:'student',subscription_id:0},{env}),
  /lab_push_invalid_claim/);
 assert.equal(c.queries.length,0);
});
test('no temporary flag means integration test refuses to open database pool',async()=>{
 let opened=false;const warnings=[];
 const code=await run({env:{},driver:{createPool(){opened=true;throw Error('unexpected pool')}},
  log:()=>{},warn:x=>warnings.push(x)});
 assert.equal(code,1);
 assert.equal(opened,false);
 assert.match(warnings[0],/lab_push_opt_in_required/);
});
