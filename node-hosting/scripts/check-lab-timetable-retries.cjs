'use strict';
// RD CONNECT 7.14: real MariaDB SELECT-only named-lock contention/retry test.
// NO DML / DDL / fake committed fixtures. Only isolated ratsadaa_trgtest.
// Retry helper never touches a public HTTP route or school DB.
const {randomInt}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {lockNames,acquireNamedLocks,releaseNamedLocks}
 =require('../src/timetable-write-coordination.cjs');
const {conflictError}=require('../src/timetable-locked-insert.cjs');
const {withTimetableRetry}=require('../src/timetable-safe-retry.cjs');
const {category}=require('./check-db.cjs');

const OPT_IN='RUN_LAB_TIMETABLE_RETRY_7_14';
function need(condition,reason){if(!condition)throw Error('lab_'+reason)}
function syntheticLesson(){
 const id=randomInt(100000,1000000000);
 return {classroom_id:id,teacher_user_id:id+1,day_of_week:1,
  period:1,end_period:2,active:1};
}
async function checkNoHolder(conn,keys){
 for(const key of keys){
  const [[row]]=await conn.execute('SELECT IS_USED_LOCK(?) AS holder',[key]);
  need(row?.holder===null,'named_lock_leaked');
 }
}
async function lockOnlyOperation(conn,keys){
 let held=[];
 try{
  held=await acquireNamedLocks(conn,keys,{timeout:0});
  return {lock_acquired:true};
 }finally{
  if(held.length)await releaseNamedLocks(conn,held);
 }
}
async function diagnostic(pool,holder,keys,{onRetryHook}={}){
 let held=[];
 try{
  // First case: first attempt BUSY, release holder, second succeeds.
  held=await acquireNamedLocks(holder,keys,{timeout:0});
  const first=await withTimetableRetry(pool,
   conn=>lockOnlyOperation(conn,keys),
   {maxAttempts:3,retryDelayMs:0,onRetry:async ({attempt})=>{
    need(attempt===1,'retry_count_wrong');
    await releaseNamedLocks(holder,held);
    held=[];
    if(onRetryHook)await onRetryHook();
   }});
  need(first.attempts===2&&first.retries===1&&first.value.lock_acquired,
   'retry_after_release_failed');
  await checkNoHolder(holder,keys);

  // Second case: holder never releases until all 3 allowed attempts end.
  held=await acquireNamedLocks(holder,keys,{timeout:0});
  let exhausted=false, attempts=0;
  try{
   await withTimetableRetry(pool,async conn=>{
    attempts++;
    return lockOnlyOperation(conn,keys);
   },{maxAttempts:3,retryDelayMs:0});
  }catch(e){exhausted=e?.message==='lab_timetable_retry_exhausted'}
  need(exhausted&&attempts===3,'bounded_exhaustion_failed');
  await releaseNamedLocks(holder,held);held=[];
  await checkNoHolder(holder,keys);

  // A real overlap is a permanent business error, never retry.
  let businessCalls=0,overlapRejected=false;
  try{
   await withTimetableRetry(pool,async ()=>{
    businessCalls++;
    throw conflictError();
   },{maxAttempts:3,retryDelayMs:0});
  }catch(e){overlapRejected=e?.message==='lab_timetable_overlap'}
  need(overlapRejected&&businessCalls===1,'overlap_was_retried');

  return {
   database:LAB_DATABASE,installed_triggers:5,
   busy_then_retry_succeeded:true,successful_attempts:2,
   busy_exhausted_after:attempts,overlap_attempts:businessCalls,
   pooled_connections_released:true,named_locks_released:true,
   no_data_writes:true,production_safe:false
  };
 }finally{
  if(held.length)await releaseNamedLocks(holder,held);
 }
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,holder,report=null,error=null;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_RETRY!==OPT_IN)
   throw Error('lab_explicit_retry_approval_required');
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:2,queueLimit:2});
  holder=await pool.getConnection();
  await inspectSet(holder,5);
  await assertEmpty(holder);
  const [[{db}]]=await holder.execute('SELECT DATABASE() AS db');
  need(db===LAB_DATABASE,'wrong_database');
  const keys=lockNames(LAB_DATABASE,syntheticLesson());
  report=await diagnostic(pool,holder,keys);
  await assertEmpty(holder);
  await inspectSet(holder,5);
 }catch(e){error=e}
 finally{
  if(holder){try{holder.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
 if(error||!report){
  const msg=String(error?.message||'');
  warn('STEP 7.14 FAILED ('+(msg.startsWith('lab_')?msg:category(error))+').');
  warn('NO DATA WRITES. If there was a lock-release error, verify test DB session locks before retrying.');
  return 1;
 }
 log('STEP 7.14 RETRY OK: transient named-lock busy retried with a new pool checkout and succeeded.');
 log('BOUNDED RETRY OK: still-busy lock stopped after exactly 3 attempts.');
 log('BUSINESS ERROR OK: timetable overlap never retried.');
 log('LAB UNCHANGED: 63 empty tables, exactly 5 triggers, no DML or DDL, named locks released.');
 log('LAB STATUS: '+JSON.stringify(report));
 log('NOT PRODUCTION READY: API integration, safe HTTP error mapping, and full writer coordination pending.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.14 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,syntheticLesson,checkNoHolder,lockOnlyOperation,diagnostic,run};
