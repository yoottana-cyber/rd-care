'use strict';
// RD CONNECT Batch 1: lab-only full SQL transaction with synthetic people,
// attendance, alert/outbox and audit records. NEVER COMMIT. The transaction
// rolls back on both success and injected failure. Zero real data transfers.
// Only ratsadaa_trgtest, previously all 63 tables EMPTY, 5 lab triggers.
const {randomBytes}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {category}=require('./check-db.cjs');
const {bangkokToday,weekday}=require('../src/attendance-write-contract.cjs');
const {OPT_IN,applyDailyInOpenTransaction}
 =require('../src/lab-daily-attendance-transaction.cjs');

const need=(yes,why)=>{if(!yes)throw Error('lab_daily_'+why)};
const nonce=()=>randomBytes(12).toString('hex');
async function seed(conn,today){
 const [u]=await conn.execute(
  "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,'Synthetic Daily Advisor','teacher','fake-salt','fake-hash',1)",
  ['labdaily_'+nonce()]);
 const actor={kind:'staff',id:Number(u.insertId),role:'teacher'};
 const [room]=await conn.execute(
  'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,1,?,?)',
  ['LAB-DAILY-'+nonce(),actor.id]);
 const students=[];
 for(let index=0;index<2;index++){
  const [s]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,1)',
   ['LAB-'+nonce(),room.insertId,index+1,'Synthetic Daily Student '+index]
  );
  students.push(Number(s.insertId));
  await conn.execute(
   "INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(?,?,?,'2020-01-01')",
   [s.insertId,room.insertId,index+1]
  );
 }
 const slots=[];
 for(const period of [1,3]){
  const [t]=await conn.execute(
   'INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject,subject_code,active,approval_status) VALUES(?,?,?,?,?,?,?,1,?)',
   [room.insertId,actor.id,weekday(today),period,period,
    'Synthetic Daily Attendance','LAB-D', 'approved']
  );slots.push(Number(t.insertId));
 }
 const alertIds=[];
 for(const slotId of slots){
  const [a]=await conn.execute(
   "INSERT INTO attendance_alerts(student_id,timetable_id,school_date,state) VALUES(?,?,?,'pending_review')",
   [students[0],slotId,today]
  );
  alertIds.push(Number(a.insertId));
 }
 await conn.execute(
  "INSERT INTO notification_outbox(alert_id,event_type,audience,state) VALUES(?,'attendance_review_requested','advisor','pending')",
  [alertIds[0]]
 );
 await conn.execute(
  "INSERT INTO notification_outbox(alert_id,event_type,audience,state) VALUES(?,'attendance_review_requested','advisor','delivered')",
  [alertIds[1]]
 );
 return {actor,roomId:Number(room.insertId),students,alertIds};
}
async function verifyMutation(conn,fixture,today){
 const [daily]=await conn.execute(
  'SELECT student_id,status FROM attendance_daily WHERE school_date=? ORDER BY student_id',
  [today]
 );
 need(daily.length===2,'upserts_not_recorded');
 need(daily.some(d=>Number(d.student_id)===fixture.students[0]&&d.status==='absent'),
  'daily_absence_not_saved');
 need(daily.some(d=>Number(d.student_id)===fixture.students[1]&&d.status==='present'),
  'daily_present_not_saved');
 const [events]=await conn.execute(
  'SELECT state FROM notification_outbox WHERE alert_id IN (?,?) ORDER BY alert_id',
  fixture.alertIds
 );
 need(events.length===2&&events[0].state==='cancelled'&&
  events[1].state==='delivered','pending_only_cancellation');
 const [alerts]=await conn.execute(
  'SELECT state FROM attendance_alerts WHERE id IN (?,?)',fixture.alertIds
 );
 need(alerts.length===2&&alerts.every(a=>a.state==='resolved'),'alert_resolution');
 const [[{n:audit}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id=? AND action='attendance_saved' AND entity_type='daily'",
  [fixture.actor.id]
 );
 need(Number(audit)===1,'audit_missing');
}
async function dryTransaction(conn,env,today,{throwAfterFirst=false,now=new Date()}={}){
 await conn.beginTransaction();
 let aborted=false;
 try{
  const f=await seed(conn,today);
  const data={kind:'daily',classroom_id:f.roomId,date:today,entries:[
   {student_id:f.students[0],status:'absent'},
   {student_id:f.students[1],status:'present'}
  ]};
  if(throwAfterFirst){
   let errorObserved=false;
   try{
    await applyDailyInOpenTransaction(conn,data,{actor:f.actor,env,
     now,onStep:stage=>{
      if(stage==='daily_upsert')throw Error('lab_daily_injected_failure');
     }});
   }catch(e){errorObserved=e?.message==='lab_daily_injected_failure'}
   need(errorObserved,'injected_error_not_observed');
  }else{
   const out=await applyDailyInOpenTransaction(conn,data,{
    actor:f.actor,env,now
   });
   need(out.rows===2&&out.absence_followups_resolved===1&&
    out.requires_rollback===true,'write_contract_mismatch');
   await verifyMutation(conn,f,today);
  }
 }finally{
  // NO COMMIT in this script, including successful test.
  await conn.rollback();aborted=true;
 }
 need(aborted,'rollback_not_confirmed');
 await assertEmpty(conn);
 return true;
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn,safeRollback=false,error=null,ok=false;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_ATTENDANCE!==OPT_IN)
   throw Error('lab_daily_attendance_opt_in_required');
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:1,queueLimit:1});
  conn=await pool.getConnection();
  await inspectSet(conn,5);
  await assertEmpty(conn);
  const now=new Date();
  const today=bangkokToday(now);
  await dryTransaction(conn,env,today,{now});
  await dryTransaction(conn,env,today,{throwAfterFirst:true,now});
  await assertEmpty(conn);
  await inspectSet(conn,5);
  ok=true;
 }catch(e){error=e}
 finally{
  if(conn){
   try{await conn.rollback();safeRollback=true}catch{}
   if(safeRollback){try{conn.release()}catch{}}
   else if(typeof conn.destroy==='function')try{conn.destroy()}catch{}
  }
  if(pool){try{await pool.end()}catch{}}
 }
 if(!ok){
  const msg=String(error?.message||'');
  warn('BATCH 1 LAB DAILY FAILED ('+
   (/^lab_[a-z_]+$/.test(msg)?msg:category(error))+').');
  warn('NO COMMIT requested. Check lab cleanliness if ROLLBACK was not verified.');
  return 1;
 }
 log('BATCH 1 LAB DAILY OK: synthetic two-student attendance and single audit row written inside a transaction.');
 log('OUTBOX PARITY OK: pending event cancelled, delivered event preserved, review alerts resolved.');
 log('ROLLBACK VERIFIED: successful transaction and injected-error transaction each reverted.');
 log('LAB UNCHANGED: 63 tables empty; 5 original triggers; no committed data and no public API.');
 log('NOT PRODUCTION READY: period truancy scoring, push dispatch and attendance API still blocked.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('BATCH 1 LAB DAILY FAILED (unexpected).');process.exitCode=1;
});
module.exports={OPT_IN,seed,verifyMutation,dryTransaction,run};
