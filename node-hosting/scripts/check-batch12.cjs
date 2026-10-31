'use strict';
// RD CONNECT consolidated batch 1+2 audit for DirectAdmin.
// One command; offline unit tests followed by a READ-ONLY migration planner.
// Exit 0 is NOT a production GO; if source manifest is missing exit 2.
// This script cannot import data, enable APIs, or alter live Cloudflare.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {run:plan}=require('./check-d1-migration-plan.cjs');

const {existsSync}=require('node:fs');

// Only report allowlisted test names and coarse tool errors. Never echo raw
// TAP diagnostics, stack traces, environment variables or login secrets.
function safeOfflineFailure(proc,tests,warn=console.error){
 const errorCode=String(proc?.error?.code||'');
 const code=['ETIMEDOUT','ENOBUFS','ENOENT','EACCES'].includes(errorCode)?
  errorCode:'none';
 const status=Number.isInteger(proc?.status)?proc.status:'unknown';
 const signal=typeof proc?.signal==='string'&&
  /^[A-Z0-9]{2,16}$/.test(proc.signal)?proc.signal:'none';
 warn('BATCH 1+2 OFFLINE DIAGNOSTIC: exit='+status+
  ' signal='+signal+' error='+code+'.');
 const missing=tests.filter(p=>!existsSync(p));
 for(const file of missing.slice(0,5))
  warn('BATCH 1+2 MISSING TEST FILE: '+path.basename(file));
 // Synthetic test titles are fixed in repository code; never print arbitrary
 // error payloads or assertion values from TAP output.
 const raw=String(proc?.stdout||'');
 // Nested TAP (and Node --test bootstrap errors) can be indented.
 const failing=raw.split(/\r?\n/).filter(line=>/^\\s*not ok \\d+ - /.test(line));
 warn('BATCH 1+2 TAP FAILING CASES: '+failing.length+'.');
 for(const line of failing.slice(0,8)){
  const testName=line.replace(/^\\s*not ok \\d+ - /,'').trim().slice(0,140)
   .replace(/[a-f0-9]{48,}/ig,'[redacted]')
   .replace(/[^a-zA-Z0-9 _.,:;()\\-]/g,'?');
  warn('BATCH 1+2 FAILED CASE: '+testName);
 }
 // Classify only allowlisted bootstrap problems. NEVER echo stderr, paths,
 // stack traces, environment variables, or untrusted test assertions.
 const stderr=String(proc?.stderr||'');
 const categories=[
  ['ReferenceError','REFERENCE_ERROR'],
  ['SyntaxError','SYNTAX_ERROR'],
  ['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'],
  ['MODULE_NOT_FOUND','MODULE_NOT_FOUND'],
  ['ENOENT','FILE_NOT_FOUND'],
  ['EACCES','ACCESS_DENIED']
 ];
 const found=categories.find(([needle])=>stderr.includes(needle));
 if(found)warn('BATCH 1+2 NODE BOOTSTRAP CATEGORY: '+found[1]+'.');
 if(code==='ETIMEDOUT')
  warn('BATCH 1+2 TEST PROCESS TIMED OUT (no schema or DB operation from test runner).');
 if(!failing.length&&missing.length===0&&code==='none')
  warn('BATCH 1+2 NO TAP FAILURES RECORDED: check Node test runner availability and stderr privately.');
 return {status,signal,error:code,failing:failing.length,missing:missing.length};
}


async function run({env=process.env,execute=spawnSync,migration=plan,
 log=console.log,warn=console.error}={}){
 const tests=[
  path.join(__dirname,'../test/batch1-school-read.test.cjs'),
  path.join(__dirname,'../test/batch1-integrated-http.test.cjs'),
  path.join(__dirname,'../test/batch1-integrated-db.test.cjs'),
  path.join(__dirname,'../test/batch12-diagnostics.test.cjs'),
  path.join(__dirname,'../test/batch1-auth-read-journey.test.cjs'),
  path.join(__dirname,'../test/staging-auth-http.test.cjs'),
  path.join(__dirname,'../test/batch1-attendance-write.test.cjs'),
  path.join(__dirname,'../test/batch1-timetable-parity.test.cjs'),
  path.join(__dirname,'../test/batch1-lab-daily-attendance.test.cjs'),
  path.join(__dirname,'../test/batch1-period-effects.test.cjs'),
  path.join(__dirname,'../test/batch1-lab-period.test.cjs'),
  path.join(__dirname,'../test/batch1-truancy-push-offline.test.cjs'),
  path.join(__dirname,'../test/batch1-lab-push-queue.test.cjs'),
  path.join(__dirname,'../test/batch1-lab-push-receipt.test.cjs'),
  path.join(__dirname,'../test/batch1-lab-push-dispatch.test.cjs'),
  path.join(__dirname,'../test/batch2-manifest.test.cjs'),
  path.join(__dirname,'../test/batch2-reconciliation.test.cjs'),
  path.join(__dirname,'../test/d1-rollback-rehearsal.test.cjs'),
  path.join(__dirname,'../test/d1-synthetic-fixture.test.cjs'),
  path.join(__dirname,'../test/timetable-offline-api-contract.test.cjs')
 ];
 let proc;
 try{
  proc=execute(process.execPath,['--test','--test-concurrency=2',...tests],{
   cwd:path.join(__dirname,'..'),
   env:{...env},encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024
  });
 }catch{
  proc={status:null,error:{code:'spawn_error'}};
 }
 if(proc?.error||proc?.status!==0){
  warn('BATCH 1+2 OFFLINE TESTS FAILED (unit_contract).');
  safeOfflineFailure(proc,tests,warn);
  return 1;
 }
 log('BATCH 1 OFFLINE OK: staff/portal read-only authorization, rosters, daily and portal views.');
 log('BATCH 1 PRIVATE AUTH+SCHOOL OK: token-backed teacher, student, guardian read-only HTTP workflows.');
 log('BATCH 1 WRITE GUARDS OK: daily/period roster, rights, truancy blocker and timetable history tests.');
 log('BATCH 1 HTTP CLOSED: Passenger still blocks unported school API routes.');
 log('BATCH 2 PLANNER OK: manifest validation, file integrity and foreign-key ordering unit tests.');
 const code=await migration({env,log,warn});
 if(code===2){
  warn('BATCH 1+2 SOURCE/MIGRATION PENDING: no school data imported; production NOT READY.');
  return 2;
 }
 if(code!==0){warn('BATCH 1+2 PLAN FAILED; no import executed.');return 1}
 warn('BATCH 1+2 DRY RUN ONLY: data migration and full API parity NOT COMPLETE.');
 return 2;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('BATCH 1+2 AUDIT FAILED (unknown).');process.exitCode=1;
});
module.exports={run,safeOfflineFailure};
