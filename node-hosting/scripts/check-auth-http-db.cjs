'use strict';
// Stage 6.6: HTTP parser -> actual auth service -> real MariaDB -> ROLLBACK.
// This script is deliberately NOT a web endpoint and never opens a socket.
// It refuses nonempty or non-InnoDB school staging authentication tables.
// All data are synthetic and random; no secrets, names, hashes or tokens are logged.
const {randomBytes}=require('node:crypto');
const {openPool}=require('../src/database.cjs');
const {category}=require('./check-db.cjs');
const {preflightAuth}=require('./check-auth-service.cjs');
const {d1PasswordHash}=require('../src/d1-password-compat.cjs');
const {invoke}=require('./check-auth-http.cjs');

const shortRandom=()=>randomBytes(8).toString('hex');
const makePerson=()=>({
 username:'rdst_'+randomBytes(12).toString('hex'),
 password:randomBytes(32).toString('hex'),
 salt:'rd2$'+randomBytes(16).toString('hex')
});
function ensure(value,what){
 if(!value)throw new Error('integration_check_failed_'+what);
}
async function request(method,path,body,headers,connection,expectedStatus){
 const res=await invoke(method,path,body,headers,{connection});
 ensure(res.status===expectedStatus,'http_status');
 ensure(res.headers['Cache-Control']==='no-store','no_store');
 ensure(!res.headers['Access-Control-Allow-Origin'],'no_unexpected_cors');
 const response=res.json();
 ensure(response&&typeof response==='object','json_response');
 return response;
}
async function verifyAll(conn){
 await preflightAuth(conn);
 const teacher=makePerson(),student=makePerson(),guardian=makePerson();
 const hashes=await Promise.all(
  [teacher,student,guardian].map(p=>d1PasswordHash(p.password,p.salt))
 );
 let transacting=false;
 try{
  await conn.beginTransaction();
  transacting=true;
  const [teacherInsert]=await conn.execute(
   "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES (?,?,'teacher',?,?,1)",
   [teacher.username,'Synthetic Teacher',teacher.salt,hashes[0]]
  );
  const [roomInsert]=await conn.execute(
   'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES (?,?,?,?)',
   [1,1,'STAGE-'+shortRandom(),teacherInsert.insertId]
  );
  const [studentInsert]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES (?,?,?,?,1)',
   ['STAGE-'+shortRandom(),roomInsert.insertId,1,'Synthetic Student']
  );
  await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES (?,?,'student',?,?,?,?,?)",
   [student.username,'Synthetic Student',studentInsert.insertId,student.salt,hashes[1],1,teacherInsert.insertId]
  );
  await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES (?,?,'guardian',NULL,?,?,1,?)",
   [guardian.username,'Synthetic Guardian',guardian.salt,hashes[2],teacherInsert.insertId]
  );

  const prefix='/web/rd-connect-node-test';
  let result=await request('POST','/api/auth/login',
   {username:teacher.username,password:'invalid-password'}, {},conn,401);
  ensure(result.ok===false&&result.error==='invalid_credentials','wrong_password');

  result=await request('POST',prefix+'/api/auth/login',
   {username:teacher.username,password:teacher.password}, {},conn,200);
  ensure(result.user?.role==='teacher'&&result.expires_in===28800,'teacher_login');
  const staffToken=result.token;
  ensure(/^[0-9a-f]{64}$/.test(staffToken),'staff_bearer');
  result=await request('GET','/api/auth/me',undefined,
   {authorization:'Bearer '+staffToken},conn,200);
  ensure(result.user?.role==='teacher'&&result.user.student_affairs===0,'teacher_me');

  result=await request('GET','/api/portal/auth/me',undefined,
   {authorization:'Bearer '+staffToken},conn,401);
  ensure(result.ok===false,'cross_area_token');

  result=await request('POST','/api/auth/logout',undefined,
   {authorization:'Bearer '+staffToken},conn,200);
  ensure(result.ok===true,'teacher_logout');
  result=await request('GET','/api/auth/me',undefined,
   {authorization:'Bearer '+staffToken},conn,401);
  ensure(result.ok===false,'revoked_teacher_session');

  result=await request('POST','/api/portal/auth/login',
   {username:student.username,password:student.password,role:'guardian'}, {},conn,401);
  ensure(result.ok===false,'wrong_portal_role');

  result=await request('POST',prefix+'/api/portal/auth/login',
   {username:student.username,password:student.password,role:'student',remember:true},
   {},conn,200);
  ensure(result.account?.role==='student'&&result.expires_in===2592000,'student_remembered_login');
  const studentToken=result.token;
  result=await request('GET','/api/portal/auth/me',undefined,
   {authorization:'Bearer '+studentToken},conn,200);
  ensure(result.account?.role==='student','student_me');

  result=await request('POST','/api/portal/auth/login',
   {username:guardian.username,password:guardian.password,role:'guardian'}, {},conn,200);
  ensure(result.account?.role==='guardian'&&result.expires_in===28800,'guardian_login');
  const guardianToken=result.token;
  result=await request('GET','/api/portal/auth/me',undefined,
   {authorization:'Bearer '+guardianToken},conn,200);
  ensure(result.account?.role==='guardian','guardian_me');

  result=await request('POST','/api/portal/auth/logout',undefined,
   {authorization:'Bearer '+guardianToken},conn,200);
  ensure(result.ok===true,'guardian_logout');
  result=await request('GET','/api/portal/auth/me',undefined,
   {authorization:'Bearer '+guardianToken},conn,401);
  ensure(result.ok===false,'guardian_revoked');

  // Negative HTTP input checks with no stored credentials or token leakage.
  const bad=await request('POST','/api/auth/login','{bad-json',{},conn,400);
  ensure(bad.ok===false&&bad.error==='invalid_request','invalid_json');
 }finally{
  if(transacting)await conn.rollback();
 }
 for(const [table,username] of [
  ['users',teacher.username],['portal_accounts',student.username],['portal_accounts',guardian.username]
 ]){
  const [rows]=await conn.execute('SELECT 1 FROM `'+table+'` WHERE username=? LIMIT 1',[username]);
  ensure(rows.length===0,'rolled_back_account');
 }
 for(const table of ['sessions','portal_sessions','login_attempts','portal_login_attempts']){
  const [rows]=await conn.execute('SELECT 1 FROM `'+table+'` LIMIT 1');
  ensure(rows.length===0,'rolled_back_auth_rows');
 }
 const [students]=await conn.execute('SELECT 1 FROM students LIMIT 1');
 const [classrooms]=await conn.execute('SELECT 1 FROM classrooms LIMIT 1');
 ensure(students.length===0&&classrooms.length===0,'rolled_back_roster');
 return true;
}
async function run({makePool=openPool,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  pool=makePool(process.env);
  conn=await pool.getConnection();
  await verifyAll(conn);
  log('STEP 6.6 OK: in-process HTTP -> Login/Me/Logout -> MariaDB for teacher, student, guardian.');
  log('ROLLBACK VERIFIED: no temporary accounts, roster rows, attempts or sessions remain.');
  log('HTTPS LOGIN NOT ENABLED: public Passenger routes are still closed (501).');
  return 0;
 }catch(error){
  const detail=String(error?.message||'');
  const reason=detail.startsWith('staging_')?detail:category(error);
  warn('STEP 6.6 FAILED ('+reason+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module){
 run().then(code=>{process.exitCode=code},()=>{
  console.error('STEP 6.6 FAILED (unknown).');process.exitCode=1;
 });
}
module.exports={verifyAll,request,run};
