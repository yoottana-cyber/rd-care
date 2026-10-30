'use strict';
// RD CONNECT step 7.13: two-connection actual MariaDB UPDATE and DELETE test.
// Strictly isolated ratsadaa_trgtest with explicit opt-in. Fake fixtures and
// timetable rows temporarily COMMITTED. All rows cleaned by fixture IDs.
// No public APIs, real school data, or DDL. Do not blindly rerun on failure.
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {classifyTimetableDbError}=require('../src/timetable-write-coordination.cjs');
const {coordinatedInsert}=require('../src/timetable-locked-insert.cjs');
const {coordinatedUpdate,coordinatedDelete}=require('../src/timetable-locked-update-delete.cjs');
const {seed}=require('./check-lab-timetable-race.cjs');
const {cleanup}=require('./check-lab-timetable-locked-inserts.cjs');
const {category}=require('./check-db.cjs');

const OPT_IN='RUN_LAB_TIMETABLE_UPDATE_DELETE_7_13';
const need=(v,k)=>{if(!v)throw Error('lab_'+k)};
const makeLesson=(room,teacher,day,start,end,subject)=>({
 classroom_id:room,teacher_user_id:teacher,day_of_week:day,
 period:start,end_period:end,subject,active:1
});
async function expectAttempt(thunk,expected){
 let outcome='ok',returned=null;
 try{returned=await thunk()}catch(e){
  if(e.message==='lab_timetable_stale_snapshot')outcome='stale';
  else outcome=classifyTimetableDbError(e);
  if(outcome==='other_error')throw e;
 }
 need(outcome===expected,'unexpected_'+expected+'_outcome');
 return {result:outcome,id:returned?.id??null};
}
async function getLesson(conn,id){
 const [r]=await conn.execute(
  'SELECT classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active FROM timetable WHERE id=?',
  [id]
 );
 need(r.length===1,'expected_lesson_missing');
 return r[0];
}
async function countLessons(conn,ids){
 const [[row]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM timetable WHERE classroom_id IN (?,?)',ids.rooms
 );
 return Number(row?.n);
}
async function runChecks(a,b,ids){
 const old=makeLesson(ids.rooms[0],ids.teachers[0],1,1,2,'Synthetic Lab7.13: original');
 const next=makeLesson(ids.rooms[1],ids.teachers[1],1,2,3,'Synthetic Lab7.13: moved');
 const occupied=makeLesson(ids.rooms[1],ids.teachers[1],1,5,6,'Synthetic Lab7.13: occupied');
 const oldReplacement=makeLesson(ids.rooms[0],ids.teachers[0],1,1,2,'Synthetic Lab7.13: old slot');
 const newConflict=makeLesson(ids.rooms[1],ids.teachers[1],1,3,4,'Synthetic Lab7.13: new slot conflict');

 const [origin,second]=await Promise.all([
  coordinatedInsert(a,LAB_DATABASE,old),
  coordinatedInsert(b,LAB_DATABASE,occupied)
 ]);
 let oldLocked=false,newLocked=false;
 const moved=await coordinatedUpdate(a,LAB_DATABASE,origin.id,next,{
  onBeforeCommit:async()=>{
   oldLocked=(await expectAttempt(
    ()=>coordinatedInsert(b,LAB_DATABASE,oldReplacement),
    'busy_retry_new_transaction')).result==='busy_retry_new_transaction';
   newLocked=(await expectAttempt(
    ()=>coordinatedInsert(b,LAB_DATABASE,newConflict),
    'busy_retry_new_transaction')).result==='busy_retry_new_transaction';
  }
 });
 need(oldLocked&&newLocked&&moved.lock_count>=2,'old_new_lock_not_held');
 const restored=await expectAttempt(
  ()=>coordinatedInsert(b,LAB_DATABASE,oldReplacement),'ok');
 need(restored.id>0,'old_slot_not_available_after_move');
 await expectAttempt(()=>coordinatedInsert(b,LAB_DATABASE,newConflict),'overlap');

 const occupiedMove={...next,period:5,end_period:6,subject:'Synthetic Lab7.13: invalid move'};
 await expectAttempt(()=>coordinatedUpdate(a,LAB_DATABASE,origin.id,occupiedMove),'overlap');
 const [current]=await a.execute(
  'SELECT period,end_period,classroom_id,teacher_user_id FROM timetable WHERE id=?',[origin.id]
 );
 need(current.length===1&&Number(current[0].period)===2&&
  Number(current[0].classroom_id)===ids.rooms[1],
  'conflicting_update_modified_row');

 // A protected UPDATE must also reject a stale pre-lock observation.
 const movedOld={...oldReplacement,period:7,end_period:8,
  subject:'Synthetic Lab7.13: re-scheduled by B'};
 const staleTarget={...oldReplacement,period:4,end_period:4,
  subject:'Synthetic Lab7.13: stale attempt'};
 let peerChanged=false;
 const stale=await expectAttempt(
  ()=>coordinatedUpdate(a,LAB_DATABASE,restored.id,staleTarget,{
   onBeforeLock:async()=>{
    const changed=await coordinatedUpdate(b,LAB_DATABASE,restored.id,movedOld);
    peerChanged=changed.operation==='update';
   }
  }),'stale');
 need(peerChanged&&stale.result==='stale','stale_row_not_detected');

 let deleteLocked=false;
 const deleted=await coordinatedDelete(a,LAB_DATABASE,origin.id,{
  onBeforeCommit:async()=>{
   deleteLocked=(await expectAttempt(
    ()=>coordinatedInsert(b,LAB_DATABASE,newConflict),
    'busy_retry_new_transaction')).result==='busy_retry_new_transaction';
  }
 });
 need(deleteLocked&&deleted.operation==='delete','deleted_lesson_not_locked');
 const replacement=await expectAttempt(
  ()=>coordinatedInsert(b,LAB_DATABASE,newConflict),'ok');
 need(replacement.id>0,'deleted_slot_not_reusable');

 const after=await countLessons(a,ids);
 need(after===3,'final_timetable_row_count');
 const [missing]=await a.execute('SELECT id FROM timetable WHERE id=?',[origin.id]);
 need(missing.length===0,'deleted_row_still_present');
 const updatedOld=await getLesson(a,restored.id);
 need(Number(updatedOld.period)===7&&Number(updatedOld.end_period)===8,
  'peer_reschedule_missing');
 return {database:LAB_DATABASE,old_and_new_locks_verified:true,
  old_slot_reusable_after_move:true,overlap_update_rejected:true,
  stale_snapshot_update_rejected:true,delete_lock_verified:true,
  deleted_slot_reusable:true,final_synthetic_lessons:after,
  production_safe:false};
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,a,b,ids=null,seedStarted=false,cleaned=false,report=null,error=null;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_WRITE!==OPT_IN)
   throw Error('lab_explicit_write_approval_required');
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:2,queueLimit:2});
  a=await pool.getConnection();
  await inspectSet(a,5);
  await assertEmpty(a);
  b=await pool.getConnection();
  const [[db]]=await b.execute('SELECT DATABASE() AS db');
  need(db?.db===LAB_DATABASE,'peer_wrong_database');
  const [[left]]=await a.execute('SELECT CONNECTION_ID() AS n');
  const [[right]]=await b.execute('SELECT CONNECTION_ID() AS n');
  need(left?.n!=null&&right?.n!=null&&String(left.n)!==String(right.n),
   'distinct_connections_required');
  seedStarted=true;
  ids=await seed(a);
  try{report=await runChecks(a,b,ids)}catch(e){error=e}
 }catch(e){error=e}
 finally{
  if(b){try{await b.rollback()}catch{}}
  if(a){try{await a.rollback()}catch{}}
  if(ids&&a){
   try{
    await cleanup(a,ids);
    await assertEmpty(a);
    await inspectSet(a,5);
    cleaned=true;
   }catch{cleaned=false}
  }
  if(b){try{b.release()}catch{}}
  if(a){try{a.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
 if(error||!report||!cleaned){
  const message=String(error?.message||'');
  warn('STEP 7.13 FAILED ('+(message.startsWith('lab_')?message:category(error))+').');
  if(seedStarted&&!cleaned)
   warn('MANUAL LAB INSPECTION REQUIRED: fake committed records may remain; do not rerun or bulk-delete.');
  return 1;
 }
 log('STEP 7.13 LOCKED UPDATE/DELETE OK: old/new resources locked and stale rows rejected.');
 log('UPDATE: old/new slots busy during change; conflict rejected; old slot reusable after move.');
 log('DELETE: old slot busy until commit; reuse allowed afterward.');
 log('LAB CLEANUP VERIFIED: all committed synthetic lessons and fixtures deleted; all 63 tables empty, 5 triggers unchanged.');
 log('LAB STATUS: '+JSON.stringify({...report,installed_triggers:5,cleanup_verified:true}));
 log('NOT PRODUCTION READY: public API, complete retry policy and connection lifecycle remain unintegrated.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.13 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,makeLesson,expectAttempt,getLesson,countLessons,cleanup,runChecks,run};
