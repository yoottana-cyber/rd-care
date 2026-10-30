'use strict';
// RD CONNECT: PRIVATE end-to-end Node auth -> school reads -> MariaDB.
// Runs ONLY as a CLI with synthetic test identities in the empty staging DB.
// No web listener, no actual student information, no API enablement.
// Every SQL write is inside one transaction, ALWAYS ROLLBACK.
const {randomBytes}=require('node:crypto');
const {openPool}=require('../src/database.cjs');
const {preflightAuth}=require('./check-auth-service.cjs');
const {d1PasswordHash}=require('../src/d1-password-compat.cjs');
const {makeReq,makeRes}=require('./check-auth-http.cjs');
const {handleIntegratedStaging}=require('../src/staging-integrated-http.cjs');
const {bangkokToday,weekday}=require('../src/attendance-write-contract.cjs');
const {category}=require('./check-db.cjs');
const id=()=>randomBytes(10).toString('hex');
const need=(ok,what)=>{if(!ok)throw Error('integrated_http_'+what)};
const people=()=>({
 username:'stage_'+id(),salt:'rd2$'+randomBytes(16).toString('hex'),
 password:randomBytes(24).toString('hex')
});
async function call(conn,method,url,body,authorization,expected){
 const req=makeReq(method,url,body,
  authorization?{authorization:'Bearer '+authorization}:{});
 const res=makeRes();
 await handleIntegratedStaging(req,res,{connection:conn});
 need(res.status===expected,'http_contract_mismatch');
 need(res.headers['Cache-Control']==='no-store'&&
  !res.headers['Access-Control-Allow-Origin'],'http_headers');
 const value=res.json();
 need(value&&typeof value==='object','http_response_invalid');
 if(expected!==200){
  need(!res.text.includes('stage_')&&!res.text.includes('Bearer '),
   'secret_leaked_to_error');
 }
 return value;
}
async function exercise(conn){
 await preflightAuth(conn);
 const teacher=people(),pupil=people(),guardian=people(),date=bangkokToday();
 const hashes=await Promise.all([teacher,pupil,guardian].map(
  a=>d1PasswordHash(a.password,a.salt)));
 let started=false;
 try{
  await conn.beginTransaction();started=true;
  const [t]=await conn.execute(
   "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES (?,'Synthetic Integrated Teacher','teacher',?,?,1)",
   [teacher.username,teacher.salt,hashes[0]]);
  const teacherId=Number(t.insertId);
  const [room]=await conn.execute(
   'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES (1,1,?,?)',
   ['INTEGRATED-'+id(),teacherId]);
  const roomId=Number(room.insertId);
  const [student]=await conn.execute(
   "INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,1,'Synthetic Integrated Pupil',1)",
   ['I-'+id(),roomId]);
  const studentId=Number(student.insertId);
  await conn.execute(
   "INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(?,?,1,'2020-01-01')",
   [studentId,roomId]);
  const [slot]=await conn.execute(
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject,active,approval_status) VALUES(?,?,?,?,?,'INT-1','Synthetic Integrated Subject',1,'approved')",
   [roomId,teacherId,weekday(date),1,1]);
  const timetableId=Number(slot.insertId);
  await conn.execute(
   "INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,'present',?)",
   [studentId,date,teacherId]);
  await conn.execute(
   "INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(?,?,?,'present',?)",
   [studentId,timetableId,date,teacherId]);
  await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,must_change_password,created_by) VALUES(?,'Synthetic Integrated Student','student',?,?,?,1,0,?)",
   [pupil.username,studentId,pupil.salt,hashes[1],teacherId]);
  const [g]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,must_change_password,created_by) VALUES(?,'Synthetic Integrated Guardian','guardian',NULL,?,?,1,0,?)",
   [guardian.username,guardian.salt,hashes[2],teacherId]);
  await conn.execute(
   'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
   [g.insertId,studentId,teacherId]);
  const staff=await call(conn,'POST','/api/auth/login',
   {username:teacher.username,password:teacher.password,remember:true},null,200);
  need(staff.user?.role==='teacher'&&staff.expires_in===2592000,'staff_login');
  const roomRows=await call(conn,'GET','/api/classrooms',null,staff.token,200);
  need(roomRows.items?.some(x=>Number(x.id)===roomId),'staff_room_scope');
  const roster=await call(conn,'GET',
   '/api/students?classroom_id='+roomId+'&date='+date,
   null,staff.token,200);
  need(roster.items?.length===1&&Number(roster.items[0].id)===studentId,
   'roster_missing');
  const daily=await call(conn,'GET',
   '/api/attendance/daily?classroom_id='+roomId+'&date='+date,
   null,staff.token,200);
  need(daily.items?.length===1&&daily.items[0].status==='present',
   'daily_attendance_missing');
  const period=await call(conn,'GET',
   '/api/attendance?kind=period&classroom_id='+roomId+
   '&date='+date+'&timetable_id='+timetableId,
   null,staff.token,200);
  need(period.items?.length===1&&period.items[0].status==='present'&&
   period.daily_read_only===true,'period_attendance_missing');
  const forbidden=await call(conn,'GET','/api/portal/children',
   null,staff.token,401);
  need(forbidden.ok===false,'staff_token_cross_portal');
  const st=await call(conn,'POST','/api/portal/auth/login',
   {username:pupil.username,password:pupil.password,role:'student',remember:true},
   null,200);
  need(st.account?.role==='student','student_login');
  const myChildren=await call(conn,'GET','/api/portal/children',
   null,st.token,200);
  need(myChildren.items?.length===1&&Number(myChildren.items[0].id)===studentId,
   'student_identity_scope');
  const gLogin=await call(conn,'POST','/api/portal/auth/login',
   {username:guardian.username,password:guardian.password,role:'guardian'},
   null,200);
  need(gLogin.account?.role==='guardian','guardian_login');
  const child=await call(conn,'GET','/api/portal/children',
   null,gLogin.token,200);
  need(child.items?.length===1&&Number(child.items[0].id)===studentId,
   'guardian_verified_link');
  const attendance=await call(conn,'GET',
   '/api/portal/attendance?student_id='+studentId+
   '&from='+date+'&to='+date,null,gLogin.token,200);
  need(attendance.daily?.length===1&&attendance.period?.length===1,
   'guardian_attendance_scope');
  await call(conn,'GET',
   '/api/portal/attendance?student_id='+(studentId+1)+
   '&from='+date+'&to='+date,null,gLogin.token,403);
  await call(conn,'GET','/api/classrooms',null,gLogin.token,401);
  const logout=await call(conn,'POST','/api/portal/auth/logout',
   null,gLogin.token,200);
  need(logout.ok===true,'guardian_logout');
  await call(conn,'GET','/api/portal/children',null,gLogin.token,401);
  return {synthetic:true,student_id:studentId,teacher_id:teacherId,
   guardian_id:Number(g.insertId),must_rollback:true};
 }finally{
  if(started)await conn.rollback();
 }
}
async function run({env=process.env,makePool=openPool,log=console.log,
 warn=console.error}={}){
 let pool,conn;
 try{
  // Only the empty, separate Node staging database, not live D1 or
  // the independent 5-trigger disposable SQL lab.
  need(env.RD_DB_NAME==='ratsadaa_connect','staging_only');
  need(!env.RD_MIGRATION_ALLOW_IMPORT&&!env.RD_ENABLE_SCHOOL_WRITES,
   'import_and_school_writes_blocked');
  pool=makePool(env);
  conn=await pool.getConnection();
  await exercise(conn);
  // Same preflight validates every essential auth/roster table is empty.
  await preflightAuth(conn);
  log('INTEGRATED HTTP MARIADB OK: staff, student and guardian token login to scoped school reads.');
  log('PERMISSION ISOLATION OK: guardian linked-child only, cross-area tokens blocked and logout revoked.');
  log('READ CONTRACT OK: historical roster, daily/period marks and guardian attendance.');
  log('ROLLBACK VERIFIED: synthetic accounts, enrollment, timetable and attendance not committed.');
  log('PUBLIC API CLOSED: no Passenger route imported, no Push sent or real school data used.');
  log('NOT PRODUCTION READY: service remains private and D1 migration is not complete.');
  return 0;
 }catch(e){
  const message=String(e?.message||'');
  warn('INTEGRATED HTTP MARIADB FAILED ('+
   (/^integrated_http_[a-z_]+$/.test(message)?message:category(e))+').');
  warn('NO GO: check staging emptiness before retry; no public school API was enabled.');
  return 1;
 }finally{
  if(conn){try{await conn.rollback()}catch{};try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(n=>{process.exitCode=n},()=>{
 console.error('INTEGRATED HTTP MARIADB FAILED (unexpected).');process.exitCode=1;
});
module.exports={people,call,exercise,run};
