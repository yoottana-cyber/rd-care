'use strict';
// One-off explicit generator for 63-table synthetic manifest + one DISABLED fake teacher.
// READ-ONLY DB access, writes ONLY private fixture files outside Git/webroot.
const {openPool}=require('../src/database.cjs');
const {inspectTarget}=require('./check-d1-migration-plan.cjs');
const {createModel,writeFixture,defaultLocation}=require('../migration/synthetic-fixture.cjs');
function need(ok,reason){if(!ok)throw Error('migration_'+reason)}
async function run({env=process.env,makePool=openPool,
 inspect=inspectTarget,create=createModel,write=writeFixture,
 location=defaultLocation,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  need(env.RD_DB_NAME==='ratsadaa_connect','target_must_be_staging');
  need(!env.RD_MIGRATION_ALLOW_IMPORT&&!env.RD_ENABLE_SCHOOL_WRITES,
   'school_write_flags_forbidden');
  need(!Object.keys(env).some(k=>k.startsWith('RD_TRIGGER_LAB_ALLOW_')&&
   String(env[k]||'').length>0),'lab_write_flags_forbidden');
  pool=makePool(env);conn=await pool.getConnection();
  const target=await inspect(conn); // all 63 staging tables empty; 119 FKs, 0 triggers
  const [metadata]=await conn.execute(
   'SELECT TABLE_NAME,COLUMN_NAME,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
  const model=create(target.tables,metadata);
  const result=write(location(),model);
  log('STAGE 12 SYNTHETIC FIXTURE READY: '+result.tables+
   ' tables, '+result.rows+' fictional disabled account, NO SCHOOL ROWS READ.');
  log('PRIVATE MANIFEST PATH: '+result.manifestPath);
  log('NEXT: configure RD_D1_MANIFEST_FILE with this exact path and explicitly authorize rehearsal.');
  log('PUBLIC API STILL CLOSED / RELEASE NO_GO.');
  return 0;
 }catch(error){
  const msg=String(error?.message||'');
  warn('STAGE 12 SYNTHETIC FIXTURE FAILED ('+
   (/^migration_[a-z_]+$/.test(msg)?msg:'fixture_error')+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(n=>{process.exitCode=n},()=>{
 console.error('STAGE 12 SYNTHETIC FIXTURE FAILED (unexpected).');process.exitCode=1;
});
module.exports={run};
