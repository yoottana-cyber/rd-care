'use strict';
// RD CONNECT stage 7.12: PROTOTYPE of one coordinated timetable INSERT.
// Not called by app routes. All writers (including UPDATE and DELETE) must
// adopt compatible locks before claiming concurrency safety.
// Lock BEFORE BEGIN; precheck AFTER BEGIN; COMMIT/ROLLBACK BEFORE RELEASE.
// Do not invoke inside an existing transaction or on a shared connection.
const {
 normalizeLesson,lockNames,acquireNamedLocks,releaseNamedLocks
}=require('./timetable-write-coordination.cjs');

const PRECHECK=`SELECT id FROM timetable
 WHERE active=1 AND day_of_week=?
   AND (classroom_id=? OR teacher_user_id=?)
   AND period <= ?
   AND COALESCE(end_period,period) >= ?
 LIMIT 1`;
const INSERT=`INSERT INTO timetable
(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active)
VALUES(?,?,?,?,?,?,?)`;
function assertSubject(input){
 if(typeof input!=='string'||!input.trim()||input.length>150)
  throw Error('lab_invalid_subject');
 return input.trim();
}
function conflictError(){
 const e=Error('lab_timetable_overlap');
 e.sqlState='45000';e.errno=1644;e.sqlMessage='TIMETABLE_OVERLAP';
 return e;
}
async function coordinatedInsert(conn,dbName,input,{onBeforeCommit,timeout=0}={}){
 const lesson=normalizeLesson(input);
 const subject=assertSubject(input.subject);
 // All input validation occurs before GET_LOCK, BEGIN, or any SQL.
 const names=lockNames(dbName,lesson);
 let held=[],started=false,primaryError=null,result=null;
 try{
  held=await acquireNamedLocks(conn,names,{timeout});
  await conn.beginTransaction();started=true;
  const [conflicts]=await conn.execute(PRECHECK,[
   lesson.day_of_week,lesson.classroom_id,lesson.teacher_user_id,
   lesson.end_period,lesson.period
  ]);
  if(lesson.active===1&&conflicts.length>0)throw conflictError();
  const [created]=await conn.execute(INSERT,[
   lesson.classroom_id,lesson.teacher_user_id,lesson.day_of_week,
   lesson.period,input.end_period==null?null:lesson.end_period,
   subject,lesson.active
  ]);
  if(!Number.isSafeInteger(Number(created?.insertId))||Number(created.insertId)<1)
   throw Error('lab_insert_id_missing');
  // Hook is ONLY for deterministic lab interleavings in step 7.12.
  if(onBeforeCommit)await onBeforeCommit();
  await conn.commit();started=false;
  result={id:created.insertId,lock_count:held.length};
 }catch(e){
  primaryError=e;
  if(started){
   try{await conn.rollback()}catch(rollbackError){
    // Unknown commit state. Caller must discard this connection, not retry.
    primaryError=Error('lab_timetable_rollback_failed',{cause:rollbackError});
   }
  }
 }finally{
  if(held.length){
   try{await releaseNamedLocks(conn,held)}catch(releaseError){
    // Never hide lock release failures — pooled connection is unsafe.
    primaryError=Error('lab_timetable_lock_release_failed',{cause:releaseError});
   }
  }
 }
 if(primaryError)throw primaryError;
 return result;
}
module.exports={PRECHECK,INSERT,assertSubject,conflictError,coordinatedInsert};
