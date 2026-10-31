'use strict';
// Batch 2: one-command dry-run D1 -> MariaDB import PLANNER.
// Only information_schema queries + SELECT 1 to verify staging emptiness.
// No student values printed; NEVER imports, disables FKs or changes schema.
// A private manifest is generated locally by Python helper when available.
const {openPool}=require('../src/database.cjs');
const {getLabConfig}=require('./check-trigger-lab.cjs');
const {category}=require('./check-db.cjs');
const {loadManifest,checkFiles,compareSchema}=require('../migration/manifest-planner.cjs');

function need(value,reason){if(!value)throw Error('migration_'+reason)}
async function inspectTarget(conn){
 const [[db]]=await conn.execute('SELECT DATABASE() AS db');
 need(db?.db==='ratsadaa_connect','target_must_be_staging');
 const [tables]=await conn.execute(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
 const [columns]=await conn.execute(
  "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");
 const [fk]=await conn.execute(
  'SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
 const [[{n:foreignKeys}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY'");
 const [[{n:triggers}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()");
 need(tables.length===63&&Number(foreignKeys)===119&&Number(triggers)===0,
  'target_schema_mismatch');
 const names=new Set();
 for(const t of tables){
  const name=t.TABLE_NAME;
  need(typeof name==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)&&!names.has(name),
   'target_table_name_invalid');
  names.add(name);
  const [hasData]=await conn.execute('SELECT 1 AS present FROM `'+name+'` LIMIT 1');
  need(!hasData.length,'target_not_empty');
 }
 return {tables,columns,fk,foreignKeys:Number(foreignKeys)};
}
async function run({env=process.env,makePool=openPool,log=console.log,warn=console.error,
 load=loadManifest,verify=checkFiles}={}){
 let pool,conn;
 try{
  const manifestPath=env.RD_D1_MANIFEST_FILE;
  if(!manifestPath){
   log('BATCH 2 SOURCE PENDING: private D1 manifest has not been exported or provided.');
   log('MIGRATION NOT STARTED: no database connection, no source data loaded.');
   return 2;
  }
  need(env.RD_DB_NAME==='ratsadaa_connect','target_must_be_staging');
  need(!env.RD_MIGRATION_ALLOW_IMPORT,'import_must_remain_disabled');
  const {base,manifest}=load(manifestPath);
  if(env.RD_D1_VERIFY_JSONL==='VERIFY_LOCAL_PRIVATE_FILES')
   await verify(base,manifest);
  pool=makePool(env);
  conn=await pool.getConnection();
  const target=await inspectTarget(conn);
  const topo=compareSchema(manifest,target.tables,target.columns,target.fk,
   target.foreignKeys);
  if(topo.cyclic_or_blocked_tables.length){
   warn('BATCH 2 PLAN BLOCKED: FK cycles need a verified row-level import design.');
   return 2;
  }
  log('BATCH 2 MANIFEST OK: source has '+manifest.table_count+' tables and '+
   manifest.total_rows+' rows (aggregate only; no record values shown).');
  log('BATCH 2 TARGET OK: 63 empty staging tables, 119 foreign keys, 0 triggers.');
  log('BATCH 2 FK PLAN: '+topo.stages.length+' dependency levels prepared.');
  log('BATCH 2 DRY RUN COMPLETE: no import executed; all confidential JSONL remain private.');
  warn('GO LIVE BLOCKED: missing application parity, conversion checks, per-table integrity and backup/restore evidence.');
  return 2; // A plan never grants permission to import or launch.
 }catch(e){
  const msg=String(e?.message||'');
  warn('BATCH 2 PLAN FAILED ('+(/^migration_[a-z_]+$/.test(msg)?msg:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(n=>{process.exitCode=n},()=>{
 console.error('BATCH 2 PLAN FAILED (unexpected).');process.exitCode=1;
});
module.exports={inspectTarget,run};
