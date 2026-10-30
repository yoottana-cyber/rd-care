'use strict';
// Stage 7.9: rollback-only real MariaDB test of timetable_clash_insert/update.
// Synthetic teachers/rooms and lessons only; no school records or API changes.
const {randomBytes}=require('node:crypto');
const {category}=require('./check-db.cjs');
const {getLabConfig}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');

const unique=prefix=>prefix+'_'+randomBytes(12).toString('hex');
function requireTest(ok,key){if(!ok)throw Error('lab_test_'+key)}
async function expectOverlap(conn,sql,params,label){
 let caught=false;
 try{await conn.execute(sql,params)}catch(e){
  caught=(e?.sqlState==='45000'||e?.errno===1644)&&
   (e?.sqlMessage==='TIMETABLE_OVERLAP'||String(e?.message||'').includes('TIMETABLE_OVERLAP'));
  if(!caught)throw e;
 }
 requireTest(caught,label+'_not_rejected');
}
async function test(conn){
 await inspectSet(conn,5);
 await assertEmpty(conn);
 let inTransaction=false;
 try{
  await conn.beginTransaction();
  inTransaction=true;
  const teachers=[];
  for(const t of ['A','B']){
   const [result]=await conn.execute(
    "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,'teacher',?,?,1)",
    [unique('labt'), 'Synthetic Lab Teacher '+t, 'fake-salt', 'fake-hash']
   );
   teachers.push(result.insertId);
  }
  const rooms=[];
  for(const [i,t] of teachers.entries()){
   const [room]=await conn.execute(
    'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,?,?,?)',
    [i+1,unique('LAB'),t]
   );
   rooms.push(room.insertId);
  }
  // A's 1-2 lesson occupies both periods. Intentionally distinct start
  // periods avoid the pre-existing classroom/day/start UNIQUE index.
  const [baseline]=await conn.execute(
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active) VALUES(?,?,1,1,2,'Synthetic Math',1)",
   [rooms[0],teachers[0]]
  );
  // Same room, different teacher — overlap on period 2 must be rejected.
  await expectOverlap(conn,
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active) VALUES(?,?,1,2,NULL,'Room Collision',1)",
   [rooms[0],teachers[1]],'same_room_overlap');
  // Same teacher, different room — also rejected.
  await expectOverlap(conn,
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active) VALUES(?,?,1,2,NULL,'Teacher Collision',1)",
   [rooms[1],teachers[0]],'same_teacher_overlap');
  // Adjacent periods do not overlap: period 3 follows an inclusive 1-2.
  const [adjacent]=await conn.execute(
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active) VALUES(?,?,1,3,NULL,'Adjacent',1)",
   [rooms[0],teachers[1]]
  );
  requireTest(Number(adjacent.insertId)>0,'adjacent_period');
  // A different weekday permits the same teacher + different classroom.
  const [nextDay]=await conn.execute(
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active) VALUES(?,?,2,1,NULL,'Different Day',1)",
   [rooms[1],teachers[0]]
  );
  requireTest(Number(nextDay.insertId)>0,'different_day');
  // Inactive overlapping lesson is permitted, but activating it is not.
  const [inactive]=await conn.execute(
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,active) VALUES(?,?,1,2,NULL,'Inactive',0)",
   [rooms[1],teachers[0]]
  );
  await expectOverlap(conn,'UPDATE timetable SET active=1 WHERE id=?',
   [inactive.insertId],'activate_clash');
  // Changing only the subject is allowed, and UPDATE excludes its own id.
  await conn.execute('UPDATE timetable SET subject=? WHERE id=?',
   ['Synthetic Math Edited',baseline.insertId]);
  const [unchanged]=await conn.execute('SELECT subject FROM timetable WHERE id=?',[baseline.insertId]);
  requireTest(unchanged.length===1&&unchanged[0].subject==='Synthetic Math Edited','self_update');
  // Moving a lesson from period 3 to 2 makes its teacher conflict with
  // the existing room-B inactive row? Inactive rows are ignored, but the
  // room-A baseline spans period 2, so this update must be rejected.
  await expectOverlap(conn,'UPDATE timetable SET period=? WHERE id=?',
   [2,adjacent.insertId],'update_period_collision');
  // Changing a different-day lesson to the original weekday also overlaps
  // on the same teacher; the original baseline occupies p1-2.
  await expectOverlap(conn,'UPDATE timetable SET day_of_week=1 WHERE id=?',
   [nextDay.insertId],'update_day_teacher_collision');
  const [rows]=await conn.execute('SELECT COUNT(*) AS n FROM timetable');
  requireTest(Number(rows[0].n)===4,'expected_four_valid_lessons');
 }finally{
  if(inTransaction)await conn.rollback();
 }
 await assertEmpty(conn);
 await inspectSet(conn,5);
 return {database:'ratsadaa_trgtest',installed_triggers:5,timetable_triggers:2,
  same_room_overlap_rejected:true,same_teacher_overlap_rejected:true,
  adjacent_lessons_allowed:true,different_day_allowed:true,
  inactive_overlap_allowed:true,activation_conflict_rejected:true,
  self_update_allowed:true,period_update_overlap_rejected:true,
  weekday_update_overlap_rejected:true,rollback_verified:true};
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool(getLabConfig(env));
  conn=await pool.getConnection();
  const report=await test(conn);
  log('STEP 7.9 TEST OK: both original D1 timetable overlap triggers passed MariaDB synthetic cases.');
  log('ROLLBACK VERIFIED: all 63 lab tables are empty.');
  log('LAB STATUS: '+JSON.stringify(report));
  log('PRODUCTION BLOCKED: simultaneous timetable writes and period range validation remain unverified.');
  return 0;
 }catch(e){
  const msg=String(e?.message||'');
  warn('STEP 7.9 TEST FAILED ('+(msg.startsWith('lab_')?msg:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.9 TEST FAILED (unknown).');process.exitCode=1;
});
module.exports={test,run,expectOverlap};
