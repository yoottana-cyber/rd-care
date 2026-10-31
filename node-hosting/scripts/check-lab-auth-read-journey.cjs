'use strict';
// RD CONNECT: full INTERNAL login → role-scoped classroom/portal HTTP journey.
// DISPOSABLE LAB ONLY: 63 empty tables + 5 known triggers checked before use.
// Random synthetic teacher, staff, student, guardian, two student enrollments.
// Caller-owned transactions always ROLLBACK, including on any error.
// No public listener, passwords or login tokens in logs, no real student data.
const {Readable}=require('node:stream');
const {randomBytes}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {category}=require('./check-db.cjs');
const {bangkokToday}=require('../src/attendance-write-contract.cjs');
const {seed}=require('./check-lab-period-truancy-rollback.cjs');
const {d1PasswordHash}=require('../src/d1-password-compat.cjs');
const {handleIntegratedStaging}=require('../src/staging-integrated-http.cjs');
const need=(yes,why)=>{if(!yes)throw Error('lab_journey_'+why)};
const nonce=()=>randomBytes(8).toString('hex');
const makePerson=()=>({
 username:'lab_'+nonce(),
 password:randomBytes(18).toString('hex'),
 salt:'rd2$'+randomBytes(16).toString('hex')
});
async function request(conn,method,url,{body,token}={}){
 const payload=body===undefined?[]:[Buffer.from(JSON.stringify(body))];
 const req=Readable.from(payload);
 req.url=url;req.method=method;
 req.headers={
  ...(body===undefined?{}:{'content-type':'application/json'}),
  ...(token?{authorization:'Bearer '+token}:{})
 };
 const res={status:0,headers:{},raw:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(text){this.raw=String(text??'')},
  json(){return JSON.parse(this.raw)}
 };
 await handleIntegratedStaging(req,res,{connection:conn});
 need(res.status>0&&res.raw.length>0,'incomplete_response');
 need(res.headers['Cache-Control']==='no-store'&&
  !res.headers['Access-Control-Allow-Origin'],'unsafe_response_headers');
 return {status:res.status,body:res.json()};
}
async function expect(conn,method,url,options,status){
 const res=await request(conn,method,url,options);
 need(res.status===status,'unexpected_http_status');
 return res.body;
}
async function makeFixture(conn,date){
 const f=await seed(conn,date);
 const teacher=makePerson(),staff=makePerson(),pupil=makePerson(),guardian=makePerson();
 const hashes=await Promise.all([teacher,staff,pupil,guardian].map(p=>
  d1PasswordHash(p.password,p.salt)));
 await conn.execute('UPDATE users SET username=?,password_salt=?,password_hash=? WHERE id=?',
  [teacher.username,teacher.salt,hashes[0],f.actor.id]);
 const [staffRow]=await conn.execute(
  "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,'Synthetic Student Affairs','staff',?,?,1)",
  [staff.username,staff.salt,hashes[1]]);
 const [pupilRow]=await conn.execute(
  "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,must_change_password,created_by) VALUES(?,'Synthetic Student','student',?,?,?,1,0,?)",
  [pupil.username,f.students[1],pupil.salt,hashes[2],f.actor.id]);
 const [guardianRow]=await conn.execute(
  "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,must_change_password,created_by) VALUES(?,'Synthetic Guardian','guardian',NULL,?,?,1,0,?)",
  [guardian.username,guardian.salt,hashes[3],f.actor.id]);
 await conn.execute(
  'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
  [guardianRow.insertId,f.students[0],f.actor.id]);
 await conn.execute(
  "INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,'present',?)",
  [f.students[0],date,f.actor.id]);
 await conn.execute(
  "INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(?,?,?,'absent',?)",
  [f.students[0],f.lessonId,date,f.actor.id]);
 await conn.execute(
  'INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by) VALUES(?,?,?,?)',
  [f.students[0],f.lessonId,date,f.actor.id]);
 await conn.execute(
  "INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_rule_id,affairs_category,created_at) VALUES(?,-7,'Synthetic Conduct',?,?,'moderate',?)",
  [f.students[0],f.actor.id,f.ruleId,date+' 12:00:00']);
 return {...f,teacher,staff,pupil,guardian,
  staffId:Number(staffRow.insertId),
  pupilAccountId:Number(pupilRow.insertId),
  guardianAccountId:Number(guardianRow.insertId)};
}
async function fullCycle(conn,date){
 await conn.beginTransaction();
 try{
  const f=await makeFixture(conn,date);
  const login=(account,role)=>({username:account.username,
   password:account.password,...(role?{role}:{})});
  let res=await expect(conn,'POST','/api/auth/login',
   {body:login(f.teacher)},200);
  need(res.user?.role==='teacher'&&res.token?.length===64,'teacher_login');
  const teacherToken=res.token;
  res=await expect(conn,'GET','/api/auth/me',{token:teacherToken},200);
  need(res.user?.role==='teacher','teacher_me');
  res=await expect(conn,'GET','/api/classrooms',{token:teacherToken},200);
  need(res.items?.some(x=>Number(x.id)===f.roomId),'advisor_classroom_missing');
  res=await expect(conn,'GET','/api/students?classroom_id='+f.roomId+'&date='+date,
   {token:teacherToken},200);
  need(res.items?.length===2,'enrolled_roster_wrong');
  res=await expect(conn,'GET','/api/attendance?kind=daily&classroom_id='+f.roomId+
   '&date='+date,{token:teacherToken},200);
  need(res.items?.length===2,'daily_record_count');
  res=await expect(conn,'GET','/api/attendance?kind=period&classroom_id='+f.roomId+
   '&date='+date+'&timetable_id='+f.lessonId,{token:teacherToken},200);
  need(res.items?.some(x=>Number(x.student_id)===f.students[0]&&
   x.status==='truancy'),'classified_period_not_visible');
  const wrongArea=await expect(conn,'GET','/api/portal/children',
   {token:teacherToken},401);
  need(wrongArea.error==='authentication_required','cross_area_token_accepted');
  // Student-affairs role supervises rooms, but cannot perform homeroom reads
  // as an unrelated advisor.
  res=await expect(conn,'POST','/api/auth/login',
   {body:login(f.staff)},200);
  const staffToken=res.token;
  res=await expect(conn,'GET','/api/classrooms',{token:staffToken},200);
  need(res.items?.length>=1,'student_affairs_rooms_missing');
  await expect(conn,'GET','/api/attendance?kind=daily&classroom_id='+f.roomId+
   '&date='+date,{token:staffToken},403);
  res=await expect(conn,'POST','/api/portal/auth/login',
   {body:login(f.pupil,'student')},200);
  const pupilToken=res.token;
  res=await expect(conn,'GET','/api/portal/children',{token:pupilToken},200);
  need(res.items?.length===1&&Number(res.items[0].id)===f.students[1],
   'student_children_not_isolated');
  await expect(conn,'GET','/api/portal/attendance?student_id='+f.students[0]+
   '&from='+date+'&to='+date,{token:pupilToken},403);
  res=await expect(conn,'POST','/api/portal/auth/login',
   {body:login(f.guardian,'guardian')},200);
  const guardianToken=res.token;
  res=await expect(conn,'GET','/api/portal/children',
   {token:guardianToken},200);
  need(res.items?.length===1&&Number(res.items[0].id)===f.students[0],
   'guardian_verified_child_link');
  await expect(conn,'GET','/api/portal/attendance?student_id='+f.students[1]+
   '&from='+date+'&to='+date,{token:guardianToken},403);
  res=await expect(conn,'GET','/api/portal/attendance?student_id='+f.students[0]+
   '&from='+date+'&to='+date,{token:guardianToken},200);
  need(res.daily?.length===1&&res.period?.some(x=>x.status==='truancy'),
   'guardian_attendance_history');
  res=await expect(conn,'GET','/api/portal/behavior?student_id='+f.students[0]+
   '&from='+date+'&to='+date,{token:guardianToken},200);
  need(res.items?.length===1&&Number(res.items[0].points)===-7,
   'guardian_behavior_data');
  // Exact legacy GET /api/portal/records contract: historical daily,
  // truancy, warning/conduct/merit ledgers and guardian ownership.
  res=await expect(conn,'GET','/api/portal/records?student_id='+f.students[0]+
   '&from='+date+'&to='+date,{token:guardianToken},200);
  need(Number(res.student?.id)===f.students[0]&&res.daily?.length===1&&
   res.period?.some(x=>x.status==='truancy')&&res.truancy?.length===1,
   'guardian_records_attendance');
  need(res.behavior?.length===1&&res.good?.length===0&&
   res.behavior_deducted===7&&res.behavior_adjusted===0&&
   res.behavior_remaining===7&&res.behavior_total===-7&&
   res.good_total===0,'guardian_records_ledgers');
  await expect(conn,'GET','/api/portal/records?student_id='+f.students[1]+
   '&from='+date+'&to='+date,{token:guardianToken},403);
  await expect(conn,'GET','/api/portal/records?student_id='+f.students[0]+
   '&from='+date+'&to='+date,{token:pupilToken},403);
  res=await expect(conn,'GET','/api/portal/records?student_id='+f.students[1]+
   '&from='+date+'&to='+date,{token:pupilToken},200);
  need(Number(res.student?.id)===f.students[1]&&res.behavior?.length===0,
   'student_self_records');
  // Internal guardian event feed: synthetic fixture has no truancy_events.
  res=await expect(conn,'GET','/api/portal/truancy?from='+date+'&to='+date,
   {token:guardianToken},200);
  need(Array.isArray(res.items)&&res.items.length===0,'guardian_truancy_no_event');
  res=await expect(conn,'GET','/api/portal/truancy',{token:pupilToken},200);
  need(Array.isArray(res.items)&&res.items.length===0,'student_truancy_feed_empty');
  await expect(conn,'GET','/api/portal/truancy?from='+date,
   {token:guardianToken},400);
  await expect(conn,'GET','/api/auth/me',{token:guardianToken},401);
  await expect(conn,'POST','/api/portal/auth/logout',
   {token:guardianToken},200);
  await expect(conn,'GET','/api/portal/children',{token:guardianToken},401);
  await expect(conn,'POST','/api/auth/logout',{token:teacherToken},200);
  await expect(conn,'GET','/api/classrooms',{token:teacherToken},401);
  return {accounts:4,rooms:1,students:2,
   staff_roles_checked:true,portal_links_checked:true,
   token_area_separation:true,revocation:true};
 }finally{
  await conn.rollback();
  await assertEmpty(conn);
 }
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn,error,done=false;
 try{
  // Do not require write opt-in: this is an isolated, fully synthetic,
  // rollback-only diagnostic with mandatory empty/trigger preflight.
  need(env.RD_DB_NAME==='ratsadaa_connect','staging_name_required');
  need(env.RD_TRIGGER_LAB_DB_NAME===LAB_DATABASE,'lab_name_required');
  need(!Object.keys(env).some(k=>k.startsWith('RD_TRIGGER_LAB_ALLOW_')&&
   String(env[k]||'').length>0),'temporary_write_flags_present');
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:1,queueLimit:1});
  conn=await pool.getConnection();
  await inspectSet(conn,5);
  await assertEmpty(conn);
  const output=await fullCycle(conn,bangkokToday());
  need(output.revocation&&output.portal_links_checked,'journey_missing_checks');
  await inspectSet(conn,5);
  await assertEmpty(conn);
  done=true;
 }catch(e){error=e}
 finally{
  if(conn){let ok=false;
   try{await conn.rollback();ok=true}catch{}
   if(ok){try{conn.release()}catch{}}
   else if(typeof conn.destroy==='function')try{conn.destroy()}catch{}
  }
  if(pool){try{await pool.end()}catch{}}
 }
 if(!done){
  const msg=String(error?.message||'');
  warn('AUTH + READ LAB FAILED ('+
   (/^lab_journey_[a-z_]+$/.test(msg)?msg:category(error))+').');
  warn('NO COMMIT requested. Inspect lab emptiness if ROLLBACK was not verified.');
  return 1;
 }
 log('AUTH + READ LAB OK: teacher, student-affairs, student and guardian internal HTTP sessions and read flows.');
 log('ACCESS CONTROL OK: advisor vs student-affairs daily rights and verified guardian/student links.');
 log('SESSION ISOLATION OK: staff vs portal tokens and revoked logouts verified.');
 log('PORTAL DATA OK: synthetic guardian/student records, daily, truancy and separate score ledgers authorized.');
 log('ROLLBACK VERIFIED: synthetic identities, sessions, school records and behavior removed.');
 log('LAB UNCHANGED: 63 empty tables, five unchanged triggers and no public API.');
 log('NOT PRODUCTION READY: HTTP is internal only; migration, real Push and remaining APIs are blocked.');
 return 0;
}
if(require.main===module)run().then(n=>{process.exitCode=n},()=>{
 console.error('AUTH + READ LAB FAILED (unexpected).');process.exitCode=1;
});
module.exports={request,expect,makeFixture,fullCycle,run};
