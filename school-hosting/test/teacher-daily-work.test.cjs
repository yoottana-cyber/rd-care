'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
const workerUrl=pathToFileURL(path.resolve(__dirname,'../../worker/src/worker.js')).href;
const viewSource=fs.readFileSync(path.resolve(__dirname,'../../web/teacher-daily-work.js'),'utf8');
const guardSource=fs.readFileSync(path.resolve(__dirname,'../../web/attendance-draft-guard.js'),'utf8');
const asModule=src=>import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec([
  'CREATE TABLE classrooms(id INTEGER PRIMARY KEY,grade INTEGER,room INTEGER,label TEXT,advisor_user_id INTEGER,advisor2_user_id INTEGER);',
  'CREATE TABLE students(id INTEGER PRIMARY KEY,active INTEGER);',
  'CREATE TABLE student_enrollments(student_id INTEGER,classroom_id INTEGER,start_date TEXT,end_date TEXT);',
  'CREATE TABLE attendance_daily(student_id INTEGER,school_date TEXT,status TEXT);',
  "INSERT INTO classrooms VALUES(1,1,1,'ม.1/1',7,8),(2,1,2,'ม.1/2',9,NULL),(3,1,3,'ม.1/3',NULL,NULL);",
  'INSERT INTO students VALUES(1,1),(2,1),(3,1),(4,0),(5,1);',
  "INSERT INTO student_enrollments VALUES(1,1,'2026-05-01',NULL),(2,1,'2026-05-01',NULL),(3,2,'2026-05-01',NULL),(4,1,'2026-05-01',NULL),(5,1,'2026-05-01','2026-10-01');",
  "INSERT INTO attendance_daily VALUES(1,'2026-10-31','present'),(3,'2026-10-31','absent'),(4,'2026-10-31','late'),(5,'2026-10-31','present');"
 ].join('\n'));
 const DB={prepare(sql){return {bind(...args){return {async all(){return {results:sqlite.prepare(sql).all(...args)}}}}}}};
 return {sqlite,env:{DB}};
}
const req=date=>new Request('https://school.test/api/dashboard/advisor-rooms?date='+date);
test('teacher daily dashboard includes only personally advised rooms, correct enrollment and confirmed check-ins',async()=>{
 const {sqlite,env}=fixture();
 try{
  const {advisorDailyProgress}=await import(workerUrl);
  const result=await advisorDailyProgress(req('2026-10-31'),env,{id:7,role:'teacher'});
  assert.equal(result.status,200);
  assert.deepEqual((await result.json()).items,[{id:1,grade:1,label:'ม.1/1',students:2,checked:1}]);
  const second=await (await advisorDailyProgress(req('2026-10-31'),env,{id:8,role:'staff'})).json();
  assert.equal(second.items.length,1);
  const other=await (await advisorDailyProgress(req('2026-10-31'),env,{id:9,role:'teacher'})).json();
  assert.deepEqual(other.items,[{id:2,grade:1,label:'ม.1/2',students:1,checked:1}]);
  const admin=await (await advisorDailyProgress(req('2026-10-31'),env,{id:20,role:'admin'})).json();
  assert.equal(admin.items.length,0);
  const previous=await (await advisorDailyProgress(req('2026-10-30'),env,{id:7,role:'teacher'})).json();
  assert.equal(previous.items[0].checked,0);
 }finally{sqlite.close()}
});
test('student and guardian do not receive teacher dashboard',async()=>{
 const {sqlite,env}=fixture();
 try{
  const {advisorDailyProgress}=await import(workerUrl);
  for(const role of ['student','guardian'])
   await assert.rejects(advisorDailyProgress(req('2026-10-31'),env,{id:7,role}),
    err=>Number(err?.status||err?.code)===403);
 }finally{sqlite.close()}
});
test('daily teacher UI renders real progress without student identities',async()=>{
 const {teacherDailyWorkMarkup,summarizeDailyRooms}=await asModule(viewSource);
 const items=[{id:1,label:'ม.1/1',students:35,checked:32},{id:2,label:'ม.1/2',students:30,checked:30}];
 assert.deepEqual(summarizeDailyRooms(items),{rooms:2,withStudents:2,complete:1,waiting:1,pupils:65});
 const markup=teacherDailyWorkMarkup({items},{date:'2026-10-31'});
 assert.match(markup,/เหลือ 3 คน/);
 assert.match(markup,/32 \/ 35 คน/);
 assert.match(markup,/1 \/ 2 ห้องเช็กครบ/);
 assert.match(markup,/data-daily-room="1"/);
 assert.match(teacherDailyWorkMarkup(null,{unavailable:true}),/ยังโหลดสถานะ/);
});
test('unsaved changes guard responds to status and teaching-note edits',async()=>{
 const {takeAttendanceSnapshot,attendanceHasUnsavedChanges}=await asModule(guardSource);
 const state={kind:'daily',date:'2026-10-31',roomId:1,statuses:{1:'present',2:'absent'},teachingNote:''};
 const before=takeAttendanceSnapshot(state);
 assert.equal(attendanceHasUnsavedChanges(state,before),false);
 state.statuses[1]='late';
 assert.equal(attendanceHasUnsavedChanges(state,before),true);
 state.statuses[1]='present';
 assert.equal(attendanceHasUnsavedChanges(state,before),false);
 const period={...state,kind:'period',slotId:25,teachingNote:'เริ่มต้น'};
 const baseline=takeAttendanceSnapshot(period);
 period.teachingNote='อัปเดตแล้ว';
 assert.equal(attendanceHasUnsavedChanges(period,baseline),true);
});
