'use strict';
// RD CONNECT 7.11: real MariaDB named-lock diagnostic, isolated TEST DB only.
// No INSERT/UPDATE/DELETE, no DDL, no transactions and no real identities.
// GET_LOCK is CONNECTION-scoped. Release locks explicitly before returning
// connections to pool; cleanup by closing pool even after an error.
const {randomInt}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {lockNames,normalizeLesson,overlaps,acquireNamedLocks,releaseNamedLocks,
 classifyTimetableDbError}=require('../src/timetable-write-coordination.cjs');
const {category}=require('./check-db.cjs');

const OPT_IN='RUN_LAB_TIMETABLE_LOCK_7_11';
function need(v,reason){if(!v)throw Error('lab_'+reason)}
async function checkedLockFree(conn,key){
 const [[row]]=await conn.execute('SELECT IS_USED_LOCK(?) AS holder',[key]);
 return row?.holder===null;
}
async function runDiagnostic(a,b){
 const rand=randomInt(100000,1000000000);
 const base={classroom_id:rand,teacher_user_id:rand+1,
  day_of_week:1,period:1,end_period:2,active:1};
 const teacherConflict={...base,classroom_id:rand+2,period:2,end_period:3};
 const roomConflict={...base,teacher_user_id:rand+3,period:2,end_period:3};
 const nextDay={...teacherConflict,day_of_week:2};
 need(overlaps(base,teacherConflict)&&overlaps(base,roomConflict),
  'overlap_contract_mismatch');
 need(!overlaps(base,nextDay),'weekday_separation_mismatch');
 const baseKeys=lockNames(LAB_DATABASE,base);
 const teacherKeys=lockNames(LAB_DATABASE,teacherConflict);
 const roomKeys=lockNames(LAB_DATABASE,roomConflict);
 const dayKeys=lockNames(LAB_DATABASE,nextDay);
 let aHeld=[],bHeld=[];
 try{
  aHeld=await acquireNamedLocks(a,baseKeys,{timeout:0});
  const blocked=[];
  for(const [caseName,keys] of [['same_teacher',teacherKeys],['same_room',roomKeys]]){
   let busy=false;
   try{
    bHeld=await acquireNamedLocks(b,keys,{timeout:0});
    // A common key must never be acquired by B while A still holds it.
    await releaseNamedLocks(b,bHeld);bHeld=[];
   }catch(e){
    if(classifyTimetableDbError(e)==='busy_retry_new_transaction')busy=true;
    else throw e;
   }
   need(busy,'shared_lock_was_not_exclusive');
   blocked.push(caseName);
  }
  // A different weekday must not share locks with the original weekday.
  bHeld=await acquireNamedLocks(b,dayKeys,{timeout:0});
  need(bHeld.length===2,'different_weekday_lock_failed');
  await releaseNamedLocks(b,bHeld);bHeld=[];
  await releaseNamedLocks(a,aHeld);aHeld=[];
  need((await Promise.all(baseKeys.map(key=>checkedLockFree(b,key)))).every(Boolean),
   'base_lock_not_released');
  // After A releases the two locks, B must be able to take them.
  bHeld=await acquireNamedLocks(b,teacherKeys,{timeout:0});
  need(bHeld.length===2,'retry_lock_acquisition_failed');
  await releaseNamedLocks(b,bHeld);bHeld=[];
  const allKeys=new Set([...baseKeys,...teacherKeys,...roomKeys,...dayKeys]);
  for(const key of allKeys)need(await checkedLockFree(a,key),'named_lock_leaked');
  return {database:LAB_DATABASE,lock_cases_blocked:blocked,
   different_weekday_allowed:true,acquire_after_release:true,
   invalid_periods_rejected:4,named_locks_released:true};
 }finally{
  // Leave no advisory locks bound to pooled sessions, even if assertions fail.
  if(bHeld.length)await releaseNamedLocks(b,bHeld);
  if(aHeld.length)await releaseNamedLocks(a,aHeld);
 }
}
async function checkValidation(){
 const base={classroom_id:1,teacher_user_id:1,day_of_week:1,period:1,end_period:2,active:1};
 let rejected=0;
 for(const bad of [
  {...base,period:0},
  {...base,period:9,end_period:8},
  {...base,end_period:11},
  {...base,day_of_week:8}
 ]){
  try{normalizeLesson(bad)}catch(e){if(String(e.message).startsWith('lab_invalid_'))rejected++}
 }
 need(rejected===4,'period_range_check_failed');
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,a,b,report=null,error=null;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_LOCK!==OPT_IN)
   throw Error('lab_explicit_lock_approval_required');
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:2,queueLimit:2});
  a=await pool.getConnection();
  await inspectSet(a,5);
  await assertEmpty(a);
  b=await pool.getConnection();
  const [[db]]=await b.execute('SELECT DATABASE() AS db');
  need(db?.db===LAB_DATABASE,'second_connection_wrong_database');
  const [[left]]=await a.execute('SELECT CONNECTION_ID() AS n');
  const [[right]]=await b.execute('SELECT CONNECTION_ID() AS n');
  need(left?.n!=null&&right?.n!=null&&left.n!==right.n,
   'distinct_connections_required');
  await checkValidation();
  report=await runDiagnostic(a,b);
  await assertEmpty(a);
  await inspectSet(a,5);
 }catch(e){error=e}
 finally{
  if(b){try{b.release()}catch{}}
  if(a){try{a.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
 if(error||!report){
  const message=String(error?.message||'');
  warn('STEP 7.11 FAILED ('+(message.startsWith('lab_')?message:category(error))+').');
  warn('If lock cleanup or connection termination failed, inspect the disposable lab connection state before retrying.');
  return 1;
 }
 log('STEP 7.11 LOCKS OK: MariaDB named locks serialize the same teacher or classroom on the same weekday.');
 log('PERIOD VALIDATION OK: invalid timetable start/end/day values rejected before SQL writes.');
 log('LAB DATA UNCHANGED: no DML, no DDL, all 63 lab tables empty, 5 original triggers remain.');
 log('LAB STATUS: '+JSON.stringify(report));
 log('NOT INTEGRATED: all future timetable writers must use the same lock scheme; this alone does not ensure production safety.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.11 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,runDiagnostic,checkValidation,run};
