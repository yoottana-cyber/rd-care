'use strict';
// One DirectAdmin command after a new school app code deployment.
// Synthetic functional suite + fresh consistent backup + isolated restore.
// Never imports school data, modifies live student rows or overwrites DB.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {safeSmokeDiagnostics}=require('./install.cjs');
const {run:backup}=require('./backup.cjs');
const {run:restore}=require('./restore-test.cjs');
const ROOT=path.resolve(__dirname,'..');
async function run({env=process.env,execute=spawnSync,log=console.log,warn=console.error}={}){
 const testDir=path.join(__dirname,'test');
 const scripts=fs.readdirSync(testDir)
  .filter(x=>x.endsWith('.test.cjs')).sort().map(x=>path.join(testDir,x));
 if(scripts.length<3){
  warn('SCHOOL VERIFICATION BLOCKED: synthetic_tests_missing.');return 1;
 }
 const r=execute(process.execPath,['--test','--test-concurrency=2',...scripts],{
  cwd:ROOT,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,
  env:{...env}
 });
 if(r?.status!==0||r?.signal||r?.error){
  warn('SCHOOL VERIFICATION FAILED AT 1/3: synthetic Worker/QR/HTTP tests.');
  safeSmokeDiagnostics(r,warn);
  warn('LIVE DATABASE NOT TOUCHED BY TESTS.');
  return 1;
 }
 log('[1/3] ORIGINAL WORKER, ENROLLMENT, SCHOOL PWA AND QR TESTS: OK.');
 try{
  await backup({env,log(){}});
  log('[2/3] FRESH PRIVATE SQLITE BACKUP: VERIFIED.');
  await restore({env,log(){}});
  log('[3/3] BACKUP RESTORED TO ISOLATED COPY: INTEGRITY, FK, SCHEMA AND COUNTS OK.');
  log('SCHOOL VERIFICATION PASS: CURRENT DATABASE UNCHANGED / NO REAL PUSH / NO IMPORT.');
  return 0;
 }catch(e){
  const code=String(e?.message||'');
  warn('SCHOOL VERIFICATION FAILED AT BACKUP/RESTORE ('+
   (/^school_[a-z0-9_]+$/.test(code)?code:'backup_or_restore_failed')+').');
  warn('LIVE DATABASE NOT OVERWRITTEN. Inspect private backup directory.');
  return 1;
 }
}
if(require.main===module)run().then(status=>{process.exitCode=status},()=>{
 console.error('SCHOOL VERIFICATION FAILED (unexpected).');process.exitCode=1;
});
module.exports={run};
