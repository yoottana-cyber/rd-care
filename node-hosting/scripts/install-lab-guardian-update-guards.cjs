'use strict';
// Stage 7.6: explicit DDL on disposable ratsadaa_trgtest ONLY.
// MariaDB DDL auto-commits; successful first trigger survives if second fails.
const {GUARDS,checkTriggerSet,preflight,makeConnection}=require('../src/lab-guardian-update-guards.cjs');
const {category}=require('./check-db.cjs');
const OPT_IN='INSTALL_GUARDIAN_UPDATE_DDL_ON_TEST_DB_7_6';
async function install(conn){
 await preflight(conn); // 63 empty InnoDB tables, 119 FK, exactly 7.5 trigger
 for(let i=0;i<GUARDS.length;i++){
  await conn.query(GUARDS[i].sql);  // fixed text, no dynamic user SQL
  await checkTriggerSet(conn,i+2);
 }
 return {installed_guardian_triggers:3};
}
async function run({env=process.env,makePool=makeConnection,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_DDL!==OPT_IN)
   throw Error('lab_explicit_ddl_approval_required');
  pool=await makePool({env});conn=await pool.getConnection();
  const result=await install(conn);
  log('STEP 7.6 INSTALL OK: guardian link UPDATE and linked account role UPDATE triggers installed.');
  log('LAB STATUS: ratsadaa_trgtest has '+result.installed_guardian_triggers+' guardian triggers (1 INSERT + 2 UPDATE).');
  log('NEXT: remove RD_TRIGGER_LAB_ALLOW_DDL, then run check:lab-guardian-updates.');
  log('STILL TEST ONLY: concurrent role changes vs link inserts have not been verified.');
  return 0;
 }catch(e){
  const m=String(e?.message||'');
  warn('STEP 7.6 INSTALL FAILED ('+(m.startsWith('lab_')?m:category(e))+').');
  warn('STOP: DDL may be partially committed (2 or 3 triggers). Do not rerun; inspect test DB before proceeding.');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.6 INSTALL FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,install,run};
