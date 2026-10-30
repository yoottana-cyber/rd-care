'use strict';
// Stage 7.9: one-time DDL, disposable ratsadaa_trgtest only.
// This installs ONLY the two original timetable overlap rules.
// No user-provided SQL; DDL auto-commits and cannot be undone by ROLLBACK.
const {getLabConfig}=require('./check-trigger-lab.cjs');
const {category}=require('./check-db.cjs');
const {TIMETABLE_TRIGGERS,inspectSet,preflight}
 =require('../src/lab-timetable-guards.cjs');

const OPT_IN='INSTALL_TIMETABLE_DDL_ON_TEST_DB_7_9';
async function install(conn){
 await preflight(conn); // 63 empty tables, 119 FKs, exactly 3 guardian triggers
 for(let i=0;i<TIMETABLE_TRIGGERS.length;i++){
  await conn.query(TIMETABLE_TRIGGERS[i].sql);
  await inspectSet(conn,4+i);
 }
 return {database:'ratsadaa_trgtest',installed_triggers:5,timetable_triggers:2};
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_DDL!==OPT_IN)
   throw Error('lab_explicit_ddl_approval_required');
  const config=getLabConfig(env);
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool(config);
  conn=await pool.getConnection();
  const outcome=await install(conn);
  log('STEP 7.9 INSTALL OK: timetable INSERT and UPDATE triggers installed in disposable lab.');
  log('LAB STATUS: '+JSON.stringify(outcome));
  log('NEXT: remove RD_TRIGGER_LAB_ALLOW_DDL, then run check:lab-timetable-guards.');
  log('RACE SAFETY NOT PROVEN: two concurrent teachers still require separate tests.');
  return 0;
 }catch(e){
  const msg=String(e?.message||'');
  warn('STEP 7.9 INSTALL FAILED ('+(msg.startsWith('lab_')?msg:category(e))+').');
  warn('STOP: lab DDL may be partially committed. Do not retry before inspecting trigger inventory.');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.9 INSTALL FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,install,run};
