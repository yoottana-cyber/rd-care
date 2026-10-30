'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {d1PasswordHash}=require('../src/d1-password-compat.cjs');
const {handleIntegratedStaging,ROUTES}=require('../src/staging-integrated-http.cjs');
const {requestHandler}=require('../src/http-handler.cjs');

const pwd='temporary-synthetic-password';
const studentId=301;
const date='2026-10-30';
async function fixture(){
 const salt='rd2$0123456789abcdef0123456789abcdef';
 const hash=await d1PasswordHash(pwd,salt);
 const staff={id:10,username:'tteacher',display_name:'Synthetic Teacher',
  role:'teacher',active:1,password_salt:salt,password_hash:hash};
 const student={id:22,username:'sstudent',display_name:'Synthetic Student',
  role:'student',active:1,student_id:studentId,
  password_salt:salt,password_hash:hash};
 const guardian={id:23,username:'gguardian',display_name:'Synthetic Guardian',
  role:'guardian',active:1,password_salt:salt,password_hash:hash};
 const sessions={sessions:new Map(),portal_sessions:new Map()},calls=[];
 const conn={calls,async execute(sql,args=[]){
  calls.push({sql,args});
  if(sql.startsWith('SELECT failures,locked_until FROM'))return [[]];
  if(sql.startsWith('SELECT id,username,display_name,role,password_salt,password_hash,active FROM')){
   const area=sql.includes('FROM `users`')?'staff':'portal';
   const records=area==='staff'?[staff]:[student,guardian];
   return [records.filter(a=>a.username===args[0])];
  }
  if(sql.startsWith('DELETE FROM `login_attempts`')||
    sql.startsWith('DELETE FROM `portal_login_attempts`'))return [{affectedRows:0}];
  if(sql.startsWith('INSERT INTO `sessions`')||
    sql.startsWith('INSERT INTO `portal_sessions`')){
   const kind=sql.includes('`portal_sessions`')?'portal_sessions':'sessions';
   sessions[kind].set(args[0],{id:Number(args[1]),expires_at:Number(args[2])});
   return [{affectedRows:1}];
  }
  if(sql.startsWith('DELETE FROM `sessions`')||
    sql.startsWith('DELETE FROM `portal_sessions`')){
   const kind=sql.includes('`portal_sessions`')?'portal_sessions':'sessions';
   sessions[kind].delete(args[0]);return [{affectedRows:1}];
  }
  if(sql.startsWith('SELECT a.id,a.username,a.display_name,a.role,a.active FROM')){
   const kind=sql.includes('FROM `portal_sessions` s')?'portal_sessions':'sessions';
   const session=sessions[kind].get(args[0]);
   if(!session||session.expires_at<=args[1])return [[]];
   const account=(kind==='sessions'?[staff]:[student,guardian])
    .find(a=>a.id===session.id);
   return [account?[account]:[]];
  }
  if(sql.includes('FROM student_affairs_assignments'))return [[]];
  if(sql.startsWith('SELECT DISTINCT c.id,c.grade,c.room'))return [[{
   id:4,grade:1,room:1,label:'M1/1',advisor_user_id:staff.id,
   advisor2_user_id:null
  }]];
  if(sql.startsWith('SELECT id,advisor_user_id,advisor2_user_id FROM classrooms')){
   const room=Number(args[0]);
   return [[{id:room,advisor_user_id:room===4?staff.id:99,
    advisor2_user_id:null}]];
  }
  if(sql.includes('SELECT 1 AS allowed FROM timetable'))return [[]];
  if(sql.includes('FROM students s JOIN student_enrollments h'))return [[{
   id:studentId,student_no:'SYN-301',full_name:'Synthetic Student',roll_no:1
  }]];
  if(sql.includes('FROM student_enrollments h')&&sql.includes('LEFT JOIN attendance_daily')){
   return [[{student_id:studentId,status:'present',full_name:'Synthetic Student'}]];
  }
  if(sql.includes('FROM guardian_student_links g JOIN portal_accounts a')){
   return [Number(args[0])===guardian.id&&Number(args[1])===studentId?
    [{allowed:1}]:[]];
  }
  if(sql.includes("SELECT student_id FROM portal_accounts WHERE id=?")){
   return [Number(args[0])===student.id?[{student_id:studentId}]:[]];
  }
  if(sql.includes('SELECT id FROM students WHERE id=? AND active=1')){
   return [Number(args[0])===studentId?[{id:studentId}]:[]];
  }
  if(sql.includes('FROM guardian_student_links l JOIN portal_accounts a')&&
    sql.includes('JOIN students s')){
   return [Number(args[0])===guardian.id?[{
    id:studentId,student_no:'SYN-301',full_name:'Synthetic Student',
    classroom_label:'M1/1'
   }]:[]];
  }
  if(sql.includes('FROM portal_accounts a JOIN students s')){
   return [Number(args[0])===student.id?[{
    id:studentId,student_no:'SYN-301',full_name:'Synthetic Student',
    classroom_label:'M1/1'
   }]:[]];
  }
  if(sql.startsWith('SELECT school_date,status FROM attendance_daily')){
   return [[{school_date:date,status:'present'}]];
  }
  if(sql.includes('FROM attendance_period p JOIN timetable t')){
   return [[{school_date:date,status:'present',period:2,subject:'Synthetic Subject'}]];
  }
  if(sql.startsWith('SELECT school_date,arrived_at,state FROM late_records'))return [[]];
  if(sql.includes('FROM behavior_records WHERE student_id=?')){
   return [[{id:90,points:-7,reason:'Synthetic record',affairs_category:'minor'}]];
  }
  throw Error('unexpected_mock_sql');
 }};
 return {conn,calls,staff,student,guardian};
}
function request(method,url,body,token){
 const bytes=body===undefined?[]:[Buffer.from(JSON.stringify(body))];
 const req=Readable.from(bytes);
 req.method=method;req.url=url;req.headers={
  ...(body===undefined?{}:{'content-type':'application/json'}),
  ...(token?{authorization:'Bearer '+token}:{})
 };
 return req;
}
function response(){
 return {status:0,headers:{},body:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.body=String(body??'')},
  json(){return JSON.parse(this.body)}
 };
}
async function call(conn,method,url,body,token){
 const res=response();
 await handleIntegratedStaging(request(method,url,body,token),res,{connection:conn});
 assert.ok(res.status);
 assert.equal(res.headers['Cache-Control'],'no-store');
 assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);
 return res;
}
test('staff login -> token-backed rooms, roster, daily; logout revokes token',async()=>{
 const {conn,calls}=await fixture();
 const login=await call(conn,'POST','/api/auth/login',
  {username:'tteacher',password:pwd,remember:true});
 assert.equal(login.status,200);
 const token=login.json().token;
 assert.match(token,/^[0-9a-f]{64}$/);
 assert.equal(login.json().expires_in,30*86400);
 const rooms=await call(conn,'GET','/web/rd-connect-node-test/api/classrooms',undefined,token);
 assert.equal(rooms.status,200);
 assert.deepEqual(rooms.json().items.map(x=>x.id),[4]);
 const roster=await call(conn,'GET','/api/students?classroom_id=4&date='+date,
  undefined,token);
 assert.equal(roster.status,200);
 assert.equal(roster.json().items[0].id,studentId);
 const daily=await call(conn,'GET','/api/attendance/daily?classroom_id=4&date='+date,
  undefined,token);
 assert.equal(daily.status,200);
 assert.equal(daily.json().items[0].status,'present');
 const foreign=await call(conn,'GET','/api/attendance/daily?classroom_id=5&date='+date,
  undefined,token);
 assert.equal(foreign.status,403);
 const logout=await call(conn,'POST','/api/auth/logout',undefined,token);
 assert.equal(logout.status,200);
 const after=await call(conn,'GET','/api/classrooms',undefined,token);
 assert.equal(after.status,401);
 assert.ok(calls.every(x=>!x.sql.includes(pwd)));
});
test('guardian login -> linked child -> attendance and independent behavior record; foreign student blocked',async()=>{
 const {conn}=await fixture();
 const login=await call(conn,'POST','/api/portal/auth/login',
  {username:'gguardian',password:pwd,role:'guardian'});
 assert.equal(login.status,200);
 const token=login.json().token;
 assert.equal(login.json().account.role,'guardian');
 const children=await call(conn,'GET','/api/portal/children',undefined,token);
 assert.equal(children.status,200);
 assert.equal(children.json().items[0].id,studentId);
 const hist=await call(conn,'GET',
  '/api/portal/attendance?student_id=301&from=2026-10-01&to='+date,
  undefined,token);
 assert.equal(hist.status,200);
 assert.equal(hist.json().period[0].status,'present');
 const score=await call(conn,'GET',
  '/api/portal/behavior?student_id=301&from=2026-10-01&to='+date,
  undefined,token);
 assert.equal(score.status,200);
 assert.equal(score.json().items[0].points,-7);
 const denied=await call(conn,'GET',
  '/api/portal/behavior?student_id=999&from=2026-10-01&to='+date,
  undefined,token);
 assert.equal(denied.status,403);
});
test('student account cannot borrow teacher token or access unrelated child',async()=>{
 const {conn}=await fixture();
 const login=await call(conn,'POST','/api/portal/auth/login',
  {username:'sstudent',password:pwd,role:'student',remember:true});
 const token=login.json().token;
 assert.equal(login.status,200);
 const own=await call(conn,'GET','/api/portal/children',undefined,token);
 assert.equal(own.status,200);
 const staffRoute=await call(conn,'GET','/api/classrooms',undefined,token);
 assert.equal(staffRoute.status,401);
 const other=await call(conn,'GET',
  '/api/portal/attendance?student_id=999&from=2026-10-01&to='+date,
  undefined,token);
 assert.equal(other.status,403);
 const changed=await call(conn,'GET','/api/portal/auth/me',undefined,token);
 assert.equal(changed.status,200);
 assert.equal(changed.json().account.role,'student');
});
test('private adapter has no public mutation, missing connection fails closed, no URL guessing',async()=>{
 assert.equal(ROUTES.includes('/api/attendance'),true);
 assert.equal(ROUTES.includes('/api/auth/login'),true);
 assert.equal(ROUTES.includes('/api/behavior'),false);
 const noConn=response();
 await handleIntegratedStaging(request('GET','/api/classrooms'),noConn);
 assert.equal(noConn.status,503);
 const {conn}=await fixture();
 for(const path of ['/api/behavior','/api/admin/import',
  '/api/portal/student-push/subscribe']){
  const res=await call(conn,'POST',path,{kind:'write'});
  assert.equal(res.status,404);
 }
 const bad=await call(conn,'GET','/wrong/api/classrooms');
 assert.equal(bad.status,400);
 const method=await call(conn,'POST','/api/classrooms',{kind:'write'});
 assert.equal(method.status,405);
 for(const p of ['/api/auth/login','/api/classrooms','/api/portal/children']){
  const res=response();
  requestHandler(request('GET',p),res);
  assert.equal(res.status,501);
  assert.equal(res.json().error,'endpoint_not_migrated');
 }
});
