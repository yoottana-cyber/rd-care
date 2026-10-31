'use strict';
// RD CONNECT / DirectAdmin TEST ONLY: Push queue/claim MariaDB transactions.
// Synthetic users/subscriptions ONLY; ZERO socket requests, zero COMMIT.
// Both successful and injected-failure cases always ROLLBACK.
// Refuse production/staging DB, nonempty 63-table lab or wrong 5 triggers.
const {randomBytes}=require('node:crypto');
const {getLabConfig}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {category}=require('./check-db.cjs');
const {bangkokToday}=require('../src/attendance-write-contract.cjs');
const {seed}=require('./check-lab-period-truancy-rollback.cjs');
const {OPT_IN,checkPermission,queueEvent,claim}=require('../src/lab-truancy-push-queue.cjs');
const need=(ok,code)=>{if(!ok)throw Error('lab_push_'+code)};
const nonce=()=>randomBytes(10).toString('hex');
async function prepare(conn,date){
 const f=await seed(conn,date);
 const [second]=await conn.execute(
  "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,'Synthetic Second Advisor','teacher','test-salt','test-hash',1)",
  ['labpush_'+nonce()]);
 const advisor2=Number(second.insertId);
 await conn.execute('UPDATE classrooms SET advisor2_user_id=? WHERE id=?',
  [advisor2,f.roomId]);
 const [student]=await conn.execute(
  "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,must_change_password,created_by) VALUES(?,'Synthetic Student Portal','student',?,'x','x',1,0,?)",
  ['labstudent_'+nonce(),f.students[0],f.actor.id]);
 const [guardian]=await conn.execute(
  "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,must_change_password,created_by) VALUES(?,'Synthetic Guardian Portal','guardian',NULL,'x','x',1,0,?)",
  ['labguardian_'+nonce(),f.actor.id]);
 await conn.execute(
  'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
  [guardian.insertId,f.students[0],f.actor.id]);
 const added={advisor:[],guardian:[],student:[]};
 for(const [label,user] of [['first',f.actor.id],['second',advisor2]]){
  const [sub]=await conn.execute(
   'INSERT INTO staff_push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(?,?,?,?)',
   [user,'https://push.invalid/lab/'+label+'/'+nonce(),'SYNTHETIC_P256','SYNTHETIC_AUTH']);
  added.advisor.push(Number(sub.insertId));
 }
 const [guardianSub]=await conn.execute(
  'INSERT INTO guardian_push_subscriptions(guardian_account_id,endpoint,p256dh,auth) VALUES(?,?,?,?)',
  [guardian.insertId,'https://push.invalid/lab/guardian/'+nonce(),'SYNTHETIC_P256','SYNTHETIC_AUTH']);
 added.guardian.push(Number(guardianSub.insertId));
 const [studentSub]=await conn.execute(
  'INSERT INTO student_push_subscriptions(student_account_id,endpoint,p256dh,auth) VALUES(?,?,?,?)',
  [student.insertId,'https://push.invalid/lab/student/'+nonce(),'SYNTHETIC_P256','SYNTHETIC_AUTH']);
 added.student.push(Number(studentSub.insertId));
 await conn.execute(
  "INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(?,?,?,'absent',?)",
  [f.students[0],f.lessonId,date,f.actor.id]);
 await conn.execute(
  'INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by) VALUES(?,?,?,?)',
  [f.students[0],f.lessonId,date,f.actor.id]);
 const [evt]=await conn.execute(
  'INSERT INTO truancy_events(student_id,timetable_id,school_date,active,generation,recorded_by) VALUES(?,?,?,1,1,?)',
  [f.students[0],f.lessonId,date,f.actor.id]);
 return {...f,eventId:Number(evt.insertId),advisor2,
  guardianId:Number(guardian.insertId),studentAccountId:Number(student.insertId),
  subscriptions:added};
}
async function queryStates(conn,eventId,gen){
 const [staff]=await conn.execute(
  'SELECT recipient_type,subscription_id,state,attempts FROM truancy_push_deliveries WHERE event_id=? AND generation=? ORDER BY recipient_type,subscription_id',
  [eventId,gen]);
 const [students]=await conn.execute(
  "SELECT subscription_id,state,attempts FROM student_push_deliveries WHERE event_kind='truancy' AND event_id=? AND generation=?",
  [eventId,gen]);
 return {staff,students};
}
async function exercise(conn,env,date,{injected=false}={}){
 await conn.beginTransaction();
 try{
  const f=await prepare(conn,date);
  const q=await queueEvent(conn,f.eventId,{env});
  need(q.active&&q.advisor===2&&q.guardian===1&&q.student===1&&q.queued===4,
   'first_queue_incomplete');
  if(injected)throw Error('lab_push_injected_failure');
  const duplicate=await queueEvent(conn,f.eventId,{env});
  need(duplicate.queued===0,'duplicate_delivery_inserted');
  const firstState=await queryStates(conn,f.eventId,1);
  need(firstState.staff.length===3&&firstState.students.length===1,
   'recipient_counts_invalid');
  const firstAdvisor={
   type:'advisor',event_id:f.eventId,generation:1,
   subscription_id:f.subscriptions.advisor[0]
  };
  const a=await claim(conn,firstAdvisor,{env});
  const again=await claim(conn,firstAdvisor,{env});
  need(a.claimed&&!again.claimed,'duplicate_immediate_claim');
  await conn.execute(
   "UPDATE truancy_push_deliveries SET state='delivered' WHERE event_id=? AND generation=1 AND recipient_type='advisor' AND subscription_id=?",
   [f.eventId,f.subscriptions.advisor[0]]);
  const delivered=await claim(conn,firstAdvisor,{env});
  need(!delivered.claimed,'already_delivered_reclaimed');
  // Disabled guardian notifications stop CLAIMS, including queued rows.
  await conn.execute(
   "INSERT INTO notification_preferences(event_key,enabled) VALUES('truancy_guardian',0)");
  const guardianClaim={type:'guardian',event_id:f.eventId,generation:1,
   subscription_id:f.subscriptions.guardian[0]};
  const disabled=await claim(conn,guardianClaim,{env});
  need(!disabled.claimed,'disabled_category_claimed');
  await conn.execute(
   "UPDATE notification_preferences SET enabled=1 WHERE event_key='truancy_guardian'");
  const goodGuardian=await claim(conn,guardianClaim,{env});
  need(goodGuardian.claimed,'guardian_claim_missing');
  // Revoked guardian link must not claim even if an old delivery row exists.
  await conn.execute(
   'DELETE FROM guardian_student_links WHERE guardian_account_id=? AND student_id=?',
   [f.guardianId,f.students[0]]);
  await conn.execute(
   "UPDATE truancy_push_deliveries SET state='failed',updated_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 3 MINUTE) WHERE event_id=? AND recipient_type='guardian'",
   [f.eventId]);
  const revoked=await claim(conn,guardianClaim,{env});
  need(!revoked.claimed,'revoked_guardian_link_claimed');
  await conn.execute(
   'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
   [f.guardianId,f.students[0],f.actor.id]);
  const retry=await claim(conn,guardianClaim,{env});
  need(retry.claimed,'valid_retry_missing');
  await conn.execute(
   "UPDATE truancy_push_deliveries SET state='failed',updated_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 3 MINUTE) WHERE event_id=? AND recipient_type='guardian'",
   [f.eventId]);
  const finalAttempt=await claim(conn,guardianClaim,{env});
  const exhausted=await claim(conn,guardianClaim,{env});
  need(finalAttempt.claimed&&!exhausted.claimed,'three_attempt_limit_failed');
  const studentClaim={type:'student',event_id:f.eventId,generation:1,
   subscription_id:f.subscriptions.student[0]};
  const pupil=await claim(conn,studentClaim,{env});
  need(pupil.claimed,'student_claim_missing');
  // Correct attendance / inactivate event: no new queue and no new claim.
  await conn.execute('UPDATE truancy_events SET active=0 WHERE id=?',[f.eventId]);
  const stopped=await queueEvent(conn,f.eventId,{env});
  need(!stopped.active&&stopped.queued===0,'inactive_event_queued');
  await conn.execute(
   "UPDATE student_push_deliveries SET state='failed',updated_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 3 MINUTE) WHERE event_id=?",
   [f.eventId]);
  const corrected=await claim(conn,studentClaim,{env});
  need(!corrected.claimed,'corrected_truancy_claimed');
  // New incident generation is a distinct dedupe key.
  await conn.execute(
   'UPDATE truancy_events SET active=1,generation=generation+1 WHERE id=?',
   [f.eventId]);
  const restarted=await queueEvent(conn,f.eventId,{env});
  need(restarted.generation===2&&restarted.queued===4,
   'new_generation_queue_missing');
  const gen1=await queryStates(conn,f.eventId,1);
  const gen2=await queryStates(conn,f.eventId,2);
  need(gen1.staff.length===3&&gen2.staff.length===3&&
   gen1.students.length===1&&gen2.students.length===1,
   'generation_history_not_preserved');
  return {queued:4,regeneration:4,
   dedupe:true,bounded_attempts:3,disabled_category:true,
   revoked_link:true,corrected_event:true,student_delivery_claim:true};
 }finally{
  await conn.rollback();
  await assertEmpty(conn); // All synthetic staff + portal devices + events gone.
 }
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn,ok=false,error;
 try{
  checkPermission(env);
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:1,queueLimit:1});
  conn=await pool.getConnection();
  await inspectSet(conn,5);
  await assertEmpty(conn);
  const date=bangkokToday();
  const result=await exercise(conn,env,date);
  let caught=false;
  try{await exercise(conn,env,date,{injected:true})}
  catch(e){caught=e?.message==='lab_push_injected_failure'}
  need(caught&&result.dedupe,'injected_failure_not_detected');
  await assertEmpty(conn);
  await inspectSet(conn,5);
  ok=true;
 }catch(e){error=e}
 finally{
  if(conn){
   let rolledBack=false;
   try{await conn.rollback();rolledBack=true}catch{}
   if(rolledBack){try{conn.release()}catch{}}
   else if(typeof conn.destroy==='function')try{conn.destroy()}catch{}
  }
  if(pool){try{await pool.end()}catch{}}
 }
 if(!ok){
  const reason=String(error?.message||'');
  warn('PUSH QUEUE LAB FAILED ('+
   (/^lab_push_[a-z_]+$/.test(reason)?reason:category(error))+').');
  warn('NO COMMIT executed. Inspect all 63 lab tables before any retry if rollback was not confirmed.');
  return 1;
 }
 log('PUSH QUEUE LAB OK: synthetic two advisors, verified guardian and student queued as four delivery rows.');
 log('CLAIM AND DEDUPE OK: generation-bound unique delivery keys, no duplicate claims and no delivered reclaims.');
 log('SAFETY OK: revoked guardian link, disabled category, corrected truancy and max 3 attempts blocked.');
 log('REACTIVATION OK: next generation queued separately without removing prior receipts.');
 log('ROLLBACK VERIFIED: both full queue/claim lifecycle and injected failure reverted; no COMMIT.');
 log('LAB UNCHANGED: 63 empty tables and 5 original triggers; no VAPID, real Push or public API.');
 log('NOT PRODUCTION READY: sender, real subscription transport, concurrency and full API integration pending.');
 return 0;
}
if(require.main===module)run().then(c=>{process.exitCode=c},()=>{
 console.error('PUSH QUEUE LAB FAILED (unexpected).');process.exitCode=1;
});
module.exports={OPT_IN,prepare,queryStates,exercise,run};
