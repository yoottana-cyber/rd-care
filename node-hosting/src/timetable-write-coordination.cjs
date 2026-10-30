'use strict';
// RD CONNECT — timetable lock coordination prototype (stage 7.11).
// No application API calls this module yet. It does NOT install SQL triggers.
// GET_LOCK locks are session-scoped, not transaction-scoped. The caller must
// hold acquired locks until AFTER COMMIT/ROLLBACK, then RELEASE_LOCK explicitly.
// All timetable writers must use the same stable key format to be safe.
const {createHash}=require('node:crypto');

function need(v,name){if(!v)throw Error('lab_'+name);}
function validInt(n,min,max){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
function normalizeLesson(input){
 need(input&&typeof input==='object'&&!Array.isArray(input),'lesson_required');
 const {classroom_id,teacher_user_id,day_of_week,period,end_period}=input;
 need(validInt(classroom_id,1,Number.MAX_SAFE_INTEGER),'invalid_classroom_id');
 need(validInt(teacher_user_id,1,Number.MAX_SAFE_INTEGER),'invalid_teacher_user_id');
 need(validInt(day_of_week,1,7),'invalid_weekday');
 need(validInt(period,1,10),'invalid_period_start');
 const end=end_period==null?period:end_period;
 need(validInt(end,period,10),'invalid_period_end');
 const active=input.active==null?1:input.active;
 need(active===0||active===1,'invalid_active_state');
 return {classroom_id,teacher_user_id,day_of_week,period,
  end_period:end,active};
}
function overlaps(a,b){
 const left=normalizeLesson(a),right=normalizeLesson(b);
 return left.active===1&&right.active===1&&
  left.day_of_week===right.day_of_week&&
  (left.classroom_id===right.classroom_id||
   left.teacher_user_id===right.teacher_user_id)&&
  left.period<=right.end_period&&left.end_period>=right.period;
}
function lockNames(dbName,lesson){
 need(typeof dbName==='string'&&/^[a-z0-9_]{3,64}$/.test(dbName),
  'invalid_lock_database');
 const s=normalizeLesson(lesson);
 const namespace=createHash('sha256').update('rd-connect:timetable:v1:'+dbName).digest('hex').slice(0,16);
 const prefix='rdctt1:'+namespace+':d'+s.day_of_week+':';
 const keys=[
  prefix+'c'+s.classroom_id.toString(36),
  prefix+'t'+s.teacher_user_id.toString(36)
 ].sort();
 need(keys.every(k=>k.length<=64),'lock_name_too_long');
 return keys;
}
async function releaseNamedLocks(conn,keys){
 let firstError;
 for(const key of [...keys].reverse()){
  try{
   const [[result]]=await conn.execute('SELECT RELEASE_LOCK(?) AS released',[key]);
   if(Number(result?.released)!==1)throw Error('lab_named_lock_release_failed');
  }catch(e){firstError??=e}
 }
 if(firstError)throw firstError;
}
async function acquireNamedLocks(conn,keys,{timeout=0}={}){
 need(Array.isArray(keys)&&keys.length===2&&keys[0]<keys[1]&&
  keys.every(k=>typeof k==='string'&&/^rdctt1:[0-9a-f]{16}:d[1-7]:[ct][0-9a-z]+$/.test(k)),
  'invalid_lock_keys');
 need(Number.isInteger(timeout)&&timeout>=0&&timeout<=3,'invalid_lock_timeout');
 const held=[];
 try{
  for(const key of keys){
   const [[result]]=await conn.execute('SELECT GET_LOCK(?, ?) AS acquired',[key,timeout]);
   if(Number(result?.acquired)===1){held.push(key);continue}
   if(result?.acquired!=null&&Number(result.acquired)===0)throw Error('lab_named_lock_busy');
   throw Error('lab_named_lock_error');
  }
  return held;
 }catch(e){
  if(held.length)await releaseNamedLocks(conn,held);
  throw e;
 }
}
function classifyTimetableDbError(error){
 if((error?.sqlState==='45000'||error?.errno===1644)&&
    (error?.sqlMessage==='TIMETABLE_OVERLAP'||String(error?.message||'').includes('TIMETABLE_OVERLAP')))
  return 'overlap';
 if(error?.message==='lab_named_lock_busy'||error?.errno===1205||error?.code==='ER_LOCK_WAIT_TIMEOUT')
  return 'busy_retry_new_transaction';
 if(error?.errno===1213||error?.code==='ER_LOCK_DEADLOCK')
  return 'deadlock_retry_new_transaction';
 return 'other_error';
}
module.exports={normalizeLesson,overlaps,lockNames,acquireNamedLocks,releaseNamedLocks,classifyTimetableDbError};
