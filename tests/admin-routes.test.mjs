import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/worker.js';

function contextFor(role) {
 const user={id:1,username:'demo',display_name:'Demo',role,active:1};
 return { DB:{prepare(sql) {
   if(sql.includes('FROM sessions s'))return {bind(){return {async first(){return user}}}};
   if(sql.includes('SELECT id,classroom_id FROM students'))return {bind(){return {async first(){return null}}}};
   if(sql.includes('SELECT id,role FROM users'))return {bind(){return {async first(){return null}}}};
   throw new Error('unexpected database access: '+sql);
 }}};
}
const bearer={Authorization:'Bearer '+'a'.repeat(64)};
test('admin student routes reject anonymous requests without querying D1',async()=>{
 const response=await worker.fetch(new Request('https://test.local/api/admin/students?classroom_id=1'),contextFor('admin'));
 assert.equal(response.status,401);
});
test('admin student list and edits reject teacher role',async()=>{
 for(const [method,path,body] of [
  ['GET','/api/admin/students?classroom_id=1',undefined],
  ['GET','/api/admin/enrollments?student_id=1',undefined],
  ['POST','/api/admin/transfer-plans/1/execute','{}'],
  ['POST','/api/admin/students',JSON.stringify({classroom_id:1,roll_no:1,student_no:'DEMO1',full_name:'Sample'})],
  ['POST','/api/admin/students/1',JSON.stringify({classroom_id:1,roll_no:1,student_no:'DEMO1',full_name:'Sample'})],
  ['POST','/api/admin/users/1',JSON.stringify({display_name:'Teacher',active:0})]
 ]) {
  const response=await worker.fetch(new Request('https://test.local'+path,{
   method,headers:body?{'content-type':'application/json',...bearer}:bearer,body
  }),contextFor('teacher'));
  assert.equal(response.status,403,path);
 }
});
test('invalid admin student input returns 400 before D1 write',async()=>{
 const response=await worker.fetch(new Request('https://test.local/api/admin/students',{
  method:'POST',headers:{'content-type':'application/json',...bearer},
  body:JSON.stringify({classroom_id:1,roll_no:0,student_no:'D',full_name:'Demo'})
 }),contextFor('admin'));
 assert.equal(response.status,400);
});

test('student and teacher edit URLs reach the intended admin handler',async()=>{
 const admin=contextFor('admin');
 const studentResponse=await worker.fetch(new Request('https://test.local/api/admin/students/999',{
  method:'POST',headers:{'content-type':'application/json',...bearer},
  body:JSON.stringify({classroom_id:1,roll_no:1,student_no:'DEMO1',full_name:'Demo'})
 }),admin);
 assert.equal(studentResponse.status,404);
 assert.equal((await studentResponse.json()).error,'ไม่พบนักเรียน');
 const personnelResponse=await worker.fetch(new Request('https://test.local/api/admin/users/999',{
  method:'POST',headers:{'content-type':'application/json',...bearer},
  body:JSON.stringify({display_name:'Demo',active:0})
 }),admin);
 assert.equal(personnelResponse.status,404);
 assert.equal((await personnelResponse.json()).error,'ไม่พบบัญชี');
});

test('teacher cannot access administrator timetable approval queue',async()=>{
 for(const [method,path,body] of [
  ['GET','/api/admin/timetable/requests',undefined],
  ['POST','/api/admin/timetable/requests/5/review',JSON.stringify({decision:'approved'})]
 ]){
  const response=await worker.fetch(new Request('https://test.local'+path,{
   method,headers:body?{'content-type':'application/json',...bearer}:bearer,body
  }),contextFor('teacher'));
  assert.equal(response.status,403,path);
 }
});

test('old administrator approval endpoints are retired',async()=>{
 const admin=contextFor('admin');
 for(const [method,path,body] of [
  ['GET','/api/admin/timetable/requests',undefined],
  ['POST','/api/admin/timetable/requests/5/review',JSON.stringify({decision:'approved'})]
 ]){
  const response=await worker.fetch(new Request('https://test.local'+path,{
   method,headers:body?{'content-type':'application/json',...bearer}:bearer,body
  }),admin);
  assert.equal(response.status,404,path);
 }
});
