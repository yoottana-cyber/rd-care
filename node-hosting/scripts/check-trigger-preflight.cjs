'use strict';
// RD CONNECT stage 7.1: READ-ONLY trigger-parity preflight on MariaDB staging.
// Compares metadata with the 10-trigger inventory in the original D1 schema-only export.
// Executes SELECTs against information_schema only; never reads student/user rows,
// creates triggers, alters tables, logs secrets or opens network endpoints.
const {openPool}=require('../src/database.cjs');
const {category}=require('./check-db.cjs');
const EXPECTED_DB='ratsadaa_connect';
const REQUIRED={
 guardian_student_links:['guardian_account_id','student_id','verified_by','verified_at'],
 portal_accounts:['id','role','student_id','active'],
 timetable:['id','classroom_id','teacher_user_id','day_of_week','period','end_period','active'],
 users:['id','role'],
 classrooms:['id','grade','room'],
 students:['id','classroom_id'],
 behavior_records:['id','student_id','deleted_at','recorded_by'],
 behavior_incidents:['id','student_id','behavior_record_id','source_timetable_id','source_school_date','deleted_at','points_applied','warning_no'],
 period_truancy:['student_id','timetable_id','school_date','recorded_by'],
 truancy_score_policy:['id','rule_id'],
 affairs_behavior_rules:['id','category','points'],
 truancy_behavior_links:['student_id','timetable_id','school_date','behavior_record_id'],
 behavior_score_push_events:['incident_id'],
 audit_logs:['actor_id','action','entity_type','entity_id']
};
const ORIGINAL_TRIGGERS=Object.freeze([
 'guardian_link_role_guard',
 'timetable_clash_insert',
 'timetable_clash_update',
 'behavior_incident_record_deleted',
 'behavior_incident_record_restored',
 'truancy_auto_score_on_insert',
 'truancy_auto_score_on_delete',
 'behavior_score_notification_on_deduction',
 'behavior_warning_notification_on_insert',
 'behavior_incident_apply'
]);
const TABLES=Object.freeze(Object.keys(REQUIRED));
const REQUIRED_UNIQUES=Object.freeze([
 {table:'guardian_student_links',cols:['guardian_account_id','student_id']},
 {table:'timetable',cols:['classroom_id','day_of_week','period']},
 {table:'behavior_incidents',cols:['student_id','source_timetable_id','source_school_date']}
]);
function allowedColumnTypes(rows){
 const key=new Map(rows.map(row=>[row.TABLE_NAME+'.'+row.COLUMN_NAME,String(row.DATA_TYPE).toLowerCase()]));
 for(const [tbl,cols] of Object.entries(REQUIRED)){
  for(const col of cols){
   if(!key.has(tbl+'.'+col))throw Error('staging_missing_required_column');
  }
 }
 const expected={
  'timetable.period':['bigint','int'],
  'timetable.end_period':['bigint','int'],
  'timetable.active':['bigint','int','tinyint'],
  'guardian_student_links.guardian_account_id':['bigint','int'],
  'portal_accounts.role':['varchar','char'],
  'behavior_incidents.deleted_at':['datetime','timestamp'],
  'behavior_records.deleted_at':['datetime','timestamp'],
  'period_truancy.school_date':['char','varchar']
 };
 for(const [name,types] of Object.entries(expected)){
  if(!types.includes(key.get(name)))throw Error('staging_column_type_mismatch');
 }
 return true;
}
function hasUniqueIndex(rows,table,columns){
 const groups=new Map();
 for(const row of rows){
  if(row.TABLE_NAME!==table||Number(row.NON_UNIQUE)!==0)continue;
  const name=String(row.INDEX_NAME);
  const cols=groups.get(name)||[];
  cols[Number(row.SEQ_IN_INDEX)-1]=row.COLUMN_NAME;
  groups.set(name,cols);
 }
 return [...groups.values()].some(found=>found.length===columns.length&&found.every((value,i)=>value===columns[i]));
}
async function inspect(conn){
 const [db]=await conn.execute('SELECT DATABASE() AS db');
 if(db.length!==1||db[0].db!==EXPECTED_DB)throw Error('staging_database_required');
 const [tables]=await conn.execute(
  'SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\' AND TABLE_NAME IN ('+
  TABLES.map(()=>'?').join(',')+')',TABLES
 );
 if(tables.length!==TABLES.length||tables.some(t=>String(t.ENGINE).toUpperCase()!=='INNODB'))
  throw Error('staging_innodb_tables_required');
 const [cols]=await conn.execute(
  'SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+
  TABLES.map(()=>'?').join(',')+')',TABLES
 );
 allowedColumnTypes(cols);
 const [indexes]=await conn.execute(
  'SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?)',
  ['guardian_student_links','timetable','behavior_incidents']
 );
 for(const requirement of REQUIRED_UNIQUES){
  if(!hasUniqueIndex(indexes,requirement.table,requirement.cols))
   throw Error('staging_required_unique_index_missing');
 }
 const [triggers]=await conn.execute(
  'SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
 );
 if(triggers.length!==0)throw Error('staging_trigger_baseline_changed');
 return {database:EXPECTED_DB,critical_tables:TABLES.length,checked_columns:Object.values(REQUIRED).reduce((n,x)=>n+x.length,0),
  critical_unique_indexes:REQUIRED_UNIQUES.length,installed_triggers:0,d1_triggers_to_port:ORIGINAL_TRIGGERS.length};
}
function safeReason(e){
 const msg=String(e?.message||'');
 return msg.startsWith('staging_')?msg:category(e);
}
async function run({makePool=openPool,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  pool=makePool(process.env);
  conn=await pool.getConnection();
  const result=await inspect(conn);
  log('STEP 7.1 OK: MariaDB staging metadata matches the original D1 trigger prerequisites.');
  log('READ-ONLY INVENTORY: '+JSON.stringify(result));
  log('NO SCHEMA CHANGES: D1 has 10 business-rule triggers; MariaDB still has 0.');
  log('LIVE LOGIN STILL CLOSED: this script does not enable APIs or read school accounts.');
  return 0;
 }catch(e){
  warn('STEP 7.1 FAILED ('+safeReason(e)+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module){
 run().then(code=>{process.exitCode=code},()=>{
  console.error('STEP 7.1 FAILED (unknown).');process.exitCode=1;
 });
}
module.exports={EXPECTED_DB,REQUIRED,ORIGINAL_TRIGGERS,REQUIRED_UNIQUES,allowedColumnTypes,hasUniqueIndex,inspect,run};
