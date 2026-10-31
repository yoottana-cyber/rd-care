'use strict';
// Stage 7.5 DDL: explicitly opt-in and install ONE original D1-equivalent
// guardian-link INSERT trigger in DISPOSABLE ratsadaa_trgtest ONLY.
// DDL auto-commits; never pretend a transaction can undo CREATE TRIGGER.
const {inspect}=require('./verify-trigger-lab-schema.cjs');
const {category}=require('./check-db.cjs');
const {SQL,labTriggerMetadata,makeConnection}=require('../src/lab-guardian-guard.cjs');
const OPT_IN='INSTALL_GUARDIAN_DDL_ON_TEST_DB_7_5';
async function install(conn){
 // Requires 63-table, 119 FK, 0-trigger, EMPTY school-data-free lab.
 const before=await inspect(conn);
 if(before.tables!==63||before.triggers!==0||before.empty_tables_verified!==63)
  throw Error('lab_schema_mismatch');
 await labTriggerMetadata(conn,0);
 // A single fixed DDL query; never accept table names or SQL from users.
 await conn.query(SQL);
 await labTriggerMetadata(conn,1);
 return true;
}
async function run({env=process.env,makePool=makeConnection,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_DDL!==OPT_IN)
   throw Error('lab_explicit_ddl_approval_required');
  pool=await makePool({env});
  conn=await pool.getConnection();
  await install(conn);
  log('STEP 7.5 INSTALL OK: one guardian INSERT guard installed on isolated trigger lab.');
  log('LAB DDL ONLY: ratsadaa_trgtest now has 1 trigger; ratsadaa_connect untouched.');
  log('NEXT: run check:lab-guardian-guard with synthetic records and ROLLBACK.');
  log('NOT PRODUCTION-READY: guardian link UPDATE and role-change cases still need hardening.');
  return 0;
 }catch(e){
  const msg=String(e?.message||'');
  warn('STEP 7.5 INSTALL FAILED ('+(msg.startsWith('lab_')?msg:category(e))+').');
  warn('DO NOT RETRY BLINDLY: CREATE TRIGGER may have committed in the disposable lab; inspect it first.');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.5 INSTALL FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,install,run};
