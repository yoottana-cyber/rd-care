'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planWrite,errorResponse,successResponse}
 =require('../src/timetable-offline-api-contract.cjs');
const {run}=require('../scripts/check-lab-timetable-http-contract.cjs');
const {conflictError}=require('../src/timetable-locked-insert.cjs');
const teacher={kind:'staff',authenticated:true,active:true,role:'teacher',user_id:11};
const lesson={classroom_id:3,day_of_week:1,period:1,end_period:2,
 subject:'Synthetic Lesson',active:1};
const own={id:8,teacher_user_id:11},foreign={id:9,teacher_user_id:22};
test('server principal fixes teacher id, cannot be assigned from request',()=>{
 const planned=planWrite(teacher,'insert',{body:lesson});
 assert.equal(planned.teacher_user_id,11);
 assert.equal(planned.lesson.teacher_user_id,11);
 assert.equal(planned.id,null);
 assert.throws(()=>planWrite(teacher,'insert',{body:{...lesson,teacher_user_id:22}}),
  e=>e.status===403);
});
test('only authenticated active teacher can modify self-owned timetable',()=>{
 assert.equal(planWrite(teacher,'delete',{id:8,existing:own}).action,'delete');
 assert.equal(planWrite(teacher,'update',{id:8,existing:own,body:lesson}).action,'update');
 for(const principal of [
  null,{...teacher,authenticated:false},{...teacher,kind:'portal',role:'student'},
  {...teacher,kind:'portal',role:'guardian'}]){
  assert.throws(()=>planWrite(principal,'insert',{body:lesson}),e=>e.status===401);
 }
 for(const principal of [{...teacher,role:'admin'}, {...teacher,role:'staff'},
  {...teacher,active:false}]){
  assert.throws(()=>planWrite(principal,'insert',{body:lesson}),e=>e.status===403);
 }
 for(const action of ['update','delete']){
  assert.throws(()=>planWrite(teacher,action,{id:9,existing:foreign,body:lesson}),
   e=>e.status===403);
 }
});
test('invalid IDs, missing current DB row, malformed period and action fail closed',()=>{
 assert.throws(()=>planWrite(teacher,'update',{id:8,existing:undefined,body:lesson}),
  e=>e.status===404);
 assert.throws(()=>planWrite(teacher,'delete',{id:0,existing:own}),
  e=>e.status===400);
 assert.throws(()=>planWrite(teacher,'insert',{body:{...lesson,period:11}}),
  e=>e.status===400);
 assert.throws(()=>planWrite(teacher,'insert',{body:{...lesson,subject:' '}}),
  e=>e.status===400);
 assert.throws(()=>planWrite(teacher,'bulk-delete',{id:8,existing:own}),
  e=>e.status===405);
});
test('known business errors map distinctly, unknown DB/secret errors never leak',()=>{
 const tests=[
  [conflictError(),409,'timetable_overlap'],
  [Error('lab_timetable_stale_snapshot'),409,'timetable_changed'],
  [Error('lab_named_lock_busy'),503,'timetable_busy'],
  [Object.assign(Error('busy'),{errno:1205}),503,'timetable_busy'],
  [Object.assign(Error('deadlock'),{errno:1213}),503,'timetable_busy'],
  [Error('lab_timetable_retry_exhausted'),503,'timetable_busy'],
  [Error('MYSQL_SECRET: password from DB'),503,'service_unavailable']
 ];
 for(const [error,status,code] of tests){
  const r=errorResponse(error);
  assert.equal(r.status,status);
  assert.equal(r.body.error,code);
  assert.equal(r.headers['Cache-Control'],'no-store');
  assert.equal(r.headers['Access-Control-Allow-Origin'],undefined);
  assert.doesNotMatch(JSON.stringify(r),/MYSQL_SECRET|password from DB/);
  if(code==='timetable_busy')assert.equal(r.headers['Retry-After'],'1');
  else assert.equal(r.headers['Retry-After'],undefined);
 }
});
test('CRUD success codes and no-body delete contract',()=>{
 assert.equal(successResponse('insert',{id:9}).status,201);
 assert.equal(successResponse('update',{id:9}).status,200);
 assert.deepEqual(successResponse('delete',{}).body,null);
 assert.equal(successResponse('delete',{}).status,204);
});
test('offline audit passes without opening DB or HTTP listener',async()=>{
 const info=[],warnings=[];
 const code=await run({log:s=>info.push(s),warn:s=>warnings.push(s)});
 assert.equal(code,0);
 assert.deepEqual(warnings,[]);
 assert.ok(info.some(x=>x.includes('PUBLIC API CLOSED')));
 assert.ok(info.some(x=>x.includes('NO DB ACCESS')));
});
