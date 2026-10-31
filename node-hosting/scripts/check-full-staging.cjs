'use strict';
// RD CONNECT — one DirectAdmin command for the complete *available* STAGING suite.
// 11 grouped synthetic / rollback tests + representative API route audit.
// Does not run D1 import/rehearsal, write to production, enable APIs or send Push.
// Success exit 0 = staging checks PASSED. Production release is ALWAYS NO_GO.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {preflight:stagingPreflight,STEPS}=require('./check-all-staging.cjs');
const EXPECTED_ROUTE_BASELINE=41;
const MIN_PRIVATE_MATCHES=13;

function need(ok,why){if(!ok)throw Error('full_staging_'+why)}
function preflight(env){
 need(env&&typeof env==='object','invalid_environment');
 // Prevent an accidental migration rehearsal from inheriting old temporary
 // permissions; only the two deliberately audited commands may be invoked.
 need(!env.RD_D1_REHEARSAL_CONFIRM&&!env.RD_D1_MANIFEST_FILE,
  'remove_old_rehearsal_flags');
 stagingPreflight(env);
 return true;
}
function acceptedStaging(p){
 if(p?.error||p?.signal||p?.status!==0)return false;
 const out=String(p?.stdout||'');
 return STEPS.every((s,i)=>out.includes(
  '['+(i+1)+'/'+STEPS.length+'] '+s.name+': OK'))&&
  out.includes('STAGING COMBINED TESTS PASS: '+STEPS.length+' grouped checks')&&
  out.includes('LAB/STAGING ROLLBACK VERIFIED')&&
  out.includes('PUBLIC API STILL CLOSED')&&
  out.includes('RELEASE STILL NO_GO')&&
  out.includes('NO REAL PUSH / NO REAL SCHOOL RECORDS MODIFIED');
}
function acceptedParity(p){
 if(p?.error||p?.signal||p?.status!==2)return null; // exit 2 is intentional NO_GO
 const out=String(p?.stdout||''),err=String(p?.stderr||'');
 if(!out.includes('STAGE 13 API ROUTE AUDIT OK')||
  !out.includes('PORTAL RECORDS PRIVATE ROUTE FOUND')||
  !out.includes('PUBLIC PASSENGER API CLOSED')||
  !err.includes('STAGE 13 NO_GO'))return null;
 const total=/STAGE 13 API ROUTE AUDIT OK: (\d+) representative/.exec(out);
 const matched=/PRIVATE ROUTE NAME\+METHOD FOUND: (\d+)/.exec(out);
 const remaining=/NO MATCHING PRIVATE ROUTE: (\d+)/.exec(out);
 if(!total||!matched||!remaining)return null;
 const n=Number(total[1]),yes=Number(matched[1]),no=Number(remaining[1]);
 if(!Number.isSafeInteger(n)||!Number.isSafeInteger(yes)||
    !Number.isSafeInteger(no)||n<EXPECTED_ROUTE_BASELINE||
    yes<MIN_PRIVATE_MATCHES||no<0||yes+no!==n)return null;
 return {total:n,matched:yes,pending:no};
}
function safeFailure(p,kind,warn){
 const code=String(p?.error?.code||'');
 const status=Number.isInteger(p?.status)?p.status:'unknown';
 const label=['ETIMEDOUT','ENOENT','EACCES','ENOBUFS'].includes(code)?code:'none';
 warn('FULL STAGING '+kind+' FAILED: exit='+status+' error='+label+'.');
 // Only fixed-format counts and a known check name may be forwarded;
 // do not leak raw TAP output, credentials, stack traces, paths or SQL.
 if(kind==='STAGING'){
  const err=String(p?.stderr||'');
  const failure=/STAGING SUITE STOPPED AT (\d+)\/(\d+): ([A-Z_]+)\./.exec(err);
  if(failure&&STEPS.some(s=>s.name===failure[3]))
   warn('FAILED GROUP: '+failure[1]+'/'+failure[2]+' '+failure[3]+'.');
  const diagnostic=/BATCH 1\+2 NODE BOOTSTRAP CATEGORY: ([A-Z_]+)\./.exec(err);
  if(diagnostic&&['REFERENCE_ERROR','SYNTAX_ERROR','MODULE_NOT_FOUND',
   'FILE_NOT_FOUND','ACCESS_DENIED'].includes(diagnostic[1]))
   warn('OFFLINE NODE ERROR: '+diagnostic[1]+'.');
 }
 warn('STOP: no release action. Inspect isolated staging/lab state before retry.');
}
function run({env=process.env,execute=spawnSync,log=console.log,
 warn=console.error}={}){
 try{preflight(env)}catch(e){
  const name=String(e?.message||'');
  warn('FULL STAGING BLOCKED ('+
   (/^full_staging_[a-z_]+$/.test(name)?name:'invalid_staging_configuration')+').');
  return 1;
 }
 const base={cwd:path.join(__dirname,'..'),env:{...env},
  encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024};
 function runStep(script,options=base){
  try{return execute(process.execPath,[path.join(__dirname,script)],options)}
  catch{return {status:null,error:{code:'spawn_error'}}}
 }
 const stage=runStep('check-all-staging.cjs');
 if(!acceptedStaging(stage)){
  safeFailure(stage,'STAGING',warn);return 1;
 }
 log('[1/2] ALL STAGING GROUPS: OK ('+STEPS.length+'/'+STEPS.length+').');
 const parity=runStep('check-stage13-api-parity.cjs');
 const audit=acceptedParity(parity);
 if(!audit){safeFailure(parity,'API_PARITY',warn);return 1}
 log('[2/2] API PARITY AUDIT: OK ('+audit.matched+' private route names, '+
  audit.pending+' gaps / '+audit.total+' representative contracts).');
 log('ONE-COMMAND STAGING PASS: '+STEPS.length+'/'+STEPS.length+
  ' grouped checks plus 1 API contract audit.');
 log('ROLLBACK VERIFIED IN DISPOSABLE LAB / PUBLIC API STILL CLOSED.');
 log('DATA MIGRATION INCOMPLETE / REAL PUSH NOT RUN / RELEASE STILL NO_GO.');
 return 0;
}
if(require.main===module)process.exitCode=run();
module.exports={EXPECTED_ROUTE_BASELINE,MIN_PRIVATE_MATCHES,
 preflight,acceptedStaging,acceptedParity,safeFailure,run};
