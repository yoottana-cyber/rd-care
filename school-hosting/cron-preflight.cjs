'use strict';
// READ-ONLY rehearsal for enabling the school scheduler. Never invokes
// worker.scheduled(), never sends network requests, never changes SQLite.
// Queue counts indicate possible work, NOT exact notification recipients.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {WEB_ROOT,verifyReady,settings}=require('./server.cjs');
const {privatePermissions,validateBackup,BACKUP_WARN_HOURS}=require('./pilot-check.cjs');
const {run:checkPush}=require('./push-check.cjs');

function backlog(db){
 const n=query=>Number(db.prepare(query).get().n);
 return Object.freeze({
  outboxPending:n("SELECT COUNT(*) AS n FROM notification_outbox WHERE state='pending'"),
  truancyActive:n("SELECT COUNT(*) AS n FROM truancy_events WHERE active=1 AND school_date>=date('now','+7 hours','-7 days')"),
  lateActive:n("SELECT COUNT(*) AS n FROM late_qr_auto_events WHERE active=1 AND school_date>=date('now','+7 hours','-7 days')"),
  scoreEvents:n("SELECT COUNT(*) AS n FROM behavior_score_push_events WHERE created_at>=datetime('now','-7 days')"),
  directMessages:n("SELECT COUNT(*) AS n FROM student_direct_messages WHERE created_at>=datetime('now','-7 days')"),
  retryPending:n("SELECT COUNT(*) AS n FROM truancy_push_deliveries WHERE state IN ('pending','failed')")+
   n("SELECT COUNT(*) AS n FROM late_qr_push_deliveries WHERE state IN ('pending','failed')")+
   n("SELECT COUNT(*) AS n FROM student_push_deliveries WHERE state IN ('pending','failed')")+
   n("SELECT COUNT(*) AS n FROM student_message_push_deliveries WHERE state IN ('pending','failed')")+
   n("SELECT COUNT(*) AS n FROM behavior_score_push_deliveries WHERE state IN ('pending','failed')")
 });
}
async function run({env=process.env,log=console.log}={}){
 if(Number(process.versions.node.split('.')[0])<24)
  throw Error('school_cron_node_24_required');
 settings(env);
 const live=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 if(!fs.existsSync(live))throw Error('school_cron_database_missing');
 privatePermissions(path.dirname(live),live);
 const push=await checkPush({env,log(){}});
 let counts;
 const db=new DatabaseSync(live,{readOnly:true,allowExtension:false});
 try{verifyReady({sqlite:db});counts=backlog(db)}
 finally{db.close()}
 const backup=validateBackup(env);
 const allRegistered=Object.values(push.counts).every(n=>n>0);
 const backupFresh=backup.ageHours<=BACKUP_WARN_HOURS;
 const ready=push.ready&&allRegistered&&backupFresh;

 log('RD CONNECT CRON PREFLIGHT — READ ONLY / NO NOTIFICATIONS SENT.');
 log('VAPID KEYPAIR: '+(push.ready?'READY':'NOT READY ('+push.code+')'));
 log('REGISTERED OPT-IN DEVICES (AGGREGATE): teacher '+push.counts.staff+
  ', student '+push.counts.students+', verified guardian '+push.counts.guardians+'.');
 log('BACKUP: private verified snapshot age '+backup.ageHours+'h ('+
  (backupFresh?'FRESH':'STALE — DAILY BACKUP SCHEDULE REQUIRED')+').');
 log('EVENT COUNTS (NOT EXACT SENDABLE QUEUE): pending advisor outbox '+counts.outboxPending+
  '; active truancy 7d '+counts.truancyActive+'; late QR 7d '+counts.lateActive+
  '; behavior events 7d '+counts.scoreEvents+'; direct messages 7d '+counts.directMessages+
  '; delivery retry ledgers '+counts.retryPending+'.');
 log('IMPORTANT: school:cron may send existing eligible events on its first run.');
 log('OPERATOR MUST confirm recipient permissions/consent and inspect current pilot events before enabling.');
 log('CRON SCHEDULER/ENVIRONMENT: NOT CHECKED; actual DirectAdmin Cron must be tested separately.');
 log(ready?'PREFLIGHT PASS — manual recipient review still required before first real scheduled send.':
  'PREFLIGHT PENDING — do not schedule school:cron before missing gates are resolved.');
 log('LIVE DATABASE UNCHANGED; NO CRON CREATED; NO PUSH PROVIDER CONTACTED.');
 return {ready,push:push.ready,counts,backupFresh,registered:push.counts};
}
if(require.main===module){
 run().then(result=>{if(!result.ready)process.exitCode=2})
  .catch(error=>{
   const code=String(error?.message||'');
   console.error('SCHOOL CRON PREFLIGHT BLOCKED ('+
    (/^school_[a-z0-9_]+$/.test(code)?code:'school_cron_preflight_failed')+').');
   process.exitCode=1;
  });
}
module.exports={backlog,run};
