import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLesson,periodLabel,lessonOverlaps,teacherTimetableRoutes} from '../worker/src/teacher-timetable.js';
const good={classroom_id:2,day_of_week:1,period:1,end_period:2,subject_code:'ว22103',subject:'วิทยาการคำนวณ'};
test('validate teacher lesson including pair periods and Thai subject codes',()=>{
 assert.deepEqual(validateLesson(good),good);
 assert.equal(periodLabel(2,3),'2-3');
 assert.equal(periodLabel(10,10),'10');
 for(const p of [1,2,3,4,5,6,7,8,9,10]){
   assert.equal(validateLesson({...good,period:p,end_period:p}).period,p);
 }
});
test('prevent skipped, backwards, or beyond period 10',()=>{
 for(const [p,e] of [[0,1],[2,4],[4,3],[9,11],[10,11],[12,12]]){
  assert.throws(()=>validateLesson({...good,period:p,end_period:e}),{code:400});
 }
 assert.throws(()=>validateLesson({...good,subject_code:''}),{code:400});
});
test('overlap teacher or classroom, including adjacent period',()=>{
 const a={...good,teacher_user_id:7};
 assert.equal(lessonOverlaps(a,{...a,period:2,end_period:3,classroom_id:3}),true);
 assert.equal(lessonOverlaps(a,{...a,period:3,end_period:4,classroom_id:3}),false);
 assert.equal(lessonOverlaps(a,{...a,period:2,end_period:3,teacher_user_id:9}),true);
 assert.equal(lessonOverlaps(a,{...a,day_of_week:2}),false);
});
test('non-teachers may not create or read personal timetables',async()=>{
 for(const role of ['admin','staff']){
  for(const method of ['GET','POST']){
   await assert.rejects(()=>teacherTimetableRoutes(
    new Request('https://test.local/api/my-timetable',{method,body:method==='POST'?'{}':undefined}),
    {},{id:1,role},'/api/my-timetable'),{code:403});
  }
 }
});
test('owner mismatch prevents another teacher from editing',async()=>{
 let wrote=false;
 const db={prepare(sql){
  if(sql.includes('FROM classrooms'))return {bind:()=>({first:async()=>({id:2})})};
  if(sql.includes('SELECT id,teacher_user_id FROM timetable'))return {bind:()=>({first:async()=>({id:9,teacher_user_id:4})})};
  if(sql.includes('UPDATE')||sql.includes('INSERT'))wrote=true;
  throw Error('Unexpected SQL: '+sql);
 }};
 await assert.rejects(()=>teacherTimetableRoutes(
  new Request('https://test.local/api/my-timetable/9/update',{method:'POST',body:JSON.stringify(good)}),
  {DB:db},{id:7,role:'teacher'},'/api/my-timetable/9/update'),{code:403});
 assert.equal(wrote,false);
});

test('new teacher timetable is activated immediately without admin approval',async()=>{
 const sqlUsed=[];
 const db={prepare(sql){
  sqlUsed.push(sql);
  if(sql.includes('SELECT id FROM classrooms WHERE id'))return {bind:()=>({first:async()=>({id:2})})};
  if(sql.includes('SELECT id FROM timetable')&&sql.includes('active=1'))return {bind:()=>({first:async()=>null})};
  if(sql.includes('INSERT INTO timetable'))return {bind:()=>({run:async()=>({meta:{last_row_id:34}})})};
  if(sql.includes('INSERT INTO audit_logs'))return {bind:()=>({run:async()=>({meta:{changes:1}})})};
  throw Error('Unexpected SQL: '+sql);
 }};
 const response=await teacherTimetableRoutes(new Request('https://test.local/api/my-timetable',{
  method:'POST',body:JSON.stringify(good)
 }),{DB:db},{id:7,role:'teacher'},'/api/my-timetable');
 assert.equal(response.status,201);
 assert.deepEqual((await response.json()).approval_status,'approved');
 assert.ok(sqlUsed.some(s=>s.includes("VALUES(?,?,?,?,?,?,?,1,'approved')")),'new timetable should be usable immediately');
});

test('conflicting teacher-created timeslots cannot be activated',async()=>{
 let wrote=false;
 const db={prepare(sql){
  if(sql.includes('SELECT id FROM classrooms WHERE id'))return {bind:()=>({first:async()=>({id:2})})};
  if(sql.includes('SELECT id FROM timetable')&&sql.includes('active=1'))return {bind:()=>({first:async()=>({id:14})})};
  if(sql.includes('INSERT INTO timetable')||sql.includes('UPDATE timetable'))wrote=true;
  throw Error('Unexpected SQL: '+sql);
 }};
 await assert.rejects(()=>teacherTimetableRoutes(
  new Request('https://test.local/api/my-timetable',{method:'POST',body:JSON.stringify(good)}),
  {DB:db},{id:7,role:'teacher'},'/api/my-timetable'),{code:409});
 assert.equal(wrote,false);
});
