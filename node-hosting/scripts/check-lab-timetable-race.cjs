'use strict';
// RD CONNECT step 7.10 — two-connection overlapping timetable INSERT diagnostic.
// ISOLATED ratsadaa_trgtest ONLY. Requires exact opt-in and all 63 tables empty.
// Creates fake teachers/rooms, commits them for cross-connection visibility,
// then attempts overlapping timetables in two concurrent transactions.
// Timetable writes are ALWAYS ROLLED BACK. Cleanup deletes only seeded IDs.
// A crash can strand fake teachers/rooms: stop and inspect lab before retry.
// NEVER use real school data, public API, D1 or ratsadaa_connect.
const {randomBytes}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {category}=require('./check-db.cjs');

const OPT_IN='RUN_LAB_TIMETABLE_RACE_7_10';
const unique=p=>p+'_'+randomBytes(10).toString('hex');
const need=(v,k)=>{if(!v)throw Error('lab_'+k)};
const LESSON_SQL=`INSERT INTO timetable
(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active)
VALUES (?,?,1,?,?,?,1)`;

function classifyInsert(error){
 if((error?.sqlState==='45000'||error?.errno===1644)&&
   (error?.sqlMessage==='TIMETABLE_OVERLAP'||String(error?.message||'').includes('TIMETABLE_OVERLAP')))
  return 'TRIGGER_REJECTED';
 if(error?.errno===1205||error?.code==='ER_LOCK_WAIT_TIMEOUT')return 'LOCK_WAIT_TIMEOUT';
 if(error?.errno===1213||error?.code==='ER_LOCK_DEADLOCK')return 'DEADLOCK';
 throw error;
}
async function seed(conn){
 const ids={teachers:[],rooms:[]};
 let started=false;
 try{
  await conn.beginTransaction();started=true;
  for(let i=0;i<2;i++){
   const [teacher]=await conn.execute(
    "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,'teacher',?,?,1)",
    [unique('labt'),'Synthetic Timetable Race Teacher '+i,'fake-salt','fake-hash']
   );
   ids.teachers.push(teacher.insertId);
  }
  for(let i=0;i<2;i++){
   const [room]=await conn.execute(
    'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,?,?,?)',
    [i+1,unique('LAB'),ids.teachers[i]]
   );
   ids.rooms.push(room.insertId);
  }
  // This commit is needed for the peer to reference synthetic FK rows.
  await conn.commit();started=false;
  return ids;
 }finally{if(started)await conn.rollback()}
}
async function cleanup(conn,ids){
 if(!ids||ids.rooms?.length!==2||ids.teachers?.length!==2)
  throw Error('lab_seed_ids_incomplete');
 let started=false;
 try{
  await conn.beginTransaction();started=true;
  await conn.execute('DELETE FROM classrooms WHERE id IN (?,?)',ids.rooms);
  await conn.execute('DELETE FROM users WHERE id IN (?,?)',ids.teachers);
  await conn.commit();started=false;
 }finally{if(started)await conn.rollback()}
}
async function oneRace(a,b,ids,variant){
 need(['same_room','same_teacher'].includes(variant),'race_variant_invalid');
 let aStarted=false,bStarted=false;
 try{
  await a.beginTransaction();aStarted=true;
  const left=variant==='same_room'
   ?[ids.rooms[0],ids.teachers[0],1,2,'Synthetic Room A']
   :[ids.rooms[0],ids.teachers[0],4,5,'Synthetic Teacher A'];
  const right=variant==='same_room'
   ?[ids.rooms[0],ids.teachers[1],2,3,'Synthetic Room B']
   :[ids.rooms[1],ids.teachers[0],5,6,'Synthetic Teacher B'];
  await a.execute(LESSON_SQL,left);
  // A's overlapping lesson remains uncommitted during B's INSERT.
  await b.beginTransaction();bStarted=true;
  let result='OVERLAP_ACCEPTED';
  try{await b.execute(LESSON_SQL,right)}
  catch(e){result=classifyInsert(e)}
  return {case:variant,second_insert_result:result,
   overlap_temporarily_accepted:result==='OVERLAP_ACCEPTED',
   first_insert_was_uncommitted:true,
   production_safe:false};
 }finally{
  // NEVER commit either timetable transaction, regardless of result.
  if(bStarted)await b.rollback();
  if(aStarted)await a.rollback();
 }
}
async function diagnose(a,b,ids){
 await a.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await b.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await a.query('SET SESSION innodb_lock_wait_timeout=4');
 await b.query('SET SESSION innodb_lock_wait_timeout=4');
 const results=[];
 for(const name of ['same_room','same_teacher']){
  results.push(await oneRace(a,b,ids,name));
 }
 return results;
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,a,b,ids=null,seedAttempted=false,cleaned=false,report=null,testError=null;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_RACE!==OPT_IN)
   throw Error('lab_explicit_race_approval_required');
  const config=getLabConfig(env); // exact lab name and distinct credentials
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...config,connectionLimit:2,queueLimit:2});
  a=await pool.getConnection();
  await inspectSet(a,5);
  await assertEmpty(a);
  b=await pool.getConnection();
  const [[db]]=await b.execute('SELECT DATABASE() AS db');
  need(db?.db===LAB_DATABASE,'second_connection_wrong_database');
  const [[idA]]=await a.execute('SELECT CONNECTION_ID() AS n');
  const [[idB]]=await b.execute('SELECT CONNECTION_ID() AS n');
  need(idA?.n!=null&&idB?.n!=null&&String(idA.n)!==String(idB.n),
   'two_distinct_connections_required');
  seedAttempted=true;
  ids=await seed(a);
  try{report=await diagnose(a,b,ids)}catch(e){testError=e}
 }catch(e){testError=e}
 finally{
  // Never let an outstanding timetable write survive cleanup.
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
 if(testError||!report||!cleaned){
  const msg=String(testError?.message||'');
  warn('STEP 7.10 FAILED ('+(msg.startsWith('lab_')?msg:category(testError))+').');
  if(seedAttempted&&!cleaned)
   warn('MANUAL LAB INSPECTION REQUIRED: synthetic committed teacher/room rows might remain. Do not retry or bulk-delete.');
  return 1;
 }
 const accepted=report.filter(x=>x.overlap_temporarily_accepted).map(x=>x.case);
 log('STEP 7.10 DIAGNOSTIC COMPLETE: two overlapping timetable transactions tested on separate MariaDB connections.');
 log('TIMETABLE RACE FINDING: '+(accepted.length?
  'OVERLAP_ACCEPTED_WHILE_OTHER_TRANSACTION_OPEN — concurrency weakness detected ('+accepted.join(', ')+').':
  'NO_OVERLAP_ACCEPTED_IN_THESE_CASES — full race-safety NOT proven.'));
 log('LAB CLEANUP VERIFIED: both timetable transactions rolled back; synthetic teachers/rooms deleted; 63 tables empty.');
 log('LAB STATUS: '+JSON.stringify({database:LAB_DATABASE,installed_triggers:5,
  results:report,cleanup_verified:true,production_safe:false}));
 log('PRODUCTION BLOCKED: test-only triggers need concurrency-safe locking plus period-range validation.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.10 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,LESSON_SQL,classifyInsert,seed,cleanup,oneRace,diagnose,run};
