import test from 'node:test';
import assert from 'node:assert/strict';
import {timetableClashes,adminTimetableAudit} from '../worker/src/timetable-audit.js';
import {lessonOverlaps} from '../worker/src/teacher-timetable.js';
import {readFileSync} from 'node:fs';
const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const base={active:1,academic_year:2569,semester:2,day_of_week:1,period:1,end_period:2,
 classroom_id:1,teacher_user_id:1,classroom_label:'ม.1/1',teacher_name:'ครู ก',subject:'คณิต'};
test('teacher and room clashes are detected; adjacent classes and other terms do not collide',()=>{
 const rows=[
  {...base,id:1},
  {...base,id:2,classroom_id:2,period:2,end_period:3},
  {...base,id:3,classroom_id:1,teacher_user_id:2,period:2,end_period:3},
  {...base,id:4,classroom_id:3,teacher_user_id:3,period:3,end_period:4},
  {...base,id:5,semester:1,teacher_user_id:1,classroom_id:1},
  {...base,id:6,period:1,end_period:3,active:0}
 ];
 const issues=timetableClashes(rows.filter(x=>x.semester===2));
 assert.equal(issues.length,2);
 assert.deepEqual(issues[0].reasons,['teacher']);
 assert.deepEqual(issues[1].reasons,['room']);
 assert.equal(lessonOverlaps(rows[0],rows[4]),false);
 assert.equal(lessonOverlaps(rows[0],rows[3]),false);
});
test('audit endpoint requires admin and is read only',async()=>{
 const req=new Request('https://school.test/api/admin/timetable/audit');
 for(const role of ['teacher','staff','student']){
  await assert.rejects(()=>adminTimetableAudit(req,{},{role},),{code:403});
 }
 let calls=[];
 const db={prepare(sql){calls.push(sql);return {
  bind(){return this},
  async first(){return {academic_year:2569,semester:2}},
  async all(){return {results:[]}}
 }}};
 const res=await adminTimetableAudit(req,{DB:db},{id:1,role:'admin'});
 const body=await res.json();
 assert.equal(body.no_approval,true);
 assert.equal(body.academic_year,2569);
 assert.ok(calls.some(s=>s.includes('t.academic_year=? AND t.semester=?')));
 assert.equal(calls.some(s=>/\b(UPDATE|DELETE|INSERT INTO timetable)\b/i.test(s)),false);
});
test('teacher form and administrator audit have separate UX without admin approval gate',()=>{
 const teacher=file('web/my-timetable.js'),admin=file('web/timetable-audit.js'),worker=file('worker/src/teacher-timetable.js');
 assert.match(teacher,/myTeachingTerm/);
 assert.match(teacher,/editable\?/);
 assert.match(worker,/approval_status='approved'/);
 assert.match(worker,/academic_year=\? AND t.semester=\?/);
 assert.match(admin,/\/api\/admin\/timetable\/audit/);
 assert.doesNotMatch(admin,/approve|อนุมัติคำขอ/);
});
