'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {STEPS,preflight,childEnv,accepted,run}
 =require('../scripts/check-all-staging.cjs');
const env={
 RD_DB_NAME:'ratsadaa_connect',RD_DB_HOST:'localhost',RD_DB_USER:'stage_user',
 RD_DB_PASSWORD:'stage-password',
 RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
 RD_TRIGGER_LAB_DB_HOST:'localhost',
 RD_TRIGGER_LAB_DB_USER:'lab_user',
 RD_TRIGGER_LAB_DB_PASSWORD:'lab-password'
};
function reply(step,code=step.expected){
 return {status:code,signal:null,stdout:step.markers.join('\n'),stderr:''};
}
test('one DirectAdmin command groups 9 isolated checks without exposing a real route',()=>{
 assert.equal(STEPS.length,9);
 assert.deepEqual(STEPS.map(s=>s.name),[
  'OFFLINE_AND_MIGRATION_PLAN','AUTH_HTTP_MARIADB_ROLLBACK',
  'PUSH_RECIPIENTS_OFFLINE',
  'PUSH_RECEIPTS_OFFLINE','DAILY_ATTENDANCE_ROLLBACK',
  'PERIOD_TRUANCY_ROLLBACK','PUSH_QUEUE_ROLLBACK',
  'PUSH_MOCK_DISPATCH_ROLLBACK','RELEASE_NO_GO_GUARD'
 ]);
 assert.equal(STEPS.filter(s=>s.expected===2).length,2);
});
test('safe staging preflight rejects wrong database and any lingering lab write flag',()=>{
 assert.equal(preflight(env),true);
 for(const bad of [
  {...env,RD_DB_NAME:'ratsadaa_trgtest'},
  {...env,RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'},
  {...env,RD_TRIGGER_LAB_DB_USER:env.RD_DB_USER},
  {...env,RD_TRIGGER_LAB_ALLOW_PERIOD:'old'},
  {...env,RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:'old'},
  {...env,RD_TRIGGER_LAB_ALLOW_UNKNOWN:'unexpected'},
  {...env,RD_MIGRATION_ALLOW_IMPORT:'yes'}
 ])assert.throws(()=>preflight(bad));
});
test('only child lab process receives temporary permission, parent remains unchanged',()=>{
 const original=JSON.stringify(env);
 for(const step of STEPS){
  const child=childEnv(env,step);
  if(step.flag)assert.equal(child[step.flag],step.permission);
  else assert.equal(Object.keys(child).some(k=>k.startsWith('RD_TRIGGER_LAB_ALLOW_')),false);
  assert.equal(child.RD_DB_NAME,'ratsadaa_connect');
 }
 assert.equal(JSON.stringify(env),original);
});
test('expected NO_GO exit 2 is treated as passing safety gate, not production-ready',()=>{
 for(const step of STEPS){
  assert.equal(accepted(reply(step),step),true);
  assert.equal(accepted(reply(step,step.expected===2?0:2),step),false);
 }
});
test('single run executes all steps, prints concise result and keeps lab opt-ins child-only',()=>{
 const calls=[],messages=[],errors=[];
 const result=run({env,
  execute:(node,args,opt)=>{
   const step=STEPS[calls.length];
   assert.equal(args.length,1);
   assert.ok(args[0].endsWith(step.script));
   calls.push({step:step.name,env:opt.env});
   return reply(step);
  },log:m=>messages.push(m),warn:m=>errors.push(m)});
 assert.equal(result,0);
 assert.equal(calls.length,9);
 assert.equal(errors.length,0);
 assert.ok(messages.some(x=>x.includes('STAGING COMBINED TESTS PASS')));
 assert.ok(messages.some(x=>x.includes('RELEASE STILL NO_GO')));
 assert.ok(messages.some(x=>x.includes('NO REAL PUSH')));
 assert.equal(Object.keys(env).some(x=>x.startsWith('RD_TRIGGER_LAB_ALLOW_')),false);
});
test('stops at first failing lab, does not continue to next action',()=>{
 let calls=0;const errors=[];
 const result=run({env,execute:()=>{
  const step=STEPS[calls++];
  return calls===6?{status:1,stdout:'lab error'}:reply(step);
 },log:()=>{},warn:x=>errors.push(x)});
 assert.equal(result,1);
 assert.equal(calls,6);
 assert.match(errors[0],/PERIOD_TRUANCY_ROLLBACK/);
 assert.ok(errors.some(x=>x.includes('do NOT assume lab was unchanged')));
});
test('missing rollback marker is a failure even with status 0',()=>{
 let calls=0;
 const result=run({env,execute:()=>{
  const step=STEPS[calls++];
  return calls===5?{status:0,stdout:'BATCH 1 LAB DAILY OK'}:reply(step);
 },log:()=>{},warn:()=>{}});
 assert.equal(result,1);
 assert.equal(calls,5);
});
test('preflight failure causes zero subprocesses; no SQL or external network',()=>{
 let invoked=0;const errors=[];
 const result=run({env:{...env,RD_TRIGGER_LAB_ALLOW_DDL:'old'},
  execute:()=>{invoked++;return{}},log:()=>{},warn:x=>errors.push(x)});
 assert.equal(result,1);
 assert.equal(invoked,0);
 assert.match(errors[0],/STAGING SUITE BLOCKED/);
});
