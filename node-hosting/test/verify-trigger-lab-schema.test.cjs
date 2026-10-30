'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EXPECTED,inspect,run}=require('../scripts/verify-trigger-lab-schema.cjs');

const tableNames=Array.from({length:62},(_,i)=>'lab_table_'+String(i).padStart(2,'0'))
 .concat('student_enrollments');
function labConnection({wrongDb=false,counts={},rowFound=false,badEngine=false}={}){
 const sql=[];
 const c={
  sql,
  release(){},
  async execute(statement){
   sql.push(statement);
   if(statement==='SELECT DATABASE() AS db')return [[{db:wrongDb?'ratsadaa_connect':'ratsadaa_trgtest'}]];
   if(statement.includes('information_schema.TABLES')){
    return [tableNames.map((TABLE_NAME,i)=>({TABLE_NAME,ENGINE:badEngine&&i===0?'MyISAM':'InnoDB'}))];
   }
   if(statement.includes('information_schema.TABLE_CONSTRAINTS'))
    return [[{n:counts.foreign_keys??119}]];
   if(statement.includes('information_schema.TRIGGERS'))
    return [[{n:counts.triggers??0}]];
   if(statement.includes('information_schema.VIEWS'))
    return [[{n:counts.views??0}]];
   if(statement.includes('information_schema.COLUMNS'))
    return [[{t:counts.end_date??'varchar(10)'}]];
   if(statement.includes('information_schema.STATISTICS'))
    return [[{n:counts.unique_indexes??2}]];
   if(statement.startsWith('SELECT 1 AS present FROM '))return [rowFound?[{present:1}]:[]];
   throw Error('unrecognized_sql');
  }
 };
 return c;
}
test('expected baseline is 63 tables, 119 foreign keys, zero triggers and views',()=>{
 assert.deepEqual(EXPECTED,{
  tables:63,foreign_keys:119,triggers:0,views:0,
  enrollment_end_date:'varchar(10)',required_unique_indexes:2
 });
});
test('verify only metadata and table emptiness without returning student data',async()=>{
 const c=labConnection();
 const result=await inspect(c);
 assert.equal(result.empty_tables_verified,63);
 assert.equal(result.foreign_keys,119);
 assert.equal(c.sql.length,70);
 assert.ok(c.sql.every(q=>q.startsWith('SELECT ')));
 assert.ok(c.sql.every(q=>!q.includes('SELECT *')&&!q.includes('password_hash')));
});
test('refuse wrong db, nonempty test rows and schema drift',async()=>{
 for(const opts of [
  {wrongDb:true},{rowFound:true},{badEngine:true},
  {counts:{foreign_keys:118}},{counts:{triggers:1}},
  {counts:{views:1}},{counts:{end_date:'char(10)'}},
  {counts:{unique_indexes:1}}
 ]){
  await assert.rejects(()=>inspect(labConnection(opts)),/lab_/);
 }
});
test('read-only entry closes connection, hides credentials, reports counts',async()=>{
 let released=false,ended=false;const logs=[],warnings=[];
 const connection=labConnection();connection.release=()=>{released=true};
 const env={
  RD_DB_NAME:'ratsadaa_connect',RD_DB_USER:'main_user',RD_DB_PASSWORD:'main_private',
  RD_TRIGGER_LAB_DB_HOST:'localhost',RD_TRIGGER_LAB_DB_PORT:'3306',
  RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
  RD_TRIGGER_LAB_DB_USER:'lab_only',RD_TRIGGER_LAB_DB_PASSWORD:'lab_private'
 };
 const driver={createPool:conf=>{
  assert.equal(conf.database,'ratsadaa_trgtest');
  return {getConnection:async()=>connection,end:async()=>{ended=true}}
 }};
 assert.equal(await run({env,driver,log:x=>logs.push(x),warn:x=>warnings.push(x)}),0);
 assert.equal(released,true);assert.equal(ended,true);assert.deepEqual(warnings,[]);
 assert.match(logs.join(' '),/NO SCHOOL DATA/);
 assert.doesNotMatch(logs.join(' '),/main_private|lab_private|lab_only/);
});
