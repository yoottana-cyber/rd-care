'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {run:makeBackup}=require('../backup.cjs');
const {backlog,run}=require('../cron-preflight.cjs');
const {createVapidPair}=require('../push-keys.cjs');
async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-cron-lab-'));
 const priv=path.join(dir,'private'),backups=path.join(dir,'backups');
 fs.mkdirSync(priv,{mode:0o700});fs.mkdirSync(backups,{mode:0o700});
 const file=path.join(priv,'data.sqlite');
 migrate({filename:file,confirm:CONFIRM,log(){}});
 const env={
  RD_PUBLIC_ORIGIN:'https://ratsada.ac.th',
  RD_APP_MOUNT:'/web/rd-connect-fast',
  RD_SQLITE_FILE:file,
  RD_SQLITE_BACKUP_DIR:backups,
  VAPID_SUBJECT:'mailto:synthetic-only@example.org',
  ...Object.fromEntries(Object.entries(createVapidPair()).map(([k,v])=>
   [k==='publicKey'?'VAPID_PUBLIC_KEY':'VAPID_PRIVATE_KEY',v]))
 };
 await makeBackup({env,log(){}});
 return {dir,file,env,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('scheduler preflight is read-only and correctly blocks with no opted-in devices',async()=>{
 const f=await fixture();
 try{
  const lines=[],before=fs.statSync(f.file).mtimeMs;
  const result=await run({env:f.env,log:x=>lines.push(x)});
  assert.equal(result.ready,false);
  assert.equal(result.push,true);
  assert.deepEqual(result.registered,{staff:0,students:0,guardians:0});
  assert.equal(result.counts.outboxPending,0);
  assert.equal(result.counts.truancyActive,0);
  assert.equal(result.counts.lateActive,0);
  assert.equal(result.counts.scoreEvents,0);
  assert.equal(result.counts.directMessages,0);
  assert.equal(fs.statSync(f.file).mtimeMs,before);
  assert.ok(lines.some(s=>s.includes('PREFLIGHT PENDING')));
  assert.ok(lines.some(s=>s.includes('NO CRON CREATED')));
  assert.ok(lines.every(s=>!s.includes(f.env.VAPID_PRIVATE_KEY)));
 }finally{f.cleanup()}
});
test('queue count snapshot is read-only and does not infer sendable recipients',async()=>{
 const f=await fixture();
 try{
  const db=new DatabaseSync(f.file,{readOnly:true});
  try{
   assert.deepEqual(backlog(db),{
    outboxPending:0,truancyActive:0,lateActive:0,scoreEvents:0,
    directMessages:0,retryPending:0
   });
  }finally{db.close()}
 }finally{f.cleanup()}
});
