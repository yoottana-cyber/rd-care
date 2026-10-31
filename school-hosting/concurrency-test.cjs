'use strict';
// RD CONNECT — bounded synthetic check-in contention benchmark.
// This script NEVER accesses RD_SQLITE_FILE, RD_SQLITE_BACKUP_DIR, Cloudflare,
// MariaDB or the public school URL. It creates a brand-new SQLite file under
// os.tmpdir(), uses the ORIGINAL Worker attendance HTTP API on 127.0.0.1,
// checks all rows and constraints, then removes the lab. No Push or real users.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {fork}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {DatabaseSync}=require('node:sqlite');
const {migrate,CONFIRM}=require('./migrate.cjs');
const {verifyReady}=require('./server.cjs');
const NUMBER_OF_ROOMS=48,NUMBER_OF_TEACHERS=50,STUDENTS_PER_ROOM=20;
const LEVELS=Object.freeze([5,20,50]);
const LAB_PREFIX='rd-connect-load-lab-';
function schoolToday(){
 const value=new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'
 }).format(new Date());
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))
  throw Error('school_load_date_unavailable');
 return value;
}
function isolatedFile(dir,file){
 const root=path.resolve(dir),candidate=path.resolve(file);
 if(path.dirname(candidate)!==root||!path.basename(root).startsWith(LAB_PREFIX)||
  !fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep)||
  fs.existsSync(candidate))throw Error('school_load_live_db_guard');
 return candidate;
}
function prepareLab(file,date){
 const db=new DatabaseSync(file,{allowExtension:false});
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
 const actors=[],members=new Map();
 try{
  const rooms=db.prepare('SELECT id FROM classrooms ORDER BY grade,room').all();
  if(rooms.length!==NUMBER_OF_ROOMS)throw Error('school_load_room_fixture_mismatch');
  const users=db.prepare(
   'INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?, ?,?,1)');
  const sessions=db.prepare(
   'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)');
  const advisor1=db.prepare('UPDATE classrooms SET advisor_user_id=? WHERE id=?');
  const advisor2=db.prepare('UPDATE classrooms SET advisor2_user_id=? WHERE id=?');
  const students=db.prepare(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,1)');
  const enroll=db.prepare(
   'INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(?,?,?,?)');
  const lessons=db.prepare(
   "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject,active,approval_status) VALUES(?,?,?,?,?,?,?,1,'approved')");
  const day=((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)+1;
  for(let i=0;i<NUMBER_OF_ROOMS;i++){
   const roomId=rooms[i].id,list=[];
   for(let n=1;n<=STUDENTS_PER_ROOM;n++){
    const s=students.run('SYN-'+String(i+1).padStart(2,'0')+'-'+String(n).padStart(2,'0'),roomId,n,
     'Synthetic Learner '+(i+1)+'-'+n);
    const id=Number(s.lastInsertRowid);
    enroll.run(id,roomId,n,'2000-01-01');
    list.push(id);
   }
   members.set(roomId,list);
  }
  for(let i=0;i<NUMBER_OF_TEACHERS;i++){
   const roomId=rooms[i%NUMBER_OF_ROOMS].id;
   const result=users.run('load-teacher-'+String(i+1),'Synthetic Teacher '+String(i+1),
    'teacher','synthetic-disabled-secret','synthetic-disabled-secret');
   const userId=Number(result.lastInsertRowid);
   const token=crypto.randomBytes(32).toString('hex');
   sessions.run(crypto.createHash('sha256').update(token).digest('hex'),userId,
    Math.floor(Date.now()/1000)+3600);
   if(i<NUMBER_OF_ROOMS)advisor1.run(userId,roomId);
   else advisor2.run(userId,roomId);
   const period=i<NUMBER_OF_ROOMS?1:2;
   const lesson=lessons.run(roomId,userId,day,period,period,'SYN'+String(i+1),'Synthetic Load Subject');
   actors.push({teacherNo:i+1,roomId,userId,token,timetableId:Number(lesson.lastInsertRowid),
    studentIds:members.get(roomId)});
  }
  db.exec('COMMIT');
  return actors;
 }catch(e){
  try{db.exec('ROLLBACK')}catch{}
  throw e;
 }finally{db.close()}
}
function startChild(file,root){
 return new Promise((resolve,reject)=>{
  const child=fork(path.join(__dirname,'load-worker.cjs'),[],{
   env:{
    PATH:process.env.PATH||'/usr/bin:/bin',
    NODE_ENV:'test',
    RD_LAB_ONLY:'SYNTHETIC_NO_SCHOOL_DB',
    RD_LAB_ROOT:root,
    RD_LAB_SQLITE:file
   },
   stdio:['ignore','ignore','ignore','ipc']
  });
  let finished=false;
  const timer=setTimeout(()=>finish(Error('school_load_child_start_timeout')),20000);
  function finish(error,port){
   if(finished)return;
   finished=true;clearTimeout(timer);
   child.off('message',onMessage);
   child.off('error',onError);
   child.off('exit',onExit);
   if(error){try{child.kill('SIGTERM')}catch{};reject(error)}
   else resolve({child,port});
  }
  function onMessage(message){
   if(message?.type==='READY'&&Number.isInteger(message.port))
    finish(null,message.port);
   else if(message?.type==='FAILED')finish(Error('school_load_child_failed'));
  }
  function onError(){finish(Error('school_load_child_start_failed'))}
  function onExit(){finish(Error('school_load_child_exited'))}
  child.on('message',onMessage);
  child.on('error',onError);
  child.on('exit',onExit);
 });
}
async function stopChildren(children){
 await Promise.all(children.map(({child})=>new Promise(resolve=>{
  if(child.exitCode!==null||child.killed)return resolve();
  const timer=setTimeout(()=>{child.kill('SIGTERM');resolve()},4000);
  child.once('exit',()=>{clearTimeout(timer);resolve()});
  try{child.send({type:'STOP'})}catch{clearTimeout(timer);child.kill('SIGTERM');resolve()}
 })));
}
function summary(times){
 const sorted=[...times].sort((a,b)=>a-b);
 const at=p=>Math.round(sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]||0);
 return {p50:at(0.50),p95:at(0.95),max:at(1)};
}
async function wave(kind,number,actors,children,date,log){
 const start=performance.now(),latencies=[],failures=[];
 const tests=actors.slice(0,number).map(async(actor,index)=>{
  const {port}=children[index%children.length];
  const data={
   kind,date,classroom_id:actor.roomId,
   timetable_id:kind==='period'?actor.timetableId:null,
   entries:actor.studentIds.map(student_id=>({student_id,status:'present'}))
  };
  const began=performance.now();
  try{
   const reply=await fetch('http://127.0.0.1:'+port+'/rd-load/api/attendance',{
    method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+actor.token},
    body:JSON.stringify(data),
    signal:AbortSignal.timeout(25000)
   });
   const body=await reply.json().catch(()=>null);
   const ms=performance.now()-began;latencies.push(ms);
   if(reply.status!==200||body?.ok!==true||body?.saved!==STUDENTS_PER_ROOM)
    failures.push('HTTP_'+String(reply.status));
  }catch{failures.push('NETWORK_OR_TIMEOUT')}
 });
 await Promise.all(tests);
 const wall=performance.now()-start,stats=summary(latencies);
 const breakdown=Object.entries(failures.reduce((v,name)=>{
  v[name]=(v[name]||0)+1;return v
 },{})).map(([name,n])=>name+'='+n).join(',');
 const marker=failures.length?'FAIL':'OK';
 log('['+marker+'] '+kind.toUpperCase()+' '+number+' teachers: success '+
  (number-failures.length)+'/'+number+' | p50 '+stats.p50+'ms | p95 '+
  stats.p95+'ms | max '+stats.max+'ms | total '+Math.round(wall)+'ms'+
  (breakdown?' | '+breakdown:''));
 return {kind,number,success:number-failures.length,failures,wall,stats};
}
function verifyRows(file,date){
 const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 try{
  verifyReady({sqlite:db});
  const integrity=db.prepare('PRAGMA integrity_check').get()?.integrity_check;
  const fk=db.prepare('PRAGMA foreign_key_check').all().length;
  const daily=db.prepare('SELECT COUNT(*) AS n FROM attendance_daily WHERE school_date=? AND status=?')
   .get(date,'present').n;
  const period=db.prepare('SELECT COUNT(*) AS n FROM attendance_period WHERE school_date=? AND status=?')
   .get(date,'present').n;
  const audit=db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='attendance_saved'").get().n;
  const alerts=db.prepare('SELECT COUNT(*) AS n FROM attendance_alerts').get().n;
  const expectedDaily=NUMBER_OF_ROOMS*STUDENTS_PER_ROOM;
  const expectedPeriod=NUMBER_OF_TEACHERS*STUDENTS_PER_ROOM;
  if(integrity!=='ok'||fk!==0||daily!==expectedDaily||period!==expectedPeriod||
   audit!==2*LEVELS.reduce((a,b)=>a+b,0)||alerts!==0)
   throw Error('school_load_database_integrity_or_counts_mismatch');
  return {daily,period,audit,integrity,fk};
 }finally{db.close()}
}
async function run({log=console.log}={}){
 if(Number(process.versions.node.split('.')[0])<24)
  throw Error('school_load_node_24_required');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),LAB_PREFIX));
 fs.chmodSync(root,0o700);
 const file=isolatedFile(root,path.join(root,'lab.sqlite'));
 const children=[];
 try{
  const date=schoolToday();
  log('RD CONNECT CONCURRENCY LAB: 100% SYNTHETIC, 127.0.0.1 ONLY.');
  log('LIVE SQLITE / SCHOOL URL / REAL ACCOUNTS / PUSH: NOT USED.');
  migrate({filename:file,confirm:CONFIRM,log(){}});
  const actors=prepareLab(file,date);
  for(let i=0;i<2;i++)children.push(await startChild(file,root));
  const results=[];
  for(const kind of ['daily','period'])
   for(const level of LEVELS)results.push(await wave(kind,level,actors,children,date,log));
  await stopChildren(children.splice(0));
  const counts=verifyRows(file,date);
  const fail=results.some(r=>r.failures.length>0||r.stats.p95>10000);
  log('DATABASE: daily '+counts.daily+' rows, period '+counts.period+
   ' rows, audit '+counts.audit+' writes; integrity OK, foreign keys OK.');
  if(fail){
   log('LOAD TEST RESULT: NOT READY (HTTP failures or p95 exceeds 10000ms).');
   return 1;
  }
  if(results.some(r=>r.stats.p95>3000))
   log('PERFORMANCE WARNING: p95 > 3000ms on at least one batch; check host CPU and concurrency.');
  log('LOAD TEST PASS: 5/20/50 simultaneous requests in DAILY and PERIOD, 2 independent Node processes.');
  log('ALL REAL SCHOOL DATA UNTOUCHED. SYNTHETIC DATABASE REMOVED.');
  return 0;
 }finally{
  await stopChildren(children);
  fs.rmSync(root,{recursive:true,force:true});
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},e=>{
 const m=String(e?.message||'');
 const category=/^school_load_[a-z0-9_]+$/.test(m)?m:'school_load_unexpected_error';
 console.error('LOAD TEST FAILED ('+category+').');
 process.exitCode=1;
});
module.exports={LEVELS,NUMBER_OF_ROOMS,NUMBER_OF_TEACHERS,
 STUDENTS_PER_ROOM,schoolToday,isolatedFile,summary,run};
