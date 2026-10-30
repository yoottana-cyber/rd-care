'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {withTimetableRetry,validateOptions,isUnsafe}
 =require('../src/timetable-safe-retry.cjs');
const {OPT_IN,run,diagnostic}=require('../scripts/check-lab-timetable-retries.cjs');
const {lockNames}=require('../src/timetable-write-coordination.cjs');
const {conflictError}=require('../src/timetable-locked-insert.cjs');

function connectionPool({maxLive=2}={}){
 const held=new Map(),events=[];let nextId=0;
 const pool={
  connections:[],
  async getConnection(){
   const id=++nextId;const session={id,released:false,destroyed:false};
   session.execute=async(sql,params=[])=>{
    const key=params[0];events.push({id,sql});
    if(sql.startsWith('SELECT GET_LOCK')){
     const owner=held.get(key);
     if(owner!=null&&owner!==id)return [[{acquired:0}]];
     held.set(key,id);return [[{acquired:1}]];
    }
    if(sql.startsWith('SELECT RELEASE_LOCK')){
     if(held.get(key)!==id)return [[{released:0}]];
     held.delete(key);return [[{released:1}]];
    }
    if(sql.startsWith('SELECT IS_USED_LOCK'))return [[{holder:held.get(key)??null}]];
    throw Error('unsupported query');
   };
   session.release=()=>{assert.equal(session.released,false);session.released=true};
   session.destroy=()=>{session.destroyed=true;session.released=true;
    for(const [key,owner] of held)if(owner===id)held.delete(key)};
   pool.connections.push(session);
   return session;
  }
 };
 return {pool,held,events};
}
test('validate options refuse unbounded retry count or delays',()=>{
 for(const opts of [{maxAttempts:0},{maxAttempts:4},{retryDelayMs:-1},
  {retryDelayMs:201},{sleep:'no'},{onRetry:1}]){
  assert.throws(()=>validateOptions(opts),/lab_retry_/);
 }
});
test('busy then success uses two distinct checkouts and releases both',async()=>{
 const {pool,held}=connectionPool();
 let attempts=0;
 const report=await withTimetableRetry(pool,async conn=>{
  attempts++;
  if(attempts===1)throw Error('lab_named_lock_busy');
  return 'accepted';
 },{maxAttempts:3,retryDelayMs:0});
 assert.deepEqual(report,{value:'accepted',attempts:2,retries:1});
 assert.equal(pool.connections.length,2);
 assert.ok(pool.connections.every(x=>x.released&&!x.destroyed));
 assert.equal(held.size,0);
});
test('busy exhaustion stops at three attempts, every checked out session returned',async()=>{
 const {pool}=connectionPool();
 await assert.rejects(()=>withTimetableRetry(pool,async()=>{
  throw Error('lab_named_lock_busy');
 },{maxAttempts:3,retryDelayMs:0}),/lab_timetable_retry_exhausted/);
 assert.equal(pool.connections.length,3);
 assert.ok(pool.connections.every(x=>x.released));
});
test('actual business overlap and stale changes NEVER retry',async()=>{
 for(const err of [conflictError(),Error('lab_timetable_stale_snapshot')]){
  const {pool}=connectionPool();
  let calls=0;
  await assert.rejects(()=>withTimetableRetry(pool,async()=>{
   calls++;throw err;
  },{maxAttempts:3,retryDelayMs:0}),e=>e===err);
  assert.equal(calls,1);
  assert.equal(pool.connections.length,1);
 }
});
test('deadlock retries; unknown commit/rollback or unlock failures destroy session',async()=>{
 const {pool}=connectionPool();let attempts=0;
 await withTimetableRetry(pool,async()=>{
  attempts++;
  if(attempts===1){const e=Error('deadlock');e.errno=1213;throw e}
  return 'ok';
 },{maxAttempts:2,retryDelayMs:0});
 assert.equal(attempts,2);
 for(const message of ['lab_timetable_rollback_failed','lab_timetable_lock_release_failed',
  'lab_named_lock_release_failed']){
  const x=connectionPool();
  await assert.rejects(()=>withTimetableRetry(x.pool,async()=>{
   throw Error(message);
  }),/lab_connection_unsafe/);
  assert.equal(x.pool.connections[0].destroyed,true);
 }
 assert.equal(isUnsafe({code:'ECONNRESET'}),true);
});
test('a release() failure destroys the connection instead of reusing it',async()=>{
 let destroyed=0,releases=0;
 const pool={getConnection:async()=>({
  release(){releases++;throw Error('release error')},
  destroy(){destroyed++}
 })};
 await assert.rejects(()=>withTimetableRetry(pool,async()=>1),/lab_connection_release_failed/);
 assert.equal(destroyed,1);assert.equal(releases,1);
});
test('safe instrumentation hook runs after first connection has been returned',async()=>{
 const {pool}=connectionPool();
 let seen=false;
 const status=await withTimetableRetry(pool,async(conn,attempt)=>{
  if(attempt===1)throw Error('lab_named_lock_busy');
  return true;
 },{retryDelayMs:0,onRetry:async()=>{
  assert.equal(pool.connections[0].released,true);
  seen=true;
 }});
 assert.ok(seen);assert.equal(status.attempts,2);
});
test('lab command cannot connect without exact opt-in',async()=>{
 let opened=false;const warnings=[];
 const n=await run({env:{},driver:{createPool(){opened=true;throw Error('unexpected')}},
  log:()=>{},warn:x=>warnings.push(x)});
 assert.equal(n,1);assert.equal(opened,false);
 assert.equal(OPT_IN,'RUN_LAB_TIMETABLE_RETRY_7_14');
 assert.match(warnings[0],/lab_explicit_retry_approval_required/);
});
test('two independent named-lock test sequences clean all session locks',async()=>{
 const {pool,held}=connectionPool();
 const holder=await pool.getConnection();
 const lesson={classroom_id:101,teacher_user_id:202,day_of_week:1,
  period:1,end_period:2,active:1};
 const keys=lockNames('ratsadaa_trgtest',lesson);
 const report=await diagnostic(pool,holder,keys);
 assert.equal(report.busy_then_retry_succeeded,true);
 assert.equal(report.busy_exhausted_after,3);
 assert.equal(report.overlap_attempts,1);
 assert.equal(held.size,0);
 holder.release();
});
