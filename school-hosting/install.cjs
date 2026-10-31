'use strict';
// One-shot SELF-HOSTED install for a NEW EMPTY private SQLite database.
// Tests original Worker + all migrations first; then schema, admin, backup.
// Never overwrites an existing school DB. Does not enable a public app or
// import student records; Passenger restart is a separate owner action.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {migrate,CONFIRM:INIT_CONFIRM}=require('./migrate.cjs');
const {run:admin,CONFIRM:ADMIN_CONFIRM}=require('./setup-admin.cjs');
const {run:backup,backupRoot}=require('./backup.cjs');
const {settings}=require('./server.cjs');
const ROOT=path.resolve(__dirname,'..');
const WEB_ROOT=path.join(ROOT,'web');
// Allowlisted synthetic-only test names. Never echo arbitrary child TAP
// assertions: untrusted stack traces could expose SQL, env or school paths.
const KNOWN_SMOKE_TESTS=Object.freeze([
 'full original Worker migration chain works on server-local native SQLite',
 'D1 SQL first/all/run, boolean binding and atomic batch behave correctly',
 'private DB cannot be stored in public web directory',
 'request routing is deterministic and cannot traverse webroot',
 'unmodified Worker can answer health and setup/admin login using school-local D1',
 'school-hosted PWA and original Worker API respond on the same mount',
 'daily register resets date on return from period; explicit links and in-place dates survive',
 'printed school subpath QR, Cloudflare legacy QR and unrelated links',
 'camera scanner signals valid QR and does not accept a random QR',
 'school backup restores into private temporary copy without changing live DB',
 'restore test refuses missing or insecure backup without touching live DB'
]);
function safeSmokeDiagnostics(result,warn){
 const output=String(result?.stdout||'');
 const failed=output.split(/\r?\n/).map(line=>
  /^\s*not ok \d+ - (.+)$/.exec(line)?.[1]?.trim()).filter(Boolean);
 const known=failed.filter(name=>KNOWN_SMOKE_TESTS.includes(name));
 for(const name of [...new Set(known)].slice(0,8))
  warn('SCHOOL SMOKE FAILED CASE: '+name+'.');
 const codes=[...new Set(
  [...output.matchAll(/school_(?:migration_failed_)?[a-z0-9_]+/g)]
   .map(x=>x[0]).filter(x=>x.length<=100)
 )];
 for(const code of codes.slice(0,5))
  warn('SCHOOL SMOKE ERROR CATEGORY: '+code+'.');
 const all=output+'\n'+String(result?.stderr||'');
 const bootstrap=[
  ['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'],
  ['MODULE_NOT_FOUND','MODULE_NOT_FOUND'],
  ['ERR_UNKNOWN_BUILTIN_MODULE','NODE_SQLITE_UNAVAILABLE'],
  ['ERR_UNKNOWN_FILE_EXTENSION','ES_MODULE_LOADING_FAILED'],
  ['ERR_REQUIRE_ESM','ES_MODULE_LOADING_FAILED'],
  ['SQLITE_CANTOPEN','SQLITE_CANTOPEN'],
  ['SQLITE_CONSTRAINT','SQLITE_CONSTRAINT'],
  ['SQLITE_ERROR','SQLITE_ERROR'],
  ['SyntaxError','SYNTAX_ERROR'],
  ['ReferenceError','REFERENCE_ERROR']
 ].find(([needle])=>all.includes(needle));
 if(bootstrap)warn('SCHOOL SMOKE NODE CATEGORY: '+bootstrap[1]+'.');
 if(!failed.length&&!codes.length&&!bootstrap)
  warn('SCHOOL SMOKE NO SAFE TEST DETAILS: run school:test for full synthetic TAP diagnostics.');
 return {known:known.length,codes:codes.length,bootstrap:bootstrap?.[1]||null};
}
function preflight(env){
 const config=settings(env);
 if(env.RD_SCHOOL_INIT_CONFIRM!==INIT_CONFIRM||
  env.RD_SCHOOL_ADMIN_CONFIRM!==ADMIN_CONFIRM)
  throw Error('school_install_temporary_flags_required');
 if(!env.RD_SETUP_PASSWORD||!env.RD_SETUP_USERNAME||
  !env.RD_SETUP_DISPLAY_NAME)throw Error('school_install_admin_credentials_required');
 const file=privateDbPath(config.file,WEB_ROOT);
 if(fs.existsSync(file))throw Error('school_install_existing_db_refused');
 backupRoot(env);
 return {file};
}
async function run({env=process.env,execute=spawnSync,
 log=console.log,warn=console.error}={}){
 let destination;
 try{destination=preflight(env).file}
 catch(e){
  const m=String(e?.message||'');
  warn('SCHOOL INSTALL BLOCKED ('+
   (/^school_[a-z0-9_]+$/.test(m)?m:'invalid_private_configuration')+').');
  return 1;
 }
 const testsDir=path.join(__dirname,'test');
 const tests=fs.readdirSync(testsDir).filter(n=>n.endsWith('.test.cjs'))
  .map(n=>path.join(testsDir,n)).sort();
 if(tests.length<2){
  warn('SCHOOL INSTALL BLOCKED (school_smoke_tests_missing).');return 1;
 }
 const result=execute(process.execPath,['--test','--test-concurrency=2',...tests],{
  cwd:ROOT,env:{...env},encoding:'utf8',timeout:180000,
  maxBuffer:1024*1024
 });
 if(result?.status!==0||result?.error||result?.signal){
  // Do not include arbitrary stdout/stderr, tokens or SQL in public output.
  const error=String(result?.error?.code||'');
  warn('SCHOOL INSTALL STOPPED AT 1/4: SMOKE TEST FAILED ('+
   (['ETIMEDOUT','ENOBUFS','ENOENT'].includes(error)?error:'test_failed')+').');
  safeSmokeDiagnostics(result,warn);
  warn('DATABASE NOT CREATED BY INSTALL; inspect tests privately before retry.');
  return 1;
 }
 log('[1/4] ORIGINAL WORKER + PWA TESTS: OK.');
 try{
  migrate({filename:destination,confirm:env.RD_SCHOOL_INIT_CONFIRM,log:()=>{}});
  log('[2/4] SCHOOL SQLITE: 46 ORIGINAL MIGRATIONS + 48 CLASSROOMS OK.');
  await admin({env,log:()=>{}});
  log('[3/4] INITIAL ADMIN: CREATED LOCALLY, WEB SETUP DISABLED.');
  await backup({env,log:()=>{}});
  log('[4/4] FIRST PRIVATE SQLITE BACKUP: VERIFIED.');
  log('SCHOOL PACKAGE INSTALLED: restart Passenger and test school URL with limited staff.');
  log('IMPORTANT: REMOVE RD_SCHOOL_INIT_CONFIRM, RD_SCHOOL_ADMIN_CONFIRM, RD_SETUP_USERNAME, RD_SETUP_DISPLAY_NAME, RD_SETUP_PASSWORD.');
  log('NO REAL STUDENTS IMPORTED; NO CLOUDFLARE D1 OR MARIADB MODIFIED.');
  return 0;
 }catch(e){
  const message=String(e?.message||'');
  warn('SCHOOL INSTALL STOPPED: '+
   (/^school_[a-z0-9_]+$/.test(message)?message:'check_private_db_and_backups')+'.');
  warn('Do not delete/overwrite an existing DB to retry. Inspect the state offline first.');
  return 1;
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('SCHOOL INSTALL FAILED (unexpected).');process.exitCode=1;
});
module.exports={preflight,run,KNOWN_SMOKE_TESTS,safeSmokeDiagnostics};
