'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {run:backup}=require('../backup.cjs');
const {run:check,classify,privatePermissions}=require('../pilot-check.cjs');

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rd-pilot-check-'));
 const privateDir=path.join(root,'private'),backups=path.join(root,'backup');
 fs.mkdirSync(privateDir,{mode:0o700});
 fs.mkdirSync(backups,{mode:0o700});
 const file=path.join(privateDir,'school.sqlite');
 const env={
  RD_PUBLIC_ORIGIN:'https://ratsada.ac.th',
  RD_APP_MOUNT:'/web/rd-connect-fast',
  RD_SQLITE_FILE:file,
  RD_SQLITE_BACKUP_DIR:backups
 };
 return {root,privateDir,backups,file,env,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('read-only pilot check reports only counts and does not mutate live student DB',async()=>{
 const f=fixture();
 try{
  migrate({filename:f.file,confirm:CONFIRM,log(){}});
  await backup({env:f.env,log(){}});
  const before=fs.statSync(f.file).mtimeMs;
  const lines=[];
  const res=await check({env:f.env,log:x=>lines.push(x)});
  assert.equal(res.ok,true);
  assert.equal(res.counts.rooms,48);
  assert.equal(res.counts.activeStudents,0);
  assert.equal(res.counts.enrolledRooms,0);
  assert.ok(res.notes.some(v=>v.startsWith('IMPORT_PILOT_ROSTERS')));
  assert.ok(res.notes.some(v=>v.startsWith('VERIFY_CRON_MANUALLY')));
  assert.equal(fs.statSync(f.file).mtimeMs,before);
  assert.ok(lines.some(s=>s.includes('NO DATA IMPORTED')));
  assert.ok(lines.every(s=>!s.includes(f.file)&&!s.includes(f.root)));
 }finally{f.cleanup()}
});
test('pilot check refuses leftover setup secrets before opening database',async()=>{
 const f=fixture();
 try{
  await assert.rejects(check({env:{...f.env,RD_SETUP_PASSWORD:'do-not-echo'},log(){}}),
   /school_pilot_setup_secrets_present/);
 }finally{f.cleanup()}
});
test('pilot check refuses a missing private database and permissive directories',async()=>{
 const f=fixture();
 try{
  await assert.rejects(check({env:f.env,log(){}}),/school_pilot_live_database_missing/);
  migrate({filename:f.file,confirm:CONFIRM,log(){}});
  fs.chmodSync(f.privateDir,0o755);
  assert.throws(()=>privatePermissions(f.privateDir,f.file),
   /school_pilot_private_directory_permissions/);
  fs.chmodSync(f.privateDir,0o700);
 }finally{f.cleanup()}
});
test('VAPID flags never imply cron delivery and old backups remain a warning',()=>{
 const counts={rooms:48,enrolledRooms:5,teachers:5,advisors:5};
 const x=classify({counts,backups:{ageHours:48},env:{
  VAPID_PUBLIC_KEY:'present',VAPID_PRIVATE_KEY:'present',VAPID_SUBJECT:'present'
 }});
 assert.equal(x.push,true);
 assert.ok(x.notes.some(n=>n.startsWith('SCHEDULE_DAILY_BACKUP')));
 assert.ok(x.notes.some(n=>n.startsWith('VERIFY_CRON_MANUALLY')));
 assert.ok(x.notes.some(n=>n.startsWith('TEST_PUSH_ON_DEVICES')));
});
