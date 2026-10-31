'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {safeSmokeDiagnostics}=require('../install.cjs');

test('installer shows only known failing synthetic test names and migration error codes',()=>{
 const lines=[];
 const status=safeSmokeDiagnostics({
  status:1,
  stdout:[
   'TAP version 13',
   'not ok 1 - full original Worker migration chain works on server-local native SQLite',
   "  error: 'school_migration_failed_0040_unbounded_conduct_merit_scores'",
   'not ok 2 - private-secret=PLEASE_NOT_PRINT',
   '  stack: /home/private/password',
  ].join('\n'),
  stderr:'PASSWORD=PLEASE_NOT_PRINT'
 },x=>lines.push(x));
 assert.equal(status.known,1);
 assert.equal(status.codes,1);
 const messages=lines.join('\n');
 assert.match(messages,/SCHOOL SMOKE FAILED CASE: full original Worker migration chain/);
 assert.match(messages,/school_migration_failed_0040_unbounded_conduct_merit_scores/);
 assert.doesNotMatch(messages,/PLEASE_NOT_PRINT/);
 assert.doesNotMatch(messages,/\/home\/private/);
});
test('installer emits safe diagnostic when TAP crashes before test names',()=>{
 const lines=[];
 const info=safeSmokeDiagnostics({stdout:'',stderr:'ERR_MODULE_NOT_FOUND: secret=123'},
  x=>lines.push(x));
 assert.equal(info.bootstrap,'MODULE_NOT_FOUND');
 assert.ok(lines.some(x=>x.includes('MODULE_NOT_FOUND')));
 assert.doesNotMatch(lines.join(' '),/secret=123/);
});
