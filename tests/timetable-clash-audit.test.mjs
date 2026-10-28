import test from 'node:test';
import assert from 'node:assert/strict';
import {timetableClashes,adminTimetableAudit} from '../worker/src/timetable-audit.js';
import {readFileSync} from 'node:fs';
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const a={id:1,active:1,day_of_week:1,period:1,end_period:2,classroom_id:1,teacher_user_id:1};
test('detects room and teacher overlapping pairs but ignores adjacent/nonactive periods',()=>{
 const records=[a,{...a,id:2,period:2,end_period:3,classroom_id:2},
  {...a,id:3,period:2,end_period:3,teacher_user_id:2},
  {...a,id:4,period:3,end_period:4,classroom_id:3,teacher_user_id:3},
  {...a,id:5,period:2,end_period:3,active:0}];
 const conflicts=timetableClashes(records);
 assert.equal(conflicts.length,2);
 assert.deepEqual(conflicts[0].reasons,['teacher']);
 assert.deepEqual(conflicts[1].reasons,['room']);
});
test('school timetable audit is admin only and makes no data mutation',async()=>{
 let touched=false;
 const db={prepare(sql){
  if(/INSERT|UPDATE|DELETE/.test(sql))touched=true;
  return {all:async()=>({results:[]})};
 }};
 const req=new Request('https://test.local/api/admin/timetable/audit');
 for(const role of ['teacher','staff','guardian']){
  await assert.rejects(()=>adminTimetableAudit(req,{DB:db},{role}),{code:403});
 }
 const answer=await adminTimetableAudit(req,{DB:db},{id:1,role:'admin'});
 const result=await answer.json();
 assert.equal(result.approval_required,false);
 assert.deepEqual(result.clashes,[]);
 assert.equal(touched,false);
});
test('both teacher and admin entry points still save immediately without approval',()=>{
 const personal=file('worker/src/teacher-timetable.js'),userInterface=file('web/my-timetable.js'),
  admin=file('web/timetable-audit.js'),migration=file('worker/migrations/0026_timetable_clash_guards.sql');
 assert.match(personal,/VALUES\(\?,\?,\?,\?,\?,\?,\?,1,'approved'\)/);
 assert.match(userInterface,/ไม่ต้องรออนุมัติ/);
 assert.match(admin,/\/api\/admin\/timetable\/audit/);
 assert.doesNotMatch(migration,/DROP TABLE|ALTER TABLE/);
 assert.match(migration,/TIMETABLE_OVERLAP/);
});
