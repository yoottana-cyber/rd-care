'use strict';
// RD CONNECT stage 7.12: TWO-CONNECTION lab integration test of a locked
// timetable INSERT transaction. Fake staff + classroom fixtures are committed,
// so both sessions can reference them. ALL timetable writes are deleted by
// exact synthetic classroom IDs and both fixtures removed during cleanup.
// Never run against school database or public API; DDL is NOT performed.
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {classifyTimetableDbError}=require('../src/timetable-write-coordination.cjs');
const {coordinatedInsert}=require('../src/timetable-locked-insert.cjs');
const {seed}=require('./check-lab-timetable-race.cjs');
const {category}=require('./check-db.cjs');

const OPT_IN='RUN_LAB_TIMETABLE_WRITE_7_12';
function need(ok,key){if(!ok)throw Error('lab_'+key)}
const lesson=(room,teacher,day,start,end,subject)=>({
 classroom_id:room,teacher_user_id:teacher,day_of_week:day,
 period:start,end_period:end,active:1,subject
});
async function cleanup(conn,ids){
 need(ids&&ids.rooms?.length===2&&ids.teachers?.length===2,
  'seed_ids_incomplete');
 let active=false;
 try{
  await conn.beginTransaction();active=true;
  // All 63 tables were checked EMPTY before seeding. Delete only fixture
  // classroom IDs, not all timetable rows or any real school records.
  await conn.execute('DELETE FROM timetable WHERE classroom_id IN (?,?)',ids.rooms);
  await conn.execute('DELETE FROM classrooms WHERE id IN (?,?)',ids.rooms);
  await conn.execute('DELETE FROM users WHERE id IN (?,?)',ids.teachers);
  await conn.commit();active=false;
 }finally{if(active)await conn.rollback()}
}
async function expectResult(conn,input,expected){
 let returned=null,error=null;
 try{returned=await coordinatedInsert(conn,LAB_DATABASE,input)}
 catch(e){error=e}
 const actual=error?classifyTimetableDbError(error):'inserted';
 need(actual===expected,'unexpected_'+expected+'_outcome');
 return {result:actual,id:returned?.id??null};
}
async function verifyPersistentRows(conn,expected){
 const [records]=await conn.execute(
  'SELECT COUNT(*) AS n FROM timetable WHERE subject LIKE ?',
  ['Synthetic Lab7.12:%']
 );
 need(records.length===1&&Number(records[0].n)===expected,
  'committed_row_count');
}
async function runChecks(a,b,ids){
 const baseRoom=lesson(ids.rooms[0],ids.teachers[0],1,1,2,
  'Synthetic Lab7.12: room owner');
 const roomOverlap=lesson(ids.rooms[0],ids.teachers[1],1,2,3,
  'Synthetic Lab7.12: same room overlap');
 const adjacent=lesson(ids.rooms[0],ids.teachers[1],1,3,3,
  'Synthetic Lab7.12: adjacent');
 const baseTeacher=lesson(ids.rooms[0],ids.teachers[0],2,4,5,
  'Synthetic Lab7.12: teacher owner');
 const teacherOverlap=lesson(ids.rooms[1],ids.teachers[0],2,5,6,
  'Synthetic Lab7.12: same teacher overlap');
 const observed=[];
 for(const [variant,first,second] of [
  ['same_room',baseRoom,roomOverlap],['same_teacher',baseTeacher,teacherOverlap]
 ]){
  let blocked=false;
  const saved=await coordinatedInsert(a,LAB_DATABASE,first,{
   onBeforeCommit:async()=>{
    const reply=await expectResult(b,second,'busy_retry_new_transaction');
    need(reply.id===null,'second_write_occured_during_lock');
    blocked=true;
   }
  });
  need(blocked&&Number(saved.id)>0,'first_commit_missing');
  const retried=await expectResult(b,second,'overlap');
  observed.push({case:variant,blocked_before_commit:blocked,
   committed_first_write:true,retry_after_commit:retried.result});
 }
 const third=await expectResult(b,adjacent,'inserted');
 need(Number(third.id)>0,'adjacent_not_inserted');
 await verifyPersistentRows(a,3); // 2 owned lessons + adjacent
 return {
  database:LAB_DATABASE,coordinated_cases:observed,
  adjacent_insert_after_commit:true,
  committed_test_rows:3,invalid_rows_committed:0,
  production_safe:false
 };
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,a,b,ids=null,seedAttempted=false,cleaned=false,report=null,error=null;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_WRITE!==OPT_IN)
   throw Error('lab_explicit_write_approval_required');
  const cfg=getLabConfig(env);
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...cfg,connectionLimit:2,queueLimit:2});
  a=await pool.getConnection();
  await inspectSet(a,5);
  await assertEmpty(a);
  b=await pool.getConnection();
  const [[db]]=await b.execute('SELECT DATABASE() AS db');
  need(db?.db===LAB_DATABASE,'second_connection_wrong_database');
  const [[idA]]=await a.execute('SELECT CONNECTION_ID() AS n');
  const [[idB]]=await b.execute('SELECT CONNECTION_ID() AS n');
  need(idA?.n!=null&&idB?.n!=null&&String(idA.n)!==String(idB.n),
   'distinct_sessions_required');
  seedAttempted=true;
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
  warn('STEP 7.12 FAILED ('+(message.startsWith('lab_')?message:category(error))+').');
  if(seedAttempted&&!cleaned)
   warn('MANUAL LAB INSPECTION REQUIRED: committed synthetic timetable/fixture rows may remain. Do not retry or bulk-delete.');
  return 1;
 }
 log('STEP 7.12 LOCKED INSERT OK: two sessions serialized writes and checked overlapping periods after commit.');
 log('SAME ROOM + SAME TEACHER: busy while first write in progress, then overlap rejected on retry after release.');
 log('ADJACENT PERIOD ALLOWED: valid nonoverlapping lesson inserted after lock release.');
 log('LAB CLEANUP VERIFIED: three committed synthetic lessons and their fixtures deleted; all 63 tables empty.');
 log('LAB STATUS: '+JSON.stringify({...report,installed_triggers:5,cleanup_verified:true}));
 log('NOT PRODUCTION READY: UPDATE/DELETE writers, retries, and connection lifecycle still require integration tests.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.12 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,lesson,cleanup,expectResult,verifyPersistentRows,runChecks,run};
