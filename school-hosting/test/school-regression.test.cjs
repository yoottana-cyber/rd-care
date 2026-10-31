'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {run:makeBackup}=require('../backup.cjs');
const {run:verifyRestore}=require('../restore-test.cjs');

async function qrModule(){
 // ESM browser module is imported from a self-contained source data URL.
 // The vendor scanner dynamic import is injected and therefore not called.
 const code=fs.readFileSync(path.resolve(__dirname,'../../web/student-late-qr-scanner.js'),'utf8');
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
test('printed school subpath QR, Cloudflare legacy QR and unrelated links',async()=>{
 const {isSchoolLateQr}=await qrModule();
 const app='https://ratsada.ac.th/web/rd-connect-fast/?login=student';
 assert.equal(isSchoolLateQr('https://ratsada.ac.th/web/rd-connect-fast/?late_qr=gate',app),true);
 assert.equal(isSchoolLateQr('https://ratsada.ac.th/web/rd-connect-fast/index.html?late_qr=gate',app),true);
 assert.equal(isSchoolLateQr('https://rd-care.pages.dev/?late_qr=gate',app),true);
 assert.equal(isSchoolLateQr('https://ratsada.ac.th/?late_qr=gate',app),false);
 assert.equal(isSchoolLateQr('https://ratsada.ac.th/web/another/?late_qr=gate',app),false);
 assert.equal(isSchoolLateQr('https://another-school.example/web/rd-connect-fast/?late_qr=gate',app),false);
 assert.equal(isSchoolLateQr('http://ratsada.ac.th/web/rd-connect-fast/?late_qr=gate',app),false);
 assert.equal(isSchoolLateQr('https://ratsada.ac.th/web/rd-connect-fast/?late_qr=other',app),false);
});
test('camera scanner signals valid QR and does not accept a random QR',async()=>{
 const {createStudentLateQrScanner}=await qrModule();
 let count=0,invalid=0,scanner;
 class MockScanner{
  constructor(_video,onRead){this.onRead=onRead;scanner=this;this.destroyed=false}
  async start(){}
  destroy(){this.destroyed=true}
 }
 const reader=createStudentLateQrScanner({
  loadScanner:async()=>MockScanner,
  origin:()=> 'https://ratsada.ac.th/web/rd-connect-fast/?login=student',
  onDetected:()=>{count++},onInvalid:()=>{invalid++}
 });
 await reader.start({});
 scanner.onRead({data:'https://ratsada.ac.th/?late_qr=gate'});
 assert.equal(invalid,1);
 assert.equal(count,0);
 scanner.onRead({data:'https://ratsada.ac.th/web/rd-connect-fast/?late_qr=gate'});
 assert.equal(count,1);
 assert.equal(scanner.destroyed,true);
});
test('school backup restores into private temporary copy without changing live DB',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-restore-'));
 const dbDir=path.join(root,'database'),backupDir=path.join(root,'backups');
 fs.mkdirSync(dbDir,{mode:0o700});fs.mkdirSync(backupDir,{mode:0o700});
 const live=path.join(dbDir,'school.sqlite');
 const env={RD_SQLITE_FILE:live,RD_SQLITE_BACKUP_DIR:backupDir};
 try{
  migrate({filename:live,confirm:CONFIRM,log(){}});
  await makeBackup({env,log(){}});
  const before=new DatabaseSync(live,{readOnly:true});
  let users;
  try{users=before.prepare('SELECT COUNT(*) AS n FROM users').get().n}
  finally{before.close()}
  const logs=[];
  const res=await verifyRestore({env,log:x=>logs.push(x)});
  assert.equal(res.ok,true);
  assert.ok(logs.some(x=>x.includes('TEMPORARY COPY REMOVED')));
  assert.equal(fs.readdirSync(backupDir).filter(x=>x.startsWith('.rd-restore-check-')).length,0);
  const after=new DatabaseSync(live,{readOnly:true});
  try{assert.equal(after.prepare('SELECT COUNT(*) AS n FROM users').get().n,users)}
  finally{after.close()}
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('restore test refuses missing or insecure backup without touching live DB',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-no-backup-'));
 const dbDir=path.join(root,'database'),backupDir=path.join(root,'backups');
 fs.mkdirSync(dbDir,{mode:0o700});fs.mkdirSync(backupDir,{mode:0o700});
 const file=path.join(dbDir,'school.sqlite');
 try{
  migrate({filename:file,confirm:CONFIRM,log(){}});
  const env={RD_SQLITE_FILE:file,RD_SQLITE_BACKUP_DIR:backupDir};
  await assert.rejects(verifyRestore({env,log(){}}),/school_backup_not_found/);
  assert.equal(fs.existsSync(file),true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
