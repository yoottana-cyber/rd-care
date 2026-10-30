'use strict';
// Stage 7.3 - READ-ONLY guard to verify a separate, EMPTY DirectAdmin MariaDB lab.
// NEVER use production/staging RD_DB_* credentials for this script.
// This script runs SELECT only. It does not create DBs/tables/triggers.
const {category}=require('./check-db.cjs');
const LAB_DATABASE='ratsadaa_trgtest';
const EXPECTED_STAGING_DATABASE='ratsadaa_connect';
function getLabConfig(env=process.env){
 const keys=['RD_TRIGGER_LAB_DB_HOST','RD_TRIGGER_LAB_DB_USER','RD_TRIGGER_LAB_DB_PASSWORD'];
 for(const key of keys)if(typeof env[key]!=='string'||!env[key])throw Error('lab_configuration_missing');
 const name=env.RD_TRIGGER_LAB_DB_NAME;
 if(name!==LAB_DATABASE||name===env.RD_DB_NAME||name===EXPECTED_STAGING_DATABASE)
  throw Error('lab_database_name_required');
 // Laboratory must never reuse staging credentials; no real school access.
 if(env.RD_DB_USER&&env.RD_TRIGGER_LAB_DB_USER===env.RD_DB_USER)
  throw Error('lab_user_must_be_separate');
 if(env.RD_DB_PASSWORD&&env.RD_TRIGGER_LAB_DB_PASSWORD===env.RD_DB_PASSWORD)
  throw Error('lab_password_must_be_separate');
 const port=Number(env.RD_TRIGGER_LAB_DB_PORT||3306);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('lab_port_invalid');
 const host=env.RD_TRIGGER_LAB_DB_HOST;
 if(!/^[a-zA-Z0-9_.-]+$/.test(host))throw Error('lab_host_invalid');
 // Keep separate pool and credentials. Do not print, log or expose config.
 return {
  host,port,database:name,user:env.RD_TRIGGER_LAB_DB_USER,
  password:env.RD_TRIGGER_LAB_DB_PASSWORD,
  charset:'utf8mb4',timezone:'Z',multipleStatements:false,
  waitForConnections:true,connectionLimit:1,queueLimit:1
 };
}
async function inspectLab(conn){
 const [[current]]=await conn.execute('SELECT DATABASE() AS db');
 if(current?.db!==LAB_DATABASE)throw Error('lab_database_mismatch');
 const [[{n:tableCount}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
 );
 const [[{n:triggerCount}]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
 );
 const [[{n:viewCount}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()"
 );
 if(Number(tableCount)!==0||Number(triggerCount)!==0||Number(viewCount)!==0)
  throw Error('lab_database_must_be_empty');
 return {database:LAB_DATABASE,tables:0,triggers:0,views:0};
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  const config=getLabConfig(env);
  // Import only after validating that lab env vars are present and distinct.
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool(config);
  conn=await pool.getConnection();
  const summary=await inspectLab(conn);
  log('STEP 7.3 OK: separate empty MariaDB trigger lab is available (read-only).');
  log('LAB INVENTORY: '+JSON.stringify(summary));
  log('NO DDL / NO REAL STUDENT DATA: safe to prepare schema-only import in a later step.');
  log('STAGING UNCHANGED: ratsadaa_connect was not used for this check.');
  return 0;
 }catch(e){
  const message=String(e?.message||'');
  const reason=message.startsWith('lab_')?message:category(e);
  warn('STEP 7.3 FAILED ('+reason+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.3 FAILED (unknown).');process.exitCode=1;
});
module.exports={LAB_DATABASE,EXPECTED_STAGING_DATABASE,getLabConfig,inspectLab,run};
