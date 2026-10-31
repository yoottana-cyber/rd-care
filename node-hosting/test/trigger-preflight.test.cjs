'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 EXPECTED_DB,REQUIRED,ORIGINAL_TRIGGERS,REQUIRED_UNIQUES,
 allowedColumnTypes,hasUniqueIndex,inspect,run
}=require('../scripts/check-trigger-preflight.cjs');
const TABLES=Object.keys(REQUIRED);
function fakeColumns(){
 return Object.entries(REQUIRED).flatMap(([TABLE_NAME,names])=>
  names.map(COLUMN_NAME=>({TABLE_NAME,COLUMN_NAME,DATA_TYPE:
   ['period','end_period','active','guardian_account_id'].includes(COLUMN_NAME)?'bigint':
   COLUMN_NAME==='role'?'varchar':COLUMN_NAME==='deleted_at'?'datetime':
   COLUMN_NAME==='school_date'?'char':'bigint'}))
 );
}
function indexes(){
 return REQUIRED_UNIQUES.flatMap(({table,cols},i)=>cols.map((COLUMN_NAME,n)=>({
  TABLE_NAME:table,INDEX_NAME:'uq_'+i,NON_UNIQUE:0,SEQ_IN_INDEX:n+1,COLUMN_NAME
 })));
}
function fakeConn({wrongDb=false,badTable=false,triggers=0,badIndex=false}={}){
 const queries=[];
 const conn={
  queries,
  async execute(sql,params=[]){
   queries.push({sql,params});
   if(sql==='SELECT DATABASE() AS db')return [[{db:wrongDb?'wrong_db':EXPECTED_DB}]];
   if(sql.includes('information_schema.TABLES')){
    return [TABLES.filter((_,i)=>!(badTable&&i===0)).map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}))];
   }
   if(sql.includes('information_schema.COLUMNS'))return [fakeColumns()];
   if(sql.includes('information_schema.STATISTICS'))return [badIndex?indexes().slice(2):indexes()];
   if(sql.includes('information_schema.TRIGGERS'))return [Array.from({length:triggers},(_,i)=>({TRIGGER_NAME:'unexpected_'+i}))];
   throw Error('Unexpected query');
  }
 };
 return conn;
}
test('source inventory includes ten triggers with stable named prerequisites',()=>{
 assert.equal(ORIGINAL_TRIGGERS.length,10);
 assert.equal(TABLES.length,14);
 assert.equal(REQUIRED_UNIQUES.length,3);
});
test('metadata-only preflight accepts expected staging schema',async()=>{
 const c=fakeConn();
 const result=await inspect(c);
 assert.equal(result.critical_tables,14);
 assert.equal(result.installed_triggers,0);
 assert.equal(result.d1_triggers_to_port,10);
 assert.equal(c.queries.length,5);
 assert.ok(c.queries.every(q=>q.sql==='SELECT DATABASE() AS db'||q.sql.includes('information_schema.')));
 assert.ok(c.queries.every(q=>!/^INSERT|^UPDATE|^DELETE|^ALTER|^CREATE/i.test(q.sql)));
});
test('wrong database, missing table, uniqueness drift, or unexpected trigger block',async()=>{
 for(const opts of [{wrongDb:true},{badTable:true},{badIndex:true},{triggers:1}]){
  const c=fakeConn(opts);
  await assert.rejects(()=>inspect(c),/staging_/);
 }
});
test('required columns and unique constraints are verified without student rows',()=>{
 const cols=fakeColumns();
 assert.equal(allowedColumnTypes(cols),true);
 assert.throws(()=>allowedColumnTypes(cols.filter(r=>r.COLUMN_NAME!=='end_period')),/staging_missing_required_column/);
 const idx=indexes();
 assert.equal(hasUniqueIndex(idx,'timetable',['classroom_id','day_of_week','period']),true);
 assert.equal(hasUniqueIndex(idx,'timetable',['teacher_user_id','day_of_week','period']),false);
});
test('when blocked, script sanitizes errors and closes DB connection',async()=>{
 let released=false,closed=false;const messages=[];
 const c=fakeConn({wrongDb:true});c.release=()=>{released=true};
 const code=await run({
  makePool:()=>({getConnection:async()=>c,end:async()=>{closed=true}}),
  log:()=>{},warn:m=>messages.push(m)
 });
 assert.equal(code,1);
 assert.equal(released,true);
 assert.equal(closed,true);
 assert.match(messages[0],/staging_database_required/);
 assert.doesNotMatch(messages[0],/password|username/i);
});
