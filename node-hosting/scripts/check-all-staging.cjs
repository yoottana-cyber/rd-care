'use strict';
// RD CONNECT — consolidated DirectAdmin STAGING-only verification.
// Run ONE npm script. It executes previously isolated/offline checks
// sequentially with exact child-process-only lab permissions.
// Never import real D1 student data, set live flags, run COMMIT,
// enable public routes, or send actual Web Push.
// NOTE: this is test-completion (exit 0), never go-live approval.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {getLabConfig}=require('./check-trigger-lab.cjs');
const {assertStagingEnvironment}=require('../src/release-readiness.cjs');

const STEPS=Object.freeze([
 Object.freeze({
  name:'OFFLINE_AND_MIGRATION_PLAN',
  script:'check-batch12.cjs',
  expected:2,
  markers:['BATCH 1 OFFLINE OK','BATCH 1 HTTP CLOSED','BATCH 2 PLANNER OK']
 }),
 Object.freeze({
  name:'AUTH_HTTP_MARIADB_ROLLBACK',
  script:'check-auth-http-db.cjs',
  expected:0,
  markers:['STEP 6.6 OK','ROLLBACK VERIFIED','HTTPS LOGIN NOT ENABLED']
 }),
 Object.freeze({
  name:'INTEGRATED_HTTP_MARIADB_ROLLBACK',
  script:'check-integrated-http-db.cjs',
  expected:0,
  markers:['INTEGRATED HTTP MARIADB OK','PERMISSION ISOLATION OK',
   'ROLLBACK VERIFIED','PUBLIC API CLOSED']
 }),
 Object.freeze({
  name:'PUSH_RECIPIENTS_OFFLINE',
  script:'check-push-offline.cjs',
  expected:0,
  markers:['PUSH OFFLINE OK','PUBLIC API CLOSED','NO DB ACCESS OR PUSH']
 }),
 Object.freeze({
  name:'PUSH_RECEIPTS_OFFLINE',
  script:'check-push-receipts-offline.cjs',
  expected:0,
  markers:['PUSH RECEIPTS OFFLINE OK','STALE CLAIMS BLOCKED','NO DB OR NETWORK']
 }),
 Object.freeze({
  name:'DAILY_ATTENDANCE_ROLLBACK',
  script:'check-lab-daily-attendance-rollback.cjs',
  expected:0,
  flag:'RD_TRIGGER_LAB_ALLOW_ATTENDANCE',
  permission:'RUN_LAB_DAILY_ATTENDANCE_ROLLBACK_B1',
  markers:['BATCH 1 LAB DAILY OK','ROLLBACK VERIFIED','LAB UNCHANGED']
 }),
 Object.freeze({
  name:'PERIOD_TRUANCY_ROLLBACK',
  script:'check-lab-period-truancy-rollback.cjs',
  expected:0,
  flag:'RD_TRIGGER_LAB_ALLOW_PERIOD',
  permission:'RUN_LAB_PERIOD_TRUANCY_ROLLBACK_B1',
  markers:['BATCH 1 LAB PERIOD OK','SCORE LIFECYCLE OK','ROLLBACK VERIFIED','LAB UNCHANGED']
 }),
 Object.freeze({
  name:'PUSH_QUEUE_ROLLBACK',
  script:'check-lab-push-queue-rollback.cjs',
  expected:0,
  flag:'RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE',
  permission:'RUN_LAB_PUSH_QUEUE_ROLLBACK_B1',
  markers:['PUSH QUEUE LAB OK','CLAIM AND DEDUPE OK','ROLLBACK VERIFIED','LAB UNCHANGED']
 }),
 Object.freeze({
  name:'PUSH_MOCK_DISPATCH_ROLLBACK',
  script:'check-lab-push-dispatch-rollback.cjs',
  expected:0,
  flag:'RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE',
  permission:'RUN_LAB_PUSH_QUEUE_ROLLBACK_B1',
  markers:['PUSH DISPATCH LAB OK','RECEIPT INTEGRITY OK','ROLLBACK VERIFIED','LAB UNCHANGED']
 }),
 Object.freeze({
  name:'AUTH_PORTAL_READ_ROLLBACK',
  script:'check-lab-auth-read-journey.cjs',
  expected:0,
  markers:['AUTH + READ LAB OK','ACCESS CONTROL OK','SESSION ISOLATION OK',
   'ROLLBACK VERIFIED','LAB UNCHANGED']
 }),
 Object.freeze({
  name:'RELEASE_NO_GO_GUARD',
  script:'check-go-live-readiness.cjs',
  expected:2,
  markers:['RELEASE READINESS NO_GO','STAGING SCHEMA OK','PUBLIC ENDPOINTS CLOSED','NO DB WRITES']
 })
]);

function preflight(env){
 if(!env||typeof env!=='object')throw Error('suite_invalid_environment');
 // Guard release staging and block every temporary write/DDL opt-in.
 assertStagingEnvironment(env);
 const old=Object.keys(env).filter(key=>
  key.startsWith('RD_TRIGGER_LAB_ALLOW_')&&String(env[key]||'').length>0
 );
 if(old.length)throw Error('suite_remove_old_lab_flags');
 if(env.RD_MIGRATION_ALLOW_IMPORT||env.RD_ENABLE_SCHOOL_WRITES)
  throw Error('suite_school_import_or_writes_enabled');
 // This validates the *separate*, explicit lab account before spawning tests.
 // The script does not need to print or access private credentials itself.
 getLabConfig(env);
 return true;
}
function childEnv(env,step){
 const next={...env};
 if(step.flag)next[step.flag]=step.permission;
 return next;
}
function accepted(result,step){
 if(!result||result.error||result.signal||result.status!==step.expected)return false;
 const output=String(result.stdout||'');
 return step.markers.every(marker=>output.includes(marker));
}
// Echo only fixed, redacted diagnostic lines from the offline runner.
// Never print untrusted child stderr/stdout, stack traces or DB credentials.
function reportSafeStepFailure(result,step,warn){
 const status=Number.isInteger(result?.status)?result.status:'unknown';
 const code=String(result?.error?.code||'');
 const coarse=['ETIMEDOUT','ENOBUFS','ENOENT','EACCES'].includes(code)?code:'none';
 warn('STAGING STEP RESULT: exit='+status+' error='+coarse+'.');
 if(step?.name!=='OFFLINE_AND_MIGRATION_PLAN')return;
 const allowed=/^BATCH 1\+2 (?:OFFLINE TESTS FAILED|OFFLINE DIAGNOSTIC|TAP FAILING CASES|FAILED CASE|MISSING TEST FILE|TEST PROCESS TIMED OUT|NO TAP FAILURES RECORDED)/;
 for(const line of String(result?.stderr||'').split(/\r?\n/)){
  if(allowed.test(line))
   warn(line.slice(0,185).replace(/[a-f0-9]{48,}/ig,'[redacted]'));
 }
}

function category(error){
 const message=String(error?.message||'');
 if(/^suite_[a-z_]+$/.test(message))return message;
 if(message==='release_wrong_staging_db'||
  message==='release_lab_aliases_staging'||
  message==='release_temporary_test_flag_present'||
  message.startsWith('lab_'))return message;
 return 'invalid_staging_or_lab_configuration';
}
function run({env=process.env,execute=spawnSync,
 log=console.log,warn=console.error}={}){
 try{preflight(env)}catch(error){
  warn('STAGING SUITE BLOCKED ('+category(error)+').');
  warn('No test was started. Check isolated lab credentials and remove temporary flags.');
  return 1;
 }
 for(let i=0;i<STEPS.length;i++){
  const step=STEPS[i];
  const options={
   cwd:path.join(__dirname,'..'),env:childEnv(env,step),
   encoding:'utf8',timeout:180000,maxBuffer:1024*1024
  };
  let result;
  try{
   result=execute(process.execPath,
    [path.join(__dirname,step.script)],options);
  }catch{result={status:null,error:Error('spawn_failed')}}
  if(!accepted(result,step)){
   warn('STAGING SUITE STOPPED AT '+(i+1)+'/'+STEPS.length+': '+step.name+'.');
   reportSafeStepFailure(result,step,warn);
   warn('Expected isolated test result not confirmed; do NOT assume lab was unchanged.');
   warn('Inspect the lab and the original individual command before retrying.');
   return 1;
  }
  log('['+(i+1)+'/'+STEPS.length+'] '+step.name+': OK');
 }
 log('STAGING COMBINED TESTS PASS: '+STEPS.length+' grouped checks from one DirectAdmin command.');
 log('LAB/STAGING ROLLBACK VERIFIED: authenticated teacher/student/guardian HTTP, attendance, period, Push queue and mock sender/receipt.');
 log('PUBLIC API STILL CLOSED: migration HTTP routes remain intentionally disabled.');
 log('DATA MIGRATION PENDING: D1 export/import and actual application parity not complete.');
 log('RELEASE STILL NO_GO: successful staging tests are NOT permission to go live.');
 log('NO REAL PUSH / NO REAL SCHOOL RECORDS MODIFIED.');
 return 0;
}
if(require.main===module)process.exitCode=run();
module.exports={STEPS,preflight,childEnv,accepted,reportSafeStepFailure,category,run};
