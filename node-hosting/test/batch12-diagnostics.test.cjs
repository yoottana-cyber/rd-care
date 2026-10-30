'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {safeOfflineFailure,run}=require('../scripts/check-batch12.cjs');
const {reportSafeStepFailure}=require('../scripts/check-all-staging.cjs');

test('nested TAP failures are summarized by test name without raw secrets',()=>{
 const messages=[];
 const status=safeOfflineFailure({
  status:1,signal:null,
  stdout:'TAP version 13\nnot ok 1 - guardian cannot view unrelated child\n'+
   '# token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n'+
   'not ok 2 - teacher auth scope\n',
  stderr:'private-sql-password'
 },[__filename],line=>messages.push(line));
 assert.equal(status.failing,2);
 assert.equal(status.missing,0);
 assert.ok(messages.some(x=>x.includes('guardian cannot view unrelated child')));
 assert.ok(messages.some(x=>x.includes('teacher auth scope')));
 assert.ok(!messages.join('\n').includes('private-sql-password'));
 assert.ok(!messages.join('\n').includes('token='));
});
test('nested timeout reports ETIMEDOUT, not a guessed application failure',()=>{
 const warnings=[];
 const state=safeOfflineFailure({status:null,error:{code:'ETIMEDOUT'}},
  [__filename],message=>warnings.push(message));
 assert.equal(state.error,'ETIMEDOUT');
 assert.ok(warnings.some(x=>x.includes('TIMED OUT')));
});
test('aggregate runner forwards only approved safe diagnostics on failing stage 1',()=>{
 const seen=[];
 reportSafeStepFailure({status:1,stderr:[
  'BATCH 1+2 OFFLINE DIAGNOSTIC: exit=1 signal=none error=none.',
  'BATCH 1+2 FAILED CASE: guardian permission',
  'SQL password=private',
  'Error stack at /private/file'
 ].join('\n')},{name:'OFFLINE_AND_MIGRATION_PLAN'},msg=>seen.push(msg));
 assert.ok(seen.some(x=>x.includes('guardian permission')));
 assert.equal(seen.some(x=>x.includes('password=')),false);
 assert.equal(seen.some(x=>x.includes('Error stack')),false);
});
test('stage failure in other checks never repeats arbitrary child logs',()=>{
 const lines=[];
 reportSafeStepFailure({status:1,stderr:'password=private'},
  {name:'PERIOD_TRUANCY_ROLLBACK'},x=>lines.push(x));
 assert.equal(lines.length,1);
 assert.ok(lines[0].startsWith('STAGING STEP RESULT:'));
});
test('offline test runner errors never continue to a migration plan',async()=>{
 const warnings=[];let migrated=false;
 const code=await run({
  execute:()=>({
   status:1,
   stdout:'not ok 1 - denied cross-role token\n',
   stderr:'secrets are not included'
  }),
  migration:async()=>{migrated=true;return 0},
  log:()=>{},warn:x=>warnings.push(x)
 });
 assert.equal(code,1);
 assert.equal(migrated,false);
 assert.ok(warnings.some(x=>x.includes('FAILED CASE: denied cross-role token')));
});
