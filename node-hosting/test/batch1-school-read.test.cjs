'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const school=require('../src/school-read-service.cjs');
const {handleStagingSchoolRead}=require('../src/staging-school-http.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const teacher={kind:'staff',role:'teacher',id:3};
const guardian={kind:'portal',role:'guardian',id:10};
const student={kind:'portal',role:'student',id:11};
const makeConn=(responder)=>{
 const calls=[];return {calls,async execute(sql,args){
  calls.push({sql,args});
  return [responder(sql,args)];
 }};
};
const fail=async(fn,code)=>assert.rejects(fn,e=>e?.status===code);
test('date parser rejects invalid/leap and >90-day windows',()=>{
 assert.equal(school.validDate('2026-02-29'),false);
 assert.equal(school.validDate('2024-02-29'),true);
 assert.equal(school.validDate('2026-11-31'),false);
 assert.deepEqual(school.dateRange('2026-01-01','2026-03-31'),
  {from:'2026-01-01',to:'2026-03-31'});
 assert.throws(()=>school.dateRange('2026-01-01','2026-04-02'),e=>e.status===400);
});
test('teacher sees only homeroom or subject classrooms',async()=>{
 const allowed=makeConn((sql)=>{
  if(sql.startsWith('SELECT id,advisor_user_id'))return [{id:7,advisor_user_id:3,advisor2_user_id:null}];
  throw Error('unexpected query');
 });
 assert.equal((await school.assertRoom(allowed,teacher,7)).id,7);
 const denied=makeConn(sql=>sql.startsWith('SELECT id,advisor_user_id')?
  [{id:8,advisor_user_id:1,advisor2_user_id:2}]:[]);
 await fail(()=>school.assertRoom(denied,teacher,8),403);
 const secondary=makeConn(sql=>sql.startsWith('SELECT id,advisor_user_id')?
  [{id:9,advisor_user_id:1,advisor2_user_id:3}]:[]);
 await school.assertRoom(secondary,teacher,9);
 const instructor=makeConn(sql=>{
  if(sql.startsWith('SELECT id,advisor_user_id'))return [{id:9,advisor_user_id:1,advisor2_user_id:2}];
  if(sql.includes('FROM timetable'))return [{allowed:1}];
  throw Error('unexpected');
 });
 await school.assertRoom(instructor,teacher,9);
 assert.deepEqual(instructor.calls.at(-1).args,[9,3]);
});
test('daily attendance uses enrollment effective dates and bound classroom id',async()=>{
 const conn=makeConn(sql=>{
  if(sql.startsWith('SELECT id,advisor_user_id'))return [{id:7,advisor_user_id:3,advisor2_user_id:null}];
  if(sql.includes('FROM student_enrollments'))return [{student_id:11,status:'present'}];
  throw Error('unexpected query');
 });
 const result=await school.dailyAttendance(conn,teacher,7,'2026-10-30');
 assert.equal(result.items[0].status,'present');
 assert.deepEqual(conn.calls[1].args,['2026-10-30',7,'2026-10-30','2026-10-30']);
});
test('student portal cannot impersonate another student, guardian must have link',async()=>{
 const conn=makeConn((sql,args)=>{
  if(sql.includes('FROM portal_accounts WHERE id='))return [{student_id:22}];
  if(sql.includes('FROM guardian_student_links'))return args[1]===22?[{allowed:1}]:[];
  if(sql.includes('FROM students WHERE'))return [{id:22}];
  throw Error('unexpected query');
 });
 assert.equal(await school.portalStudentId(conn,guardian,22),22);
 await fail(()=>school.portalStudentId(conn,guardian,23),403);
 const pupil={kind:'portal',role:'student',id:11};
 assert.equal(await school.portalStudentId(conn,pupil,22),22);
 await fail(()=>school.portalStudentId(conn,pupil,21),403);
});
test('portal attendance isolates all rows to authorized student and date range',async()=>{
 const conn=makeConn((sql,args)=>{
  if(sql.includes('FROM guardian_student_links'))return [{allowed:1}];
  if(sql.includes('SELECT id FROM students'))return [{id:22}];
  if(sql.includes('FROM attendance_daily'))return [{school_date:'2026-10-30',status:'present'}];
  if(sql.includes('FROM attendance_period'))return [{school_date:'2026-10-30',status:'late'}];
  if(sql.includes('FROM late_records'))return [];
  throw Error('unexpected: '+sql);
 });
 const result=await school.portalAttendance(conn,guardian,22,'2026-10-01','2026-10-30');
 assert.equal(result.student_id,22);
 assert.deepEqual(conn.calls[2].args,[22,'2026-10-01','2026-10-30']);
 assert.deepEqual(conn.calls[3].args,[22,'2026-10-01','2026-10-30']);
});
function mockReq(url,method='GET',authorization='Bearer synthetic'){
 return {url,method,headers:{authorization}};
}
function mockRes(){
 return {status:0,headers:{},body:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.body=String(body??'')},
  json(){return JSON.parse(this.body)}
 };
}
test('offline school HTTP adapter rejects unknown methods and missing connection',async()=>{
 const r=mockRes();
 await handleStagingSchoolRead(mockReq('/api/classrooms'),r);
 assert.equal(r.status,503);
 const s=mockRes();
 await handleStagingSchoolRead(mockReq('/api/classrooms','POST'),s,{connection:{}});
 assert.equal(s.status,405);
 const invalid=mockRes();
 await handleStagingSchoolRead(mockReq('/api/secret'),invalid,{connection:{}});
 assert.equal(invalid.status,404);
});
test('authenticated adapter returns scoped data while public Handler still returns 501',async()=>{
 const services={
  async trustedSession(conn,kind,auth){
   assert.equal(kind,'staff');assert.equal(auth,'Bearer synthetic');return teacher;
  },
  async listRooms(){return {items:[{id:7,label:'M1/1'}]}}
 };
 const res=mockRes();
 await handleStagingSchoolRead(mockReq('/web/rd-connect-node-test/api/classrooms'),
  res,{connection:{},services});
 assert.equal(res.status,200);assert.equal(res.json().items.length,1);
 assert.equal(res.headers['Cache-Control'],'no-store');
 assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);
 const publicRes=mockRes();
 requestHandler(mockReq('/web/rd-connect-node-test/api/classrooms'),publicRes);
 assert.equal(publicRes.status,501);
 assert.equal(publicRes.json().error,'endpoint_not_migrated');
});

test('daily attendance read does not give subject-only teacher homeroom rights',async()=>{
 const otherRoom={id:7,advisor_user_id:20,advisor2_user_id:30};
 const conn=makeConn(sql=>{
  if(sql.startsWith('SELECT id,advisor_user_id'))return [otherRoom];
  if(sql.includes('FROM timetable'))return [{allowed:1}];
  throw Error('unexpected read attempt: '+sql);
 });
 await fail(()=>school.dailyAttendance(conn,teacher,7,'2026-10-30'),403);
 assert.equal(conn.calls.length,1);
});
test('period attendance returns only recorded statuses, with daily reference',async()=>{
 const subjectTeacher={kind:'staff',role:'teacher',id:3};
 const conn=makeConn((sql,args)=>{
  if(sql.startsWith('SELECT id,advisor_user_id'))return [{id:7,advisor_user_id:9,advisor2_user_id:8}];
  if(sql.includes('SELECT 1 AS allowed FROM timetable'))return [{allowed:1}];
  if(sql.startsWith('SELECT id,classroom_id,teacher_user_id,day_of_week'))
   return [{id:17,classroom_id:7,teacher_user_id:3,day_of_week:5}];
  if(sql.includes('FROM attendance_period'))return [{student_id:21,status:'truancy'}];
  if(sql.includes('FROM attendance_daily'))return [{student_id:21,status:'present'}];
  if(sql.includes('FROM period_teaching_logs'))return [{note:'sample lesson',updated_at:'2026-10-30'}];
  throw Error('unexpected: '+sql);
 });
 const actual=await school.periodAttendance(conn,subjectTeacher,7,'2026-10-30',17);
 assert.deepEqual(actual.items,[{student_id:21,status:'truancy'}]);
 assert.deepEqual(actual.daily_items,[{student_id:21,status:'present'}]);
 assert.equal(actual.daily_read_only,true);
 assert.equal(actual.teaching_note,'sample lesson');
 assert.deepEqual(conn.calls[3].args,[17,'2026-10-30',7]);
});
test('period attendance forbids another teacher and mismatched weekday',async()=>{
 const conn=makeConn((sql)=>{
  if(sql.startsWith('SELECT id,advisor_user_id'))return [{id:7,advisor_user_id:3,advisor2_user_id:null}];
  if(sql.startsWith('SELECT id,classroom_id,teacher_user_id,day_of_week'))
   return [{id:17,classroom_id:7,teacher_user_id:19,day_of_week:5}];
  throw Error('unexpected: '+sql);
 });
 await fail(()=>school.periodAttendance(conn,teacher,7,'2026-10-30',17),403);
 await fail(()=>school.periodAttendance(conn,teacher,7,'2026-10-29',17),400);
});
