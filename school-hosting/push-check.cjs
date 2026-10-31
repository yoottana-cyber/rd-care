'use strict';
// Read-only school Web Push readiness probe. Never contacts Push providers
// or sends a notification. Do not print VAPID secrets, endpoints, usernames,
// school student names, or device encryption keys.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {settings,WEB_ROOT,verifyReady}=require('./server.cjs');
const {privatePermissions}=require('./pilot-check.cjs');

function subscriptionCounts(sqlite){
 const count=sql=>Number(sqlite.prepare(sql).get().n);
 return Object.freeze({
  staff:count("SELECT COUNT(*) AS n FROM staff_push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=1"),
  students:count("SELECT COUNT(*) AS n FROM student_push_subscriptions ps JOIN portal_accounts a ON a.id=ps.student_account_id WHERE a.role='student' AND a.active=1 AND a.must_change_password=0"),
  guardians:count("SELECT COUNT(*) AS n FROM guardian_push_subscriptions ps JOIN portal_accounts a ON a.id=ps.guardian_account_id WHERE a.role='guardian' AND a.active=1 AND a.must_change_password=0 AND EXISTS (SELECT 1 FROM guardian_student_links g WHERE g.guardian_account_id=a.id)")
 });
}
async function readVapidDiagnostic(env){
 const file=path.resolve(__dirname,'../worker/src/staff-push.js');
 const mod=await import(pathToFileURL(file).href);
 return mod.diagnoseVapid(env);
}
async function run({env=process.env,log=console.log,diagnose=readVapidDiagnostic}={}){
 if(Number(process.versions.node.split('.')[0])<24)
  throw Error('school_push_node_24_required');
 settings(env);
 const file=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 if(!fs.existsSync(file))throw Error('school_push_database_not_ready');
 privatePermissions(path.dirname(file),file);
 const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 let counts;
 try{
  verifyReady({sqlite:db});
  counts=subscriptionCounts(db);
 }finally{db.close()}
 const vapid=await diagnose(env);
 if(!vapid||typeof vapid.ready!=='boolean')
  throw Error('school_push_diagnostic_unavailable');
 log('RD CONNECT SCHOOL PUSH CHECK — READ ONLY. NO NOTIFICATION SENT.');
 log('VAPID: '+(vapid.ready?'READY (PUBLIC/PRIVATE KEY PAIR VERIFIED)':'NOT READY ('+vapid.code+')'));
 if(!vapid.ready&&Array.isArray(vapid.missing)&&vapid.missing.length)
  log('MISSING SETTING NAMES ONLY: '+vapid.missing.join(', '));
 log('ELIGIBLE REGISTERED DEVICES: teacher '+counts.staff+
  ', student '+counts.students+', verified guardian '+counts.guardians+'.');
 if(vapid.ready&&counts.staff+counts.students+counts.guardians===0)
  log('NEXT: Have a test teacher/student/verified guardian opt in from their own PWA first.');
 if(vapid.ready)
  log('NEXT: Test a GENERIC self-notification from each opted-in device in app settings.');
 log('CRON: NOT CHECKED; DO NOT START school:cron UNTIL DEVICES AND RECIPIENT RULES ARE VERIFIED.');
 log('LIVE SQLITE UNCHANGED; SECRETS HIDDEN; NO PUSH PROVIDER CONTACTED.');
 return {ready:vapid.ready,code:vapid.code,counts};
}
if(require.main===module){
 run().catch(e=>{
  const code=String(e?.message||'');
  console.error('SCHOOL PUSH CHECK BLOCKED ('+
   (/^school_push_[a-z0-9_]+$/.test(code)?code:'school_push_read_only_check_failed')+').');
  process.exitCode=1;
 });
}
module.exports={subscriptionCounts,readVapidDiagnostic,run};
