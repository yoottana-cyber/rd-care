'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {FILE,NAMES,validateDraft,run}=require('../scripts/check-trigger-draft.cjs');
const draft=readFileSync(FILE,'utf8');
test('only three original D1 guardian/timetable rules are proposed',()=>{
 const report=validateDraft(draft);
 assert.deepEqual(report.draft_triggers,NAMES);
 assert.equal(report.sql_applied,false);
 assert.equal(report.database_access,false);
 assert.ok(report.review_required.includes('two_connection_overlap_race'));
});
test('a role guard or timetable overlap condition must not be omitted',()=>{
 assert.throws(()=>validateDraft(draft.replace("pa.role = 'guardian'","pa.role = 'student'")));
 assert.throws(()=>validateDraft(draft.replace("t.id <> OLD.id","t.id = OLD.id")));
 assert.throws(()=>validateDraft(draft.replace(
  't.period <= COALESCE(NEW.end_period, NEW.period)',
  't.period <= NEW.period'
 )));
});
test('reject destructive SQL injection in draft before any installation',()=>{
 assert.throws(()=>validateDraft(draft+'\nDROP TABLE students;\n'));
 assert.throws(()=>validateDraft(draft.replace('DRAFT ONLY | DO NOT EXECUTE','READY FOR LIVE')));
});
test('offline check emits no account information or SQL execution',()=>{
 const logs=[],warnings=[];
 const result=run({read:()=>draft,log:v=>logs.push(v),warn:v=>warnings.push(v)});
 assert.equal(result,0);assert.deepEqual(warnings,[]);
 assert.match(logs.join(' '),/NO DATABASE ACCESS \/ NO DDL/);
});
