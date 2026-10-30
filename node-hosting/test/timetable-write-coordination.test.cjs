'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeLesson,overlaps,lockNames,acquireNamedLocks,
 releaseNamedLocks,classifyTimetableDbError}
 =require('../src/timetable-write-coordination.cjs');
const {OPT_IN,runDiagnostic,checkValidation,run}
 =require('../scripts/check-lab-timetable-locks.cjs');

const base={classroom_id:1,teacher_user_id:2,day_of_week:1,period:1,end_period:2,active:1};
test('valid periods inclusive and bounded from 1 to 10',()=>{
 assert.deepEqual(normalizeLesson({...base,end_period:null}),{...base,end_period:1});
 assert.equal(normalizeLesson(base).end_period,2);
 for(const bad of [{...base,period:0},{...base,period:11},
  {...base,period:3,end_period:2},{...base,end_period:11},
  {...base,day_of_week:8},{...base,classroom_id:0},
  {...base,teacher_user_id:-1},{...base,active:2}]){
  assert.throws(()=>normalizeLesson(bad),/lab_invalid_/);
 }
});
test('overlapping inclusive end points by teacher or classroom only',()=>{
 assert.equal(overlaps(base,{...base,period:2,end_period:3}),true);
 assert.equal(overlaps(base,{...base,period:3,end_period:3}),false);
 assert.equal(overlaps(base,{...base,active:0}),false);
 assert.equal(overlaps(base,{...base,classroom_id:8,teacher_user_id:2}),true);
 assert.equal(overlaps(base,{...base,classroom_id:8,teacher_user_id:9}),false);
 assert.equal(overlaps(base,{...base,day_of_week:2}),false);
});
test('keys stable, sorted, bounded and separated by school DB and weekday',()=>{
 const a=lockNames('ratsadaa_trgtest',base);
 assert.equal(a.length,2);
 assert.deepEqual(a,[...a].sort());
 assert.ok(a.every(v=>v.length<=64));
 assert.deepEqual(a,lockNames('ratsadaa_trgtest',{...base,period:7,end_period:9}));
 assert.notDeepEqual(a,lockNames('ratsadaa_connect',base));
 assert.notDeepEqual(a,lockNames('ratsadaa_trgtest',{...base,day_of_week:2}));
 assert.throws(()=>lockNames('Bad Name',base),/lab_invalid_lock_database/);
});
function connection(server,id){
 return {
  async execute(q,params){
   const key=params[0];
   if(q.startsWith('SELECT GET_LOCK')){
    const owner=server.get(key);
    if(owner!=null&&owner!==id)return [[{acquired:0}]];
    server.set(key,id);
    return [[{acquired:1}]];
   }
   if(q.startsWith('SELECT RELEASE_LOCK')){
    if(server.get(key)!==id)return [[{released:0}]];
    server.delete(key);return [[{released:1}]];
   }
   if(q.startsWith('SELECT IS_USED_LOCK'))return [[{holder:server.get(key)??null}]];
   throw Error('unsupported_sql');
  }
 };
}
test('cooperating users serialize room/teacher keys; failed partial acquire releases its own lock',async()=>{
 const server=new Map(),a=connection(server,1),b=connection(server,2);
 const aKeys=lockNames('ratsadaa_trgtest',base);
 const bKeys=lockNames('ratsadaa_trgtest',{...base,classroom_id:7});
 const held=await acquireNamedLocks(a,aKeys);
 await assert.rejects(()=>acquireNamedLocks(b,bKeys),/lab_named_lock_busy/);
 assert.equal(server.size,2); // B's distinct room lock is released if acquired
 await releaseNamedLocks(a,held);
 assert.equal(server.size,0);
 const after=await acquireNamedLocks(b,bKeys);
 await releaseNamedLocks(b,after);
 assert.equal(server.size,0);
});
test('classification distinguishes school overlap from transient DB contention',()=>{
 assert.equal(classifyTimetableDbError({sqlState:'45000',sqlMessage:'TIMETABLE_OVERLAP'}),'overlap');
 assert.equal(classifyTimetableDbError({errno:1205}),'busy_retry_new_transaction');
 assert.equal(classifyTimetableDbError({errno:1213}),'deadlock_retry_new_transaction');
 assert.equal(classifyTimetableDbError(Error('lab_named_lock_busy')),'busy_retry_new_transaction');
 assert.equal(classifyTimetableDbError({errno:1062}),'other_error');
});
test('script rejects missing opt-in before DB access',async()=>{
 let opened=false;const errors=[];
 const n=await run({env:{},driver:{createPool(){opened=true;throw Error('bad_access')}},
  log:()=>{},warn:e=>errors.push(e)});
 assert.equal(n,1);assert.equal(opened,false);
 assert.match(errors[0],/lab_explicit_lock_approval_required/);
 assert.equal(OPT_IN,'RUN_LAB_TIMETABLE_LOCK_7_11');
});
test('validation and real two-connection lock sequence can run without SQL data rows',async()=>{
 await checkValidation();
 const server=new Map(),a=connection(server,1),b=connection(server,2);
 const report=await runDiagnostic(a,b);
 assert.deepEqual(report.lock_cases_blocked,['same_teacher','same_room']);
 assert.equal(report.acquire_after_release,true);
 assert.equal(report.different_weekday_allowed,true);
 assert.equal(report.named_locks_released,true);
 assert.equal(server.size,0);
});
