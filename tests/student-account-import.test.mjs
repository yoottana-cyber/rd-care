import test from 'node:test';
import assert from 'node:assert/strict';
import {studentUsername,planStudentPortalAccounts} from '../worker/src/student-username.js';
import {planStudentAccounts} from '../web/portal-batch.js';
import {portalAdminRoutes} from '../worker/src/portal.js';

test('student number preserves leading zeros and normalizes a username safely',()=>{
 assert.equal(studentUsername({student_no:' 001234 '}),'001234');
 assert.equal(studentUsername({student_no:'STU-007'}),'stu-007');
 for(const value of ['','  ','12','ไทย๑๒๓','STU/01','001\n234','x'.repeat(41)])
  assert.throws(()=>studentUsername({student_no:value}));
});

test('classroom batch plan skips existing accounts and invalid identifiers',()=>{
 const students=[
  {id:1,student_no:'00001',full_name:'Demo A',active:1},
  {id:2,student_no:'00002',full_name:'Demo B',active:1},
  {id:3,student_no:'00003',full_name:'Demo C',active:1},
  {id:4,student_no:'invalid no',full_name:'Demo D',active:1}
 ];
 const accounts=[
  {student_id:1,username:'00001',role:'student'},
  {student_id:null,username:'00003',role:'guardian'}
 ];
 for(const plan of [
  planStudentPortalAccounts(students,accounts,10),
  planStudentAccounts(students,accounts,10)
 ]){
  assert.deepEqual(plan.ready.map(x=>x.username),['00002']);
  assert.equal(plan.skipped.length,3);
  assert.match(plan.skipped[0].reason,/บัญชี/);
 }
});

test('batch planning limits work to 10 per click for Worker CPU budget',()=>{
 const students=Array.from({length:24},(_,i)=>({id:i+1,student_no:String(i+1000),full_name:'Demo '+i,active:1}));
 assert.equal(planStudentAccounts(students,[],10).ready.length,10);
 assert.equal(planStudentPortalAccounts(students,[],10).ready.length,10);
});

test('student portal creation rejects a username different from registered student number',async()=>{
 let queried=0;
 const fake={DB:{prepare(sql){
  queried++;
  if(sql.includes('FROM students WHERE id=? AND active=1'))return {bind(){return {async first(){return {id:5,student_no:'001234',full_name:'Demo Student'}}}}};
  throw Error('Unexpected query: '+sql);
 }}};
 const req=new Request('https://rdcare.test/api/admin/portal/accounts',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({role:'student',student_id:5,username:'fake-username'})
 });
 await assert.rejects(
  portalAdminRoutes(req,fake,{id:1,role:'admin'},'/api/admin/portal/accounts'),
  e=>e.code===400&&e.message.includes('เลขประจำตัวนักเรียน')
 );
 assert.equal(queried,1);
});
