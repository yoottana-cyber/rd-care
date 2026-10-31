'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {run:createKeys,FILE_NAME}=require('../push-keys.cjs');
const {run:check}=require('../push-check.cjs');
function lab(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-push-lab-'));
 const privateDir=path.join(root,'private');
 fs.mkdirSync(privateDir,{mode:0o700});
 const file=path.join(privateDir,'school.sqlite');
 const env={
  RD_PUBLIC_ORIGIN:'https://ratsada.ac.th',
  RD_APP_MOUNT:'/web/rd-connect-fast',
  RD_SQLITE_FILE:file
 };
 migrate({filename:file,confirm:CONFIRM,log(){}});
 return {env,root,privateDir,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('one-time VAPID generation writes owner-only file, never logs secrets or overwrites',()=>{
 const t=lab();
 try{
  const lines=[],result=createKeys({env:t.env,log:x=>lines.push(x)});
  const written=fs.readFileSync(result.file,'utf8');
  assert.equal(path.basename(result.file),FILE_NAME);
  assert.equal(fs.statSync(result.file).mode&0o077,0);
  assert.match(written,/^VAPID_PUBLIC_KEY=[A-Za-z0-9_-]{87}$/m);
  assert.match(written,/^VAPID_PRIVATE_KEY=[A-Za-z0-9_-]{43}$/m);
  const secrets=written.trim().split('\n').map(x=>x.split('=')[1]);
  for(const secret of secrets)assert.ok(lines.every(line=>!line.includes(secret)));
  assert.throws(()=>createKeys({env:t.env,log(){}}),
   /school_push_setup_file_already_exists/);
 }finally{t.close()}
});
test('do not generate new VAPID keys when environment already contains keys',()=>{
 const t=lab();
 try{
  assert.throws(()=>createKeys({env:{...t.env,VAPID_PUBLIC_KEY:'already-set'},log(){}}),
   /school_push_existing_vapid_settings/);
  assert.equal(fs.existsSync(path.join(t.privateDir,FILE_NAME)),false);
 }finally{t.close()}
});
test('read-only VAPID check accepts matching generated keypair and reports no subscribers',async()=>{
 const t=lab();
 try{
  const {file}=createKeys({env:t.env,log(){}});
  const text=fs.readFileSync(file,'utf8');
  const keys=Object.fromEntries(text.trim().split('\n').map(row=>row.split('=')));
  const env={...t.env,...keys,VAPID_SUBJECT:'mailto:pilot-example@example.org'};
  const lines=[];
  const first=await check({env,log:x=>lines.push(x)});
  assert.equal(first.ready,true);
  assert.deepEqual(first.counts,{staff:0,students:0,guardians:0});
  assert.ok(lines.some(x=>x.includes('PAIR VERIFIED')));
  assert.ok(lines.every(x=>!x.includes(keys.VAPID_PRIVATE_KEY)));
  assert.equal(fs.existsSync(t.env.RD_SQLITE_FILE),true);
  const unmatched=await check({env:{...env,VAPID_SUBJECT:'invalid'},log(){}});
  assert.equal(unmatched.ready,false);
  assert.equal(unmatched.code,'invalid_subject');
  const missing=await check({env:t.env,log(){}});
  assert.equal(missing.ready,false);
  assert.equal(missing.code,'missing_settings');
 }finally{t.close()}
});
test('VAPID read-only check refuses permissive private folders and does not create database',async()=>{
 const t=lab();
 try{
  fs.chmodSync(t.privateDir,0o755);
  await assert.rejects(check({env:t.env,log(){}}),/school_pilot_private_directory_permissions/);
  fs.chmodSync(t.privateDir,0o700);
 }finally{t.close()}
});
