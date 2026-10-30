'use strict';
// RD CONNECT Batch 2 — read-only data-count and FK integrity comparison.
// No import, schema changes, D1 calls, public endpoints or personal data logs.
const {openPool}=require('../src/database.cjs');
const {category}=require('./check-db.cjs');
const {loadManifest}=require('../migration/manifest-planner.cjs');
const {reconcile}=require('../migration/reconcile.cjs');
async function run({env=process.env,makePool=openPool,log=console.log,warn=console.error,
 load=loadManifest}={}){
 let pool,conn;
 try{
  if(!env.RD_D1_MANIFEST_FILE){
   log('BATCH 2 RECONCILIATION PENDING: no private source manifest supplied.');
   return 2;
  }
  if(env.RD_DB_NAME!=='ratsadaa_connect')throw Error('migration_target_must_be_staging');
  if(env.RD_MIGRATION_ALLOW_IMPORT)throw Error('migration_import_must_remain_disabled');
  const {manifest}=load(env.RD_D1_MANIFEST_FILE);
  pool=makePool(env);
  conn=await pool.getConnection();
  const result=await reconcile(conn,manifest);
  log('BATCH 2 RECONCILIATION: '+JSON.stringify({
   tables_checked:result.tables_checked,total_rows:result.total_rows,
   expected_rows:result.expected_rows,mismatched_tables:result.mismatched_tables,
   foreign_keys_checked:result.foreign_keys_checked,
   orphan_constraints:result.orphan_constraints,
   counts_match:result.counts_match,
   relations_match:result.relations_match,
   fully_reconciled:false
  }));
  warn('NO_GO: counts/FKs alone cannot establish full school data parity; no writes performed.');
  return 2;
 }catch(e){
  const msg=String(e?.message||'');
  warn('BATCH 2 RECONCILIATION FAILED ('+
   (/^migration_[a-z_]+$/.test(msg)?msg:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(c=>{process.exitCode=c},()=>{
 console.error('BATCH 2 RECONCILIATION FAILED (unknown).');process.exitCode=1;
});
module.exports={run};
