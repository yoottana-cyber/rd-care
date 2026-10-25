import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/worker.js';
import {validateLateSelfReport,validateLateReviewState,bangkokArrivalTime} from '../worker/src/late-self.js';

test('self-report validation requires staff-provided 96-bit code',()=>{
 assert.deepEqual(validateLateSelfReport({
  student_no:' DEMO0001 ',code:'AB12CD34EF56AB12CD34EF56',reason:' รถติด '
 }),{student_no:'DEMO0001',code:'ab12cd34ef56ab12cd34ef56',reason:'รถติด'});
 for(const b of [
  {student_no:'',code:'a'.repeat(24)},
  {student_no:'DEMO',code:'1234'},
  {student_no:'DEMO',code:'a'.repeat(24),reason:'a'.repeat(301)},
  {student_no:'DEMO',code:'a'.repeat(24),reason:'a\nb'}
 ])assert.throws(()=>validateLateSelfReport(b));
});
test('staff review state is strictly verified or rejected',()=>{
 assert.equal(validateLateReviewState('verified'),'verified');
 assert.equal(validateLateReviewState('rejected'),'rejected');
 assert.throws(()=>validateLateReviewState('pending'));
 assert.throws(()=>validateLateReviewState('confirmed'));
});
test('arrival time comes from server Bangkok timezone',()=>{
 assert.equal(bangkokArrivalTime(new Date('2026-10-25T02:07:00Z')),'09:07');
});
const headers={'content-type':'application/json',authorization:'Bearer '+'a'.repeat(64)};
function envFor(role){
 const user={id:1,username:'demo',display_name:'Demo',role,active:1};
 return {DB:{prepare(sql){
  if(sql.includes('FROM sessions s'))return {bind(){return{async first(){return user}}}};
  throw Error('Unexpected DB access for unauthorized route '+sql);
 }}};
}
test('public self-report rejects invalid code without requiring teacher login',async()=>{
 const response=await worker.fetch(new Request('https://rdcare.test/api/student/late/report',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({student_no:'DEMO0001',code:'wrong'})
 }),{DB:{prepare(){throw Error('must not query')}}});
 assert.equal(response.status,400);
});
test('teachers cannot issue codes, list requests or approve student late reports',async()=>{
 for(const [method,path,body] of [
  ['POST','/api/late/self/code',{student_id:1}],
  ['GET','/api/late/self/requests?classroom_id=1&date=2026-10-25',null],
  ['POST','/api/late/self/requests/1/review',{state:'verified'}]
 ]){
  const response=await worker.fetch(new Request('https://rdcare.test'+path,{
   method,headers,body:body?JSON.stringify(body):undefined
  }),envFor('teacher'));
  assert.equal(response.status,403,path);
 }
});
test('anonymous users cannot access staff issue and review endpoints',async()=>{
 for(const url of ['/api/late/self/code','/api/late/self/requests/1/review']){
  const response=await worker.fetch(new Request('https://rdcare.test'+url,{
   method:'POST',headers:{'content-type':'application/json'},body:'{}'
  }),{DB:{prepare(){throw Error('must not query')}}});
  assert.equal(response.status,401);
 }
});
