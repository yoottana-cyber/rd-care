'use strict';
// Stage 6.4 DB integration test: staff + student + guardian login service
// in one transaction on a pristine InnoDB staging DB, with full ROLLBACK.
// This does NOT expose the auth service over HTTP or import user records.
const {openPool}=require('../src/database.cjs');
const {category}=require('./check-db.cjs');
const {preflight}=require('./check-auth-transaction.cjs');
const {d1PasswordHash}=require('../src/d1-password-compat.cjs');
const {login,me,logout}=require('../src/staging-auth-service.cjs');
const {randomBytes}=require('node:crypto');
const REQUIRED_EMPTY=['classrooms','portal_sessions','login_attempts','portal_login_attempts','student_affairs_assignments'];
function randomUsername(){return 'rdst_'+randomBytes(12).toString('hex')}
function makeAccount(){
 return {username:randomUsername(),password:randomBytes(28).toString('hex'),
  salt:'rd2$'+randomBytes(16).toString('hex')};
}
async function preflightAuth(conn){
 await preflight(conn);
 for(const table of REQUIRED_EMPTY){
  // Hard-coded names only (no input interpolation).
  const [rows]=await conn.execute('SELECT 1 FROM `'+table+'` LIMIT 1');
  if(rows.length)throw new Error('staging_database_not_empty');
 }
 const [meta]=await conn.execute(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('classrooms','portal_sessions','login_attempts','portal_login_attempts','student_affairs_assignments')"
 );
 if(meta.length!==REQUIRED_EMPTY.length||meta.some(row=>String(row.ENGINE).toUpperCase()!=='INNODB'))
  throw new Error('staging_innodb_required');
}
async function assertRejected(fn,status){
 try{await fn()}catch(e){if(e?.status===status)return;throw new Error('unexpected_auth_error_status')}
 throw new Error('unexpected_auth_success');
}
async function checkAuth(conn){
 await preflightAuth(conn);
 const staff=makeAccount(),student=makeAccount(),guardian=makeAccount();
 const staffHash=await d1PasswordHash(staff.password,staff.salt);
 const studentHash=await d1PasswordHash(student.password,student.salt);
 const guardianHash=await d1PasswordHash(guardian.password,guardian.salt);
 let started=false;
 try{
  await conn.beginTransaction();started=true;
  const [teacher]=await conn.execute(
   "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES (?,?,'teacher',?,?,1)",
   [staff.username,'Staging Teacher',staff.salt,staffHash]
  );
  const [room]=await conn.execute(
   'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES (?,?,?,?)',
   [1,1,'TEST-'+randomBytes(8).toString('hex'),teacher.insertId]
  );
  const [pupil]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES (?,?,?,?,1)',
   ['STAGE-'+randomBytes(7).toString('hex'),room.insertId,1,'Synthetic Pupil']
  );
  await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES (?,?,'student',?,?,?,?,?)",
   [student.username,'Synthetic Student',pupil.insertId,student.salt,studentHash,1,teacher.insertId]
  );
  await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES (?,?,'guardian',NULL,?,?,1,?)",
   [guardian.username,'Synthetic Guardian',guardian.salt,guardianHash,teacher.insertId]
  );

  await assertRejected(()=>login(conn,{kind:'staff',body:{username:staff.username,password:'bad-password'}}),401);
  const staffSession=await login(conn,{kind:'staff',body:{username:staff.username,password:staff.password,remember:false}});
  if(staffSession.user?.role!=='teacher'||staffSession.expires_in!==28800)throw new Error('staff_login_failed');
  const staffAuth={kind:'staff',authorization:'Bearer '+staffSession.token};
  const staffMe=await me(conn,staffAuth);
  if(staffMe.user?.role!=='teacher'||staffMe.user.student_affairs!==0)throw new Error('staff_session_failed');
  await assertRejected(()=>me(conn,{kind:'portal',authorization:staffAuth.authorization}),401);
  await logout(conn,staffAuth);
  await assertRejected(()=>me(conn,staffAuth),401);

  await assertRejected(()=>login(conn,{kind:'portal',body:{username:student.username,password:student.password,role:'guardian'}}),401);
  const studentSession=await login(conn,{kind:'portal',body:{username:student.username,password:student.password,role:'student',remember:true}});
  if(studentSession.account?.role!=='student'||studentSession.expires_in!==2592000)throw new Error('student_login_failed');
  const studentMe=await me(conn,{kind:'portal',authorization:'Bearer '+studentSession.token});
  if(studentMe.account?.role!=='student')throw new Error('student_session_failed');

  const guardianSession=await login(conn,{kind:'portal',body:{username:guardian.username,password:guardian.password,role:'guardian'}});
  if(guardianSession.account?.role!=='guardian'||guardianSession.expires_in!==28800)throw new Error('guardian_login_failed');
  const guardianAuth={kind:'portal',authorization:'Bearer '+guardianSession.token};
  if((await me(conn,guardianAuth)).account?.role!=='guardian')throw new Error('guardian_session_failed');
  await logout(conn,guardianAuth);
  await assertRejected(()=>me(conn,guardianAuth),401);
 }finally{
  if(started)await conn.rollback();
 }
 // Confirm the fake identities and sessions are fully absent after ROLLBACK.
 for(const [table,name] of [['users',staff.username],['portal_accounts',student.username],['portal_accounts',guardian.username]]){
  const [rows]=await conn.execute('SELECT 1 FROM `'+table+'` WHERE username=? LIMIT 1',[name]);
  if(rows.length)throw new Error('staging_rollback_failed');
 }
 for(const table of ['sessions','portal_sessions']){
  const [rows]=await conn.execute('SELECT 1 FROM `'+table+'` LIMIT 1');
  if(rows.length)throw new Error('staging_rollback_failed');
 }
 return true;
}
async function run({makePool=openPool,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  pool=makePool(process.env);conn=await pool.getConnection();
  await checkAuth(conn);
  log('STEP 6.4 OK: teacher, student and guardian login/session flows passed on the staging MariaDB.');
  log('ROLLBACK VERIFIED: all synthetic teacher/student/guardian records and sessions removed.');
  log('PUBLIC API DISABLED: tests ran inside Node.js only; no real accounts or website changes.');
  return 0;
 }catch(e){
  const detail=String(e?.message||'');
  warn('STEP 6.4 FAILED ('+(detail.startsWith('staging_')?detail:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{console.error('STEP 6.4 FAILED (unknown).');process.exitCode=1});
module.exports={preflightAuth,checkAuth,run};
