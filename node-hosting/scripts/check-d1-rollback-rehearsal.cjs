'use strict';
// Explicit, private synthetic-fixture JSONL -> MariaDB rehearsal. ALWAYS ROLLBACK.
// This command is NOT called by check:all-staging or Passenger.
// Exit 0 means rollback-only rehearsal passed; release remains NO_GO.
const fs=require('node:fs');
const path=require('node:path');
const {openPool}=require('../src/database.cjs');
const {checkFiles,compareSchema}=require('../migration/manifest-planner.cjs');
const {loadSyntheticManifest}=require('../migration/synthetic-manifest.cjs');
const {inspectTarget}=require('./check-d1-migration-plan.cjs');
const {replay}=require('../migration/rollback-rehearsal.cjs');
const {reconcile}=require('../migration/reconcile.cjs');

const CONFIRM='RUN_SYNTHETIC_D1_ROLLBACK_ONLY';
function need(ok,reason){if(!ok)throw Error('migration_'+reason)}
function guard(env){
 need(env.RD_DB_NAME==='ratsadaa_connect','target_must_be_staging');
 need(env.RD_D1_REHEARSAL_CONFIRM===CONFIRM,'rehearsal_not_authorized');
 need(!env.RD_MIGRATION_ALLOW_IMPORT&&!env.RD_ENABLE_SCHOOL_WRITES,
  'school_writes_forbidden');
 need(!Object.keys(env).some(k=>k.startsWith('RD_TRIGGER_LAB_ALLOW_')&&
  String(env[k]||'').length>0),'lab_write_flag_forbidden');
 need(typeof env.RD_D1_MANIFEST_FILE==='string'&&env.RD_D1_MANIFEST_FILE.length>0,
  'manifest_path_required');
 const target=path.resolve(env.RD_D1_MANIFEST_FILE);
 const segments=target.split(path.sep).map(x=>x.toLowerCase());
 need(!segments.some(s=>['public_html','htdocs','wwwroot','www'].includes(s)),
  'manifest_under_web_root');
 const stat=fs.lstatSync(target);
 need(stat.isFile()&&!stat.isSymbolicLink(),'manifest_symlink_forbidden');
 // Private files must not accidentally be placed in a tracked Git workspace.
 for(let current=path.dirname(target);;current=path.dirname(current)){
  need(!fs.existsSync(path.join(current,'.git')),'manifest_inside_git_repo');
  if(current===path.dirname(current))break;
 }
 return target;
}
async function run({env=process.env,makePool=openPool,log=console.log,
 warn=console.error,load=loadManifest,verify=checkFiles,
 inspect=inspectTarget,play=replay,check=reconcile}={}){
 if(!env.RD_D1_REHEARSAL_CONFIRM){
  log('D1 REHEARSAL DISABLED: explicit synthetic-data confirmation missing.');
  log('NO_DB_CONNECTION / NO_IMPORT / RELEASE NO_GO.');
  return 2;
 }
 let pool,conn,transaction=false,rollbackVerified=false;
 try{
  const manifestFile=guard(env);
  const {base,manifest}=load(manifestFile);
  // ALWAYS check every file hash and line count BEFORE DB connection.
  await verify(base,manifest);
  pool=makePool(env);
  conn=await pool.getConnection();
  const target=await inspect(conn); // 63 empty InnoDB, 119 FKs, zero triggers
  const plan=compareSchema(manifest,target.tables,target.columns,target.fk,
   target.foreignKeys);
  need(!plan.cyclic_or_blocked_tables.length,'fk_cycle_requires_design');
  const [generated]=await conn.execute(
   'SELECT TABLE_NAME,COLUMN_NAME,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
  const supplied=new Map(manifest.tables.map(t=>[t.name,new Set(t.columns)]));
  for(const c of generated){
   if(/GENERATED/i.test(String(c.EXTRA||''))&&supplied.get(c.TABLE_NAME)?.has(c.COLUMN_NAME))
    throw Error('migration_generated_column_requires_mapping');
  }
  await conn.beginTransaction();
  transaction=true;
  const replayed=await play(conn,base,manifest,plan);
  const reconciled=await check(conn,manifest);
  need(reconciled.counts_match&&reconciled.relations_match&&
   replayed.rows===manifest.total_rows&&replayed.tables===63,
   'transaction_reconciliation_failed');
  await conn.rollback();
  transaction=false;
  await inspect(conn); // independently verify all 63 tables are empty again
  rollbackVerified=true;
  log('STAGE 12 SYNTHETIC REHEARSAL PASS: 63 tables, '+replayed.rows+
   ' private fixture rows compared inside transaction.');
  log('ROLLBACK VERIFIED: 63 staging tables empty, 119 FKs, zero triggers.');
  log('PUBLIC API CLOSED / NO REAL PUSH / RELEASE NO_GO.');
  return 0;
 }catch(error){
  const msg=String(error?.message||'');
  const reason=/^migration_[a-z_]+$/.test(msg)?msg:'rehearsal_error';
  warn('D1 STAGING REHEARSAL FAILED ('+reason+').');
  return 1;
 }finally{
  if(transaction&&conn){
   try{
    await conn.rollback();
    await inspect(conn);
    rollbackVerified=true;
   }catch{
    warn('ROLLBACK NOT VERIFIED: quarantine staging; inspect privately before retry.');
   }
  }
  if(!rollbackVerified&&transaction)
   warn('DO NOT REPEAT OR ENABLE PUBLIC API until staging emptiness is verified.');
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('D1 STAGING REHEARSAL FAILED (unhandled).');process.exitCode=1;
});
module.exports={CONFIRM,guard,run};
