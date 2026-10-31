'use strict';
// No real DB, HTTP requests, D1, Push, child processes or secrets in this test.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {STEPS}=require('../scripts/check-all-staging.cjs');
const {preflight,acceptedStaging,acceptedParity,run}
 =require('../scripts/check-full-staging.cjs');
const stagingOutput=[
 ...STEPS.map((s,i)=>'['+(i+1)+'/'+STEPS.length+'] '+s.name+': OK'),
 'STAGING COMBINED TESTS PASS: '+STEPS.length+' grouped checks from one DirectAdmin command.',
 'LAB/STAGING ROLLBACK VERIFIED: synthetic.',
 'PUBLIC API STILL CLOSED: migration HTTP routes remain disabled.',
 'RELEASE STILL NO_GO: migration blocked.',
 'NO REAL PUSH / NO REAL SCHOOL RECORDS MODIFIED.'
].join('\n');
const parityOutput=[
 'STAGE 13 API ROUTE AUDIT OK: 41 representative Worker route+method contracts inventoried.',
 'PRIVATE ROUTE NAME+METHOD FOUND: 13 (response shape unverified).',
 'NO MATCHING PRIVATE ROUTE: 28.',
 'PORTAL RECORDS PRIVATE ROUTE FOUND: available internally only.',
 'PUBLIC PASSENGER API CLOSED: login remains 501; health remains 503.'
].join('\n');
const goodStaging={status:0,stdout:stagingOutput,stderr:''};
const goodParity={status:2,stdout:parityOutput,stderr:'STAGE 13 NO_GO: deliberately closed.'};
function mockedRun({responses=[goodStaging,goodParity],validate=()=>true}={}){
 const calls=[],logs=[],warnings=[];
 const exit=run({env:{RD_DB_NAME:'ratsadaa_connect'},validate,
  execute:(binary,args,opts)=>{
   calls.push({name:path.basename(args[0]),args,opts});
   return responses[calls.length-1]??{status:1};
  },log:x=>logs.push(x),warn:x=>warnings.push(x)});
 return {exit,calls,logs,warnings};
}
test('single command checks all 11 groups then exact API NO_GO audit',()=>{
 const r=mockedRun();
 assert.equal(r.exit,0);
 assert.deepEqual(r.calls.map(c=>c.name),
  ['check-all-staging.cjs','check-stage13-api-parity.cjs']);
 assert.ok(r.logs.some(x=>x.includes('11/11')));
 assert.ok(r.logs.some(x=>x.includes('13 private route names')));
 assert.ok(r.logs.some(x=>x.includes('RELEASE STILL NO_GO')));
 assert.ok(!r.logs.join('\n').includes('production ready'));
});
test('missing a staging group is a hard failure before API audit',()=>{
 const r=mockedRun({responses:[{...goodStaging,
  stdout:stagingOutput.replace('[8/11] PUSH_QUEUE_ROLLBACK: OK','')} ]});
 assert.equal(r.exit,1);
 assert.equal(r.calls.length,1);
 assert.ok(r.warnings.some(x=>x.includes('FULL STAGING STAGING FAILED')));
});
test('API audit exit 2 is expected, but exit 0 is rejected',()=>{
 assert.deepEqual(acceptedParity(goodParity),{total:41,matched:13,pending:28});
 const r=mockedRun({responses:[goodStaging,{...goodParity,status:0}]});
 assert.equal(r.exit,1);
 assert.equal(r.calls.length,2);
});
test('API regression in name coverage, inconsistent inventory or missing gate fails',()=>{
 assert.equal(acceptedParity({...goodParity,
  stdout:parityOutput.replace('FOUND: 13','FOUND: 12').replace('ROUTE: 28','ROUTE: 29')}),null);
 assert.equal(acceptedParity({...goodParity,
  stdout:parityOutput.replace('ROUTE: 28','ROUTE: 29')}),null);
 assert.equal(acceptedParity({...goodParity,
  stdout:parityOutput.replace('PUBLIC PASSENGER API CLOSED','UNKNOWN STATUS')}),null);
 assert.equal(acceptedParity({...goodParity,stderr:''}),null);
});
test('staging exit 2 is a failure; cannot mask a lab error',()=>{
 assert.equal(acceptedStaging({...goodStaging,status:2}),false);
 assert.equal(acceptedStaging(goodStaging),true);
 const r=mockedRun({responses:[{...goodStaging,status:2}]});
 assert.equal(r.exit,1);
 assert.equal(r.calls.length,1);
});
test('temporary migration rehearsal flags abort before spawning anything',()=>{
 assert.throws(()=>preflight({RD_D1_REHEARSAL_CONFIRM:'RUN_SYNTHETIC_D1_ROLLBACK_ONLY'}),
  /full_staging_remove_old_rehearsal_flags/);
 assert.throws(()=>preflight({RD_D1_MANIFEST_FILE:'/private/manifest.json'}),
  /full_staging_remove_old_rehearsal_flags/);
 const r=mockedRun({validate:()=>{throw Error('full_staging_remove_old_rehearsal_flags')}});
 assert.equal(r.exit,1);
 assert.equal(r.calls.length,0);
});
test('unexpected stderr never echoes password, token, SQL or stack',()=>{
 const r=mockedRun({responses:[{status:1,stdout:'',
  stderr:'password=school-credential\nBearer private\nSQL root\n'+
  'STAGING SUITE STOPPED AT 4/11: PUSH_RECIPIENTS_OFFLINE.\n'}]});
 assert.equal(r.exit,1);
 const text=r.warnings.join('\n');
 assert.ok(text.includes('FAILED GROUP: 4/11 PUSH_RECIPIENTS_OFFLINE'));
 for(const key of ['school-credential','Bearer','SQL root','password='])
  assert.equal(text.includes(key),false);
});
