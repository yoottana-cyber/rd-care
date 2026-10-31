'use strict';
// RD CONNECT school pilot readiness: read-only inspection, never writes records.
// Only aggregate counts; no usernames, passwords, student names or path leakage.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {backupRoot}=require('./backup.cjs');
const {latestBackup}=require('./restore-test.cjs');
const {verifyReady,WEB_ROOT,settings}=require('./server.cjs');

const TEMP_VARS=Object.freeze([
 'RD_SCHOOL_INIT_CONFIRM','RD_SCHOOL_ADMIN_CONFIRM',
 'RD_SETUP_USERNAME','RD_SETUP_DISPLAY_NAME','RD_SETUP_PASSWORD'
]);
const BACKUP_WARN_HOURS=36;
function n(db,statement){return Number(db.prepare(statement).get().n)}
function inspectDb(db){
 verifyReady(db);
 if(db.sqlite.prepare('PRAGMA foreign_key_check').all().length)
  throw Error('school_pilot_foreign_keys_failed');
 const sql=db.sqlite;
 return Object.freeze({
  rooms:n(sql,'SELECT COUNT(*) AS n FROM classrooms'),
  teachers:n(sql,"SELECT COUNT(*) AS n FROM users WHERE active=1 AND role IN ('teacher','staff')"),
  advisors:n(sql,'SELECT COUNT(*) AS n FROM classrooms WHERE advisor_user_id IS NOT NULL OR advisor2_user_id IS NOT NULL'),
  activeStudents:n(sql,'SELECT COUNT(*) AS n FROM students WHERE active=1'),
  enrolledRooms:n(sql,'SELECT COUNT(DISTINCT h.classroom_id) AS n FROM student_enrollments h JOIN students s ON s.id=h.student_id WHERE h.end_date IS NULL AND s.active=1'),
  studentAccounts:n(sql,"SELECT COUNT(*) AS n FROM portal_accounts WHERE active=1 AND role='student'"),
  guardians:n(sql,"SELECT COUNT(*) AS n FROM portal_accounts WHERE active=1 AND role='guardian'"),
  guardianLinks:n(sql,'SELECT COUNT(*) AS n FROM guardian_student_links'),
  dailyRecords:n(sql,'SELECT COUNT(*) AS n FROM attendance_daily'),
  periodRecords:n(sql,'SELECT COUNT(*) AS n FROM attendance_period')
 });
}
function privatePermissions(dir,file){
 const ds=fs.lstatSync(dir),df=fs.lstatSync(file);
 if(ds.isSymbolicLink()||!ds.isDirectory()||ds.mode&0o077)
  throw Error('school_pilot_private_directory_permissions');
 if(df.isSymbolicLink()||!df.isFile()||df.mode&0o077)
  throw Error('school_pilot_database_file_permissions');
}
function validateBackup(env,now=Date.now()){
 const dir=backupRoot(env);
 const ds=fs.lstatSync(dir);
 if(ds.mode&0o077)throw Error('school_pilot_backup_directory_permissions');
 const item=latestBackup(dir); // Only expected owner-only rd-connect snapshots.
 const backup=new DatabaseSync(item.file,{readOnly:true,allowExtension:false});
 try{inspectDb({sqlite:backup})}finally{backup.close()}
 return {ageHours:Math.max(0,Math.round((now-item.mtimeMs)/3600000))};
}
function classify({counts,backups,env}){
 const notes=[];
 if(counts.rooms!==48)throw Error('school_pilot_room_catalog_mismatch');
 if(counts.enrolledRooms<5)notes.push('IMPORT_PILOT_ROSTERS: fewer than 5 classrooms have active enrolled students.');
 if(counts.teachers<5||counts.advisors<5)
  notes.push('ASSIGN_PILOT_TEACHERS: fewer than 5 active teachers or assigned advisor rooms.');
 if(backups.ageHours>BACKUP_WARN_HOURS)
  notes.push('SCHEDULE_DAILY_BACKUP: latest valid backup is older than 36 hours.');
 const push=Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
 if(!push)notes.push('CONFIGURE_SCHOOL_VAPID: Web Push keys/subject are incomplete.');
 notes.push('VERIFY_CRON_MANUALLY: backup and school:cron schedules cannot be inferred from this read-only command.');
 notes.push('TEST_PUSH_ON_DEVICES: configuration alone does not prove delivery or consent.');
 notes.push('CHECK_PILOT_ACCESS: verify each of 5–10 class advisor, student and guardian accounts by hand.');
 return {notes,push};
}
async function run({env=process.env,log=console.log,now=Date.now()}={}){
 if(Number(process.versions.node.split('.')[0])<24)
  throw Error('school_pilot_node_24_required');
 settings(env); // same validated school origin and mount.
 if(TEMP_VARS.some(name=>Object.hasOwn(env,name)))
  throw Error('school_pilot_setup_secrets_present');
 const file=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 if(!fs.existsSync(file))throw Error('school_pilot_live_database_missing');
 privatePermissions(path.dirname(file),file);
 let db,counts;
 try{
  db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
  counts=inspectDb({sqlite:db});
 }finally{db?.close()}
 const backups=validateBackup(env,now);
 const result=classify({counts,backups,env});
 log('RD CONNECT PILOT READINESS — READ-ONLY CHECK, NO REAL ATTENDANCE WRITES.');
 log('DATABASE: 46 migrations checked; 48 classrooms; integrity and foreign keys OK.');
 log('ACCESS: teacher accounts '+counts.teachers+'; advisor rooms '+counts.advisors+
  '; enrolled rooms '+counts.enrolledRooms+'.');
 log('RECORDS: active students '+counts.activeStudents+', student portal accounts '+
  counts.studentAccounts+', guardian portal accounts '+counts.guardians+
  ', verified guardian links '+counts.guardianLinks+'.');
 log('ATTENDANCE HISTORY: daily '+counts.dailyRecords+'; period '+counts.periodRecords+'.');
 log('BACKUP: latest owner-only private snapshot passes schema/integrity checks; age '+
  backups.ageHours+'h.');
 log('VAPID CONFIGURATION: '+(result.push?'PRESENT (pair must pass school:push-check; delivery untested)':'INCOMPLETE'));
 for(const note of result.notes)log('NEXT: '+note);
 const needsPreparation=result.notes.some(text=>/^(IMPORT_PILOT_ROSTERS|ASSIGN_PILOT_TEACHERS|SCHEDULE_DAILY_BACKUP|CONFIGURE_SCHOOL_VAPID):/.test(text));
 log('READ-ONLY DATABASE INSPECTION PASS. '+
  (needsPreparation?'PILOT PREPARATION PENDING.':'AUTOMATED GATES CHECKED.')+
  ' CRON, PUSH AND CLASSROOM ACCESS STILL REQUIRE MANUAL VERIFICATION.');
 log('LIVE DATABASE UNCHANGED; NO PUSH SENT; NO DATA IMPORTED.');
 return {ok:true,preparationPending:needsPreparation,counts,backupAgeHours:backups.ageHours,notes:result.notes};
}
if(require.main===module)run().catch(e=>{
 const code=String(e?.message||'');
 console.error('SCHOOL PILOT CHECK BLOCKED ('+
  (/^school_[a-z0-9_]+$/.test(code)?code:'pilot_read_only_check_failed')+').');
 process.exitCode=1;
});
module.exports={TEMP_VARS,BACKUP_WARN_HOURS,inspectDb,privatePermissions,validateBackup,classify,run};
