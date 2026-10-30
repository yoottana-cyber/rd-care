'use strict';
// RD CONNECT Node/MariaDB migration: PUSH QUEUE SQL, disposable lab ONLY.
// Not imported by public Passenger. No network, Web Push, VAPID or COMMIT.
// These functions MUST run inside a transaction controlled by the lab runner.
// Never treat a queued or claimed job as a delivered notification.
const {LAB_DATABASE}=require('../scripts/check-trigger-lab.cjs');
const OPT_IN='RUN_LAB_PUSH_QUEUE_ROLLBACK_B1';
const need=(ok,code)=>{if(!ok)throw Error('lab_push_'+code)};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const audience={advisor:'truancy_advisor',guardian:'truancy_guardian',student:'truancy_student'};
function checkPermission(env){
 need(env?.RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE===OPT_IN,'opt_in_required');
 need(env.RD_TRIGGER_LAB_DB_NAME===LAB_DATABASE &&
  env.RD_DB_NAME!==LAB_DATABASE,'wrong_environment');
}
async function checkConnection(conn){
 const [[row]]=await conn.execute('SELECT DATABASE() AS db');
 need(row?.db===LAB_DATABASE,'wrong_database');
}
// One trust-boundary query locks the truancy event before preparing any devices.
// Candidate devices are selected by SQL from the CURRENT verified relationships.
const ACTIVE_EVENT=`SELECT e.id,e.generation,e.student_id
 FROM truancy_events e
 JOIN period_truancy tr ON tr.student_id=e.student_id AND
  tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
 JOIN attendance_period p ON p.student_id=e.student_id AND
  p.timetable_id=e.timetable_id AND p.school_date=e.school_date
  AND p.status='absent'
 WHERE e.id=? AND e.active=1 LIMIT 1 FOR UPDATE`;
const QUEUE_ADVISORS=`INSERT IGNORE INTO truancy_push_deliveries
 (event_id,generation,recipient_type,subscription_id,state)
 SELECT e.id,e.generation,'advisor',s.id,'pending'
 FROM truancy_events e
 JOIN timetable t ON t.id=e.timetable_id
 JOIN classrooms c ON c.id=t.classroom_id
 JOIN staff_push_subscriptions s
  ON s.user_id IN (c.advisor_user_id,c.advisor2_user_id)
 JOIN users u ON u.id=s.user_id AND u.active=1
 WHERE e.id=? AND e.generation=? AND e.active=1
 AND COALESCE((SELECT p.enabled FROM notification_preferences p
  WHERE p.event_key='truancy_advisor'),1)=1`;
const QUEUE_GUARDIANS=`INSERT IGNORE INTO truancy_push_deliveries
 (event_id,generation,recipient_type,subscription_id,state)
 SELECT e.id,e.generation,'guardian',s.id,'pending'
 FROM truancy_events e
 JOIN guardian_student_links l ON l.student_id=e.student_id
 JOIN portal_accounts a ON a.id=l.guardian_account_id
  AND a.role='guardian' AND a.active=1 AND a.must_change_password=0
 JOIN guardian_push_subscriptions s ON s.guardian_account_id=a.id
 WHERE e.id=? AND e.generation=? AND e.active=1
 AND COALESCE((SELECT p.enabled FROM notification_preferences p
  WHERE p.event_key='truancy_guardian'),1)=1`;
const QUEUE_STUDENTS=`INSERT IGNORE INTO student_push_deliveries
 (event_kind,event_id,generation,subscription_id,state)
 SELECT 'truancy',e.id,e.generation,s.id,'pending'
 FROM truancy_events e
 JOIN portal_accounts a ON a.student_id=e.student_id AND
  a.role='student' AND a.active=1 AND a.must_change_password=0
 JOIN student_push_subscriptions s ON s.student_account_id=a.id
 WHERE e.id=? AND e.generation=? AND e.active=1
 AND COALESCE((SELECT p.enabled FROM notification_preferences p
  WHERE p.event_key='truancy_student'),1)=1`;
async function queueEvent(conn,eventId,{env}={}){
 checkPermission(env);
 need(positive(eventId),'invalid_event');
 await checkConnection(conn);
 const [[active]]=await conn.execute(ACTIVE_EVENT,[eventId]);
 if(!active)return {active:false,advisor:0,guardian:0,student:0,queued:0};
 need(positive(Number(active.generation)),'invalid_generation');
 const values=[eventId,Number(active.generation)];
 const [staff]=await conn.execute(QUEUE_ADVISORS,values);
 const [guardians]=await conn.execute(QUEUE_GUARDIANS,values);
 const [students]=await conn.execute(QUEUE_STUDENTS,values);
 const added=[staff,guardians,students].map(r=>Number(r?.affectedRows||0));
 need(added.every(v=>Number.isSafeInteger(v)&&v>=0),'invalid_queue_count');
 return {active:true,generation:Number(active.generation),
  advisor:added[0],guardian:added[1],student:added[2],
  queued:added.reduce((a,b)=>a+b,0)};
}
// Claim is atomic and checks live status + current link before consuming an
// attempt. It never calls Web Push or sets delivered; no status is a receipt.
const CURRENT=`EXISTS(SELECT 1 FROM truancy_events e
 JOIN period_truancy tr ON tr.student_id=e.student_id AND
  tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
 JOIN attendance_period p ON p.student_id=e.student_id AND
  p.timetable_id=e.timetable_id AND p.school_date=e.school_date
  AND p.status='absent'
 WHERE e.id=? AND e.generation=? AND e.active=1)`;
const verified={
 advisor:`EXISTS(SELECT 1 FROM truancy_events e
 JOIN timetable t ON t.id=e.timetable_id
 JOIN classrooms c ON c.id=t.classroom_id
 JOIN staff_push_subscriptions s ON s.id=?
 JOIN users u ON u.id=s.user_id AND u.active=1
 WHERE e.id=? AND e.generation=? AND
  s.user_id IN(c.advisor_user_id,c.advisor2_user_id))`,
 guardian:`EXISTS(SELECT 1 FROM truancy_events e
 JOIN guardian_student_links l ON l.student_id=e.student_id
 JOIN guardian_push_subscriptions s ON s.id=? AND
  s.guardian_account_id=l.guardian_account_id
 JOIN portal_accounts a ON a.id=l.guardian_account_id AND
  a.role='guardian' AND a.active=1 AND a.must_change_password=0
 WHERE e.id=? AND e.generation=?)`,
 student:`EXISTS(SELECT 1 FROM truancy_events e
 JOIN portal_accounts a ON a.student_id=e.student_id AND
  a.role='student' AND a.active=1 AND a.must_change_password=0
 JOIN student_push_subscriptions s ON s.student_account_id=a.id AND s.id=?
 WHERE e.id=? AND e.generation=?)`
};
function claimSql(type){
 need(Object.prototype.hasOwnProperty.call(audience,type),'invalid_audience');
 const table=type==='student'?'student_push_deliveries':'truancy_push_deliveries';
 const key=type==='student'?
  "event_kind='truancy' AND event_id=? AND generation=? AND subscription_id=?":
  'event_id=? AND generation=? AND recipient_type=? AND subscription_id=?';
 return `UPDATE ${table} SET state='sending',attempts=attempts+1,
  updated_at=CURRENT_TIMESTAMP WHERE ${key} AND attempts<3 AND
  (state='pending' OR (state IN ('sending','failed') AND
    updated_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 2 MINUTE)))
  AND COALESCE((SELECT p.enabled FROM notification_preferences p
   WHERE p.event_key='${audience[type]}'),1)=1
  AND ${CURRENT} AND ${verified[type]}`;
}
async function claim(conn,{event_id,generation,type,subscription_id},{env}={}){
 checkPermission(env);
 need(positive(event_id)&&positive(generation)&&positive(subscription_id),'invalid_claim');
 need(Object.prototype.hasOwnProperty.call(audience,type),'invalid_audience');
 await checkConnection(conn);
 const keys=type==='student'?
  [event_id,generation,subscription_id]:
  [event_id,generation,type,subscription_id];
 const [result]=await conn.execute(claimSql(type),[
  ...keys,event_id,generation,subscription_id,event_id,generation
 ]);
 need(Number.isSafeInteger(Number(result.affectedRows)),'invalid_claim_count');
 return {claimed:Number(result.affectedRows)===1,sent:false};
}
module.exports={OPT_IN,checkPermission,checkConnection,ACTIVE_EVENT,
 QUEUE_ADVISORS,QUEUE_GUARDIANS,QUEUE_STUDENTS,queueEvent,
 CURRENT,verified,claimSql,claim};
