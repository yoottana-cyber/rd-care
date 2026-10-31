'use strict';
// RD CONNECT stage 7.13 — lab-only UPDATE and DELETE prototypes.
// No API routes call these functions. All timetable writers must cooperate.
// For UPDATE, lock BOTH original and target room/teacher/day resources.
// For DELETE, lock original resources. Locks are connection scoped and held
// until after COMMIT or ROLLBACK; caller must discard connection if cleanup fails.
const {normalizeLesson,lockNames}=require('./timetable-write-coordination.cjs');
const {assertSubject,conflictError}=require('./timetable-locked-insert.cjs');

const READ='SELECT id,classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active FROM timetable WHERE id=? LIMIT 1';
const READ_LOCKED=READ+' FOR UPDATE';
const PRECHECK=`SELECT id FROM timetable WHERE id <> ? AND active=1
 AND day_of_week=? AND (classroom_id=? OR teacher_user_id=?)
 AND period <= ? AND COALESCE(end_period,period) >= ? LIMIT 1`;
const UPDATE=`UPDATE timetable SET
 classroom_id=?,teacher_user_id=?,day_of_week=?,period=?,
 end_period=?,subject=?,active=? WHERE id=?`;
const DELETE='DELETE FROM timetable WHERE id=?';

function requireId(id){
 if(!Number.isSafeInteger(id)||id<1)throw Error('lab_invalid_timetable_id');
 return id;
}
function normalizeRow(row){
 if(!row)throw Error('lab_timetable_not_found');
 const normalized=normalizeLesson({
  classroom_id:Number(row.classroom_id),teacher_user_id:Number(row.teacher_user_id),
  day_of_week:Number(row.day_of_week),period:Number(row.period),
  end_period:row.end_period==null?null:Number(row.end_period),
  active:Number(row.active)
 });
 return {...normalized,subject:assertSubject(row.subject)};
}
function signature(row){
 const s=normalizeRow(row);
 return [s.classroom_id,s.teacher_user_id,s.day_of_week,s.period,
  s.end_period,s.active,s.subject].join('|');
}
function unionKeys(dbName,oldLesson,newLesson){
 const keys=[...lockNames(dbName,oldLesson)];
 if(newLesson)keys.push(...lockNames(dbName,newLesson));
 return [...new Set(keys)].sort();
}
function validateKeys(keys){
 if(!Array.isArray(keys)||(keys.length!==2&&keys.length!==3&&keys.length!==4)||
    keys.some((k,i)=>typeof k!=='string'||!/^rdctt1:[0-9a-f]{16}:d[1-7]:[ct][0-9a-z]+$/.test(k)||
     (i>0&&keys[i-1]>=k)))throw Error('lab_invalid_lock_keys');
}
async function releaseSet(conn,held){
 let error;
 for(const key of [...held].reverse()){
  try{
   const [[r]]=await conn.execute('SELECT RELEASE_LOCK(?) AS released',[key]);
   if(Number(r?.released)!==1)throw Error('lab_named_lock_release_failed');
  }catch(e){error??=e}
 }
 if(error)throw Error('lab_named_lock_release_failed',{cause:error});
}
async function acquireSet(conn,keys,{timeout=0}={}){
 validateKeys(keys);
 if(!Number.isInteger(timeout)||timeout<0||timeout>3)
  throw Error('lab_invalid_lock_timeout');
 const held=[];
 try{
  for(const key of keys){
   const [[result]]=await conn.execute('SELECT GET_LOCK(?,?) AS acquired',[key,timeout]);
   if(Number(result?.acquired)===1){held.push(key);continue}
   if(result?.acquired!=null&&Number(result.acquired)===0)
    throw Error('lab_named_lock_busy');
   throw Error('lab_named_lock_error');
  }
  return held;
 }catch(error){
  if(held.length)await releaseSet(conn,held);
  throw error;
 }
}
async function readRow(conn,id,sql=READ){
 const [rows]=await conn.execute(sql,[requireId(id)]);
 if(rows.length!==1)throw Error('lab_timetable_not_found');
 return rows[0];
}
async function change(conn,dbName,id,desired,{onBeforeLock,onBeforeCommit,timeout=0}={}){
 requireId(id);
 const next=desired==null?null:{...normalizeLesson(desired),subject:assertSubject(desired.subject)};
 // Read BEFORE locks, then re-read current row under SELECT FOR UPDATE to
 // detect changes since the observation. Never trust a stale old-row snapshot.
 const observed=await readRow(conn,id);
 const old=normalizeRow(observed);
 if(onBeforeLock)await onBeforeLock(); // lab-only hook for stale-read test
 const keys=unionKeys(dbName,old,next);
 let held=[],began=false,failure=null,result=null;
 try{
  held=await acquireSet(conn,keys,{timeout});
  await conn.beginTransaction();began=true;
  const current=await readRow(conn,id,READ_LOCKED);
  if(signature(current)!==signature(observed))
   throw Error('lab_timetable_stale_snapshot');
  if(next){
   if(next.active===1){
    const [conflicts]=await conn.execute(PRECHECK,[
     id,next.day_of_week,next.classroom_id,next.teacher_user_id,
     next.end_period,next.period
    ]);
    if(conflicts.length)throw conflictError();
   }
   const [wrote]=await conn.execute(UPDATE,[
    next.classroom_id,next.teacher_user_id,next.day_of_week,next.period,
    desired.end_period==null?null:next.end_period,next.subject,next.active,id
   ]);
   if(Number(wrote?.affectedRows)!==1)throw Error('lab_update_not_applied');
  }else{
   const [removed]=await conn.execute(DELETE,[id]);
   if(Number(removed?.affectedRows)!==1)throw Error('lab_delete_not_applied');
  }
  if(onBeforeCommit)await onBeforeCommit(); // deterministic interleaving only
  await conn.commit();began=false;
  result={id,operation:next?'update':'delete',lock_count:held.length};
 }catch(e){
  failure=e;
  if(began){
   try{await conn.rollback()}catch(err){
    failure=Error('lab_timetable_rollback_failed',{cause:err});
   }
  }
 }finally{
  if(held.length){
   try{await releaseSet(conn,held)}catch(err){
    failure=Error('lab_timetable_lock_release_failed',{cause:err});
   }
  }
 }
 if(failure)throw failure;
 return result;
}
const coordinatedUpdate=(conn,db,id,next,options)=>change(conn,db,id,next,options);
const coordinatedDelete=(conn,db,id,options)=>change(conn,db,id,null,options);
module.exports={READ,READ_LOCKED,PRECHECK,UPDATE,DELETE,requireId,normalizeRow,
 signature,unionKeys,acquireSet,releaseSet,change,coordinatedUpdate,coordinatedDelete};
