'use strict';
// RD CONNECT stage 7.4: READ-ONLY post-import audit of an isolated TEST DATABASE.
// Does not create tables or triggers, does not read stored values, never queries
// school staging/production databases, and will fail on any nonempty lab table.
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {category}=require('./check-db.cjs');

const EXPECTED=Object.freeze({
 tables:63,foreign_keys:119,triggers:0,views:0,
 enrollment_end_date:'varchar(10)',required_unique_indexes:2
});
function fail(code){throw Error(code)}
function verifyDataShape(row){
 if(!row||!Number.isSafeInteger(Number(row.n)))fail('lab_invalid_metadata');
 return Number(row.n);
}
async function inspect(conn){
 const [[selected]]=await conn.execute('SELECT DATABASE() AS db');
 if(selected?.db!==LAB_DATABASE)fail('lab_database_mismatch');
 const [tableInfo]=await conn.execute(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
 );
 const tableCount=tableInfo.length;
 if(tableCount!==EXPECTED.tables)fail('lab_table_count_mismatch');
 if(tableInfo.some(t=>String(t.ENGINE).toUpperCase()!=='INNODB'))
  fail('lab_innodb_required');
 const [[foreignKeys]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY'"
 );
 const [[triggers]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
 );
 const [[views]]=await conn.execute(
  'SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()'
 );
 const [[endDate]]=await conn.execute(
  "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND COLUMN_NAME='end_date'"
 );
 const [[indexes]]=await conn.execute(
  "SELECT COUNT(DISTINCT INDEX_NAME) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND NON_UNIQUE=0 AND INDEX_NAME IN ('uq_student_current_enrollment','uq_room_current_roll')"
 );
 const actual={
  tables:tableCount,foreign_keys:verifyDataShape(foreignKeys),
  triggers:verifyDataShape(triggers),views:verifyDataShape(views),
  enrollment_end_date:String(endDate?.t||'').toLowerCase(),
  required_unique_indexes:verifyDataShape(indexes)
 };
 if(Object.keys(EXPECTED).some(key=>actual[key]!==EXPECTED[key]))
  fail('lab_schema_drift');
 // 63 empty probes are SELECT constant, never SELECT account or student values.
 for(const row of tableInfo){
  const name=row.TABLE_NAME;
  if(typeof name!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(name))
   fail('lab_unexpected_table_name');
  const [found]=await conn.execute('SELECT 1 AS present FROM `'+name+'` LIMIT 1');
  if(found.length)fail('lab_database_contains_rows');
 }
 return {...actual,empty_tables_verified:tableCount};
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  const config=getLabConfig(env);
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool(config);
  conn=await pool.getConnection();
  const report=await inspect(conn);
  log('STEP 7.4 OK: disposable MariaDB trigger lab schema imported and verified.');
  log('LAB SCHEMA: '+JSON.stringify(report));
  log('NO SCHOOL DATA: all 63 lab tables are empty (SELECT 1 checks only).');
  log('NO DDL / NO LIVE CHANGES: triggers are still absent; ratsadaa_connect was not used.');
  return 0;
 }catch(e){
  const msg=String(e?.message||'');
  warn('STEP 7.4 FAILED ('+(msg.startsWith('lab_')?msg:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(status=>{process.exitCode=status},()=>{
 console.error('STEP 7.4 FAILED (unknown).');process.exitCode=1;
});
module.exports={EXPECTED,inspect,run};
