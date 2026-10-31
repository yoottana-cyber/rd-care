'use strict';
// RD CONNECT period/truancy full SQL life-cycle lab, transactions ROLLBACK ONLY.
// Synthetic teacher + room + 2 students + configured -7 conduct rule.
// Isolated 63-table, 5-trigger ratsadaa_trgtest lab. No real Push or D1 access.
const {randomBytes}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {category}=require('./check-db.cjs');
const {bangkokToday,weekday}=require('../src/attendance-write-contract.cjs');
const {OPT_IN,applyPeriodInOpenTransaction}
 =require('../src/lab-period-attendance-transaction.cjs');
const need=(ok,code)=>{if(!ok)throw Error('lab_period_'+code)};
const random=()=>randomBytes(10).toString('hex');

async function seed(conn,date){
 const [user]=await conn.execute(
  "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,'Synthetic Period Teacher','teacher','test-salt','test-hash',1)",
  ['period_'+random()]);
 const teacherId=Number(user.insertId);
 const [room]=await conn.execute(
  'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,1,?,?)',
  ['LAB-PERIOD-'+random(),teacherId]);
 const roomId=Number(room.insertId),students=[];
 for(let i=0;i<2;i++){
  const [person]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,1)',
   ['PER-'+random(),roomId,i+1,'Synthetic Period Student '+i]);
  students.push(Number(person.insertId));
  await conn.execute(
   "INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(?,?,?,'2020-01-01')",
   [person.insertId,roomId,i+1]);
 }
 const [lesson]=await conn.execute(
  "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject,active,approval_status) VALUES(?,?,?,?,?,'LAB-P','Synthetic Period',1,'approved')",
  [roomId,teacherId,weekday(date),2,3]);
 const lessonId=Number(lesson.insertId);
 const [rule]=await conn.execute(
  "INSERT INTO affairs_behavior_rules(name,category,points,active) VALUES('Synthetic per-period truancy','moderate',-7,1)");
 await conn.execute('INSERT INTO truancy_score_policy(id,rule_id) VALUES(1,?)',[rule.insertId]);
 // Day absence for second student suppresses advisor review on ordinary
 // period absence. Truancy on first student still scores.
 await conn.execute(
  "INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,'absent',?)",
  [students[1],date,teacherId]);
 return {actor:{kind:'staff',id:teacherId,role:'teacher'},roomId,lessonId,
  students,ruleId:Number(rule.insertId)};
}
function body(fixture,date,first,second,note){
 const b={kind:'period',date,classroom_id:fixture.roomId,
  timetable_id:fixture.lessonId,entries:[
   {student_id:fixture.students[0],status:first},
   {student_id:fixture.students[1],status:second}
  ]};
 if(note!==undefined)b.teaching_note=note;
 return b;
}
async function getScore(conn,fixture,date){
 const [scores]=await conn.execute(
  `SELECT l.behavior_record_id,b.points,b.affairs_rule_id,b.deleted_at
   FROM truancy_behavior_links l JOIN behavior_records b ON b.id=l.behavior_record_id
   WHERE l.student_id=? AND l.timetable_id=? AND l.school_date=?`,
  [fixture.students[0],fixture.lessonId,date]);
 return scores[0]||null;
}
async function eventCounts(conn,fixture,date){
 const [[score]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM behavior_records WHERE student_id=?',
  [fixture.students[0]]);
 const [[link]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM truancy_behavior_links WHERE student_id=?',
  [fixture.students[0]]);
 const [[period]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM attendance_period WHERE timetable_id=? AND school_date=?',
  [fixture.lessonId,date]);
 return {scores:Number(score.n),links:Number(link.n),attendance:Number(period.n)};
}
async function allChecks(conn,env,date,now,{injected=false}={}){
 await conn.beginTransaction();
 try{
  const f=await seed(conn,date);
  const run=(first,second,note,extra={})=>
   applyPeriodInOpenTransaction(conn,body(f,date,first,second,note),
    {actor:f.actor,env,now,...extra});
  if(injected){
   let observed=false;
   try{
    await run('truancy','absent',undefined,
     {onStep:stage=>{if(stage==='attendance_upsert')
      throw Error('lab_period_injected_failure')}});
   }catch(e){observed=e?.message==='lab_period_injected_failure'}
   need(observed,'injected_failure_not_observed');
   return {injected:true}; // ROLLBACK in finally
  }
  const first=await run('truancy','absent','Synthetic lesson note');
  need(first.rows===2&&first.score_created===1&&
   first.advisor_review_queued===0,'first_save_result');
  const saved=await getScore(conn,f,date);
  need(saved&&Number(saved.points)===-7&&Number(saved.affairs_rule_id)===f.ruleId&&
   saved.deleted_at===null,'rule_points_or_link_wrong');
  const id=Number(saved.behavior_record_id);
  const initial=await eventCounts(conn,f,date);
  need(initial.scores===1&&initial.links===1&&initial.attendance===2,
   'initial_rows_wrong');
  const second=await run('truancy','absent');
  need(second.score_created===0,'duplicate_score_on_repeated_truancy');
  const corrected=await run('present','absent');
  need(corrected.score_reversed===1,'correction_not_counted');
  const removed=await getScore(conn,f,date);
  need(removed&&removed.deleted_at!==null,'linked_score_not_soft_deleted');
  const [periodTruancy]=await conn.execute(
   'SELECT student_id FROM period_truancy WHERE student_id=? AND timetable_id=? AND school_date=?',
   [f.students[0],f.lessonId,date]);
  need(periodTruancy.length===0,'truancy_not_retracted');
  const restored=await run('truancy','absent');
  need(restored.score_created===0,'reclassified_created_duplicate');
  const back=await getScore(conn,f,date);
  need(back&&Number(back.behavior_record_id)===id&&back.deleted_at===null,
   'original_score_not_restored');
  // Switch daily absence for second student to present to create advisor
  // review for an ordinary absence, then verify pending-only cancellation.
  await conn.execute(
   "UPDATE attendance_daily SET status='present' WHERE student_id=? AND school_date=?",
   [f.students[1],date]);
  const absent=await run('absent','absent');
  need(absent.advisor_review_queued===2,'ordinary_advisor_review_missing');
  const [alerts]=await conn.execute(
   "SELECT id,student_id,state FROM attendance_alerts WHERE timetable_id=? AND school_date=? ORDER BY student_id",
   [f.lessonId,date]);
  need(alerts.length===2&&alerts.every(a=>a.state==='pending_review'),
   'pending_review_missing');
  // Simulate a prior completed delivery for first student.
  await conn.execute(
   "UPDATE notification_outbox SET state='delivered' WHERE alert_id=? AND state='pending'",
   [alerts[0].id]);
  const changed=await run('present','present','');
  need(changed.score_created===0,'score_on_present');
  const [outbox]=await conn.execute(
   `SELECT o.state FROM notification_outbox o JOIN attendance_alerts a ON a.id=o.alert_id
   WHERE a.timetable_id=? AND a.school_date=? ORDER BY a.student_id`,
   [f.lessonId,date]);
  need(outbox.length===2&&outbox[0].state==='delivered'&&
   outbox[1].state==='cancelled','delivered_event_changed_or_pending_not_cancelled');
  const [notes]=await conn.execute(
   'SELECT 1 FROM period_teaching_logs WHERE timetable_id=? AND school_date=?',
   [f.lessonId,date]);
  need(notes.length===0,'teaching_note_clear_failed');
  const last=await getScore(conn,f,date);
  need(last&&last.deleted_at!==null,'reversed_score_not_retracted');
  const counts=await eventCounts(conn,f,date);
  need(counts.scores===1&&counts.links===1&&counts.attendance===2,
   'duplicate_score_or_attendance');
  return {scores_created:1,score_points:-7,score_reused:true,
   correction_retracted:true,ordinary_alerts:2,
   delivered_preserved:true,cancelled_pending:true};
 }finally{
  // On any exception or expected successful scenario: NO COMMIT, EVER.
  await conn.rollback();
  await assertEmpty(conn);
 }
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn,ok=false,error;
 try{
  need(env.RD_TRIGGER_LAB_ALLOW_PERIOD===OPT_IN,'opt_in_required');
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:1,queueLimit:1});
  conn=await pool.getConnection();
  await inspectSet(conn,5);
  await assertEmpty(conn);
  const now=new Date(),date=bangkokToday(now);
  const done=await allChecks(conn,env,date,now);
  const failed=await allChecks(conn,env,date,now,{injected:true});
  need(done.score_reused&&failed.injected,'test_scenario_missing');
  await assertEmpty(conn);
  await inspectSet(conn,5);
  ok=true;
 }catch(e){error=e}
 finally{
  if(conn){
   let recovered=false;
   try{await conn.rollback();recovered=true}catch{}
   if(recovered){try{conn.release()}catch{}}
   else if(typeof conn.destroy==='function')try{conn.destroy()}catch{}
  }
  if(pool){try{await pool.end()}catch{}}
 }
 if(!ok){
  const msg=String(error?.message||'');
  warn('BATCH 1 LAB PERIOD FAILED ('+
   (/^lab_[a-z_]+$/.test(msg)?msg:category(error))+').');
  warn('NO COMMIT executed. Verify lab emptiness if cleanup was not confirmed; do not retry blindly.');
  return 1;
 }
 log('BATCH 1 LAB PERIOD OK: two synthetic students, per-period truancy and ordinary absence committed nowhere.');
 log('SCORE LIFECYCLE OK: configured -7 rule, one linked record, correction soft-delete and same-ID restoration.');
 log('OUTBOX OK: daily absence suppresses advisor review; delivered preserved and pending-only cancelled.');
 log('ROLLBACK VERIFIED: full lifecycle and injected failure both reverted; no SQL COMMIT.');
 log('LAB UNCHANGED: 63 empty tables, five existing triggers and no public API or Push dispatch.');
 log('NOT PRODUCTION READY: concurrency, complete D1 business parity and Push delivery remain blocked.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('BATCH 1 LAB PERIOD FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,seed,body,getScore,eventCounts,allChecks,run};
