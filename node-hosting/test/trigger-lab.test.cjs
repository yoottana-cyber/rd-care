'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LAB_DATABASE,getLabConfig,inspectLab,run}=require('../scripts/check-trigger-lab.cjs');
const safeEnv={
 RD_DB_NAME:'ratsadaa_connect',
 RD_TRIGGER_LAB_DB_NAME:LAB_DATABASE,
 RD_TRIGGER_LAB_DB_HOST:'localhost',
 RD_TRIGGER_LAB_DB_PORT:'3306',
 RD_TRIGGER_LAB_DB_USER:'synthetic_lab_user',
 RD_TRIGGER_LAB_DB_PASSWORD:'synthetic_test_password'
};
function fakeConn({database=LAB_DATABASE,tables=0,triggers=0,views=0}={}){
 const queries=[];
 return {
  queries,release(){},
  async execute(sql){
   queries.push(sql);
   if(sql==='SELECT DATABASE() AS db')return [[{db:database}]];
   if(sql.includes('information_schema.TABLES'))return [[{n:tables}]];
   if(sql.includes('information_schema.TRIGGERS'))return [[{n:triggers}]];
   if(sql.includes('information_schema.VIEWS'))return [[{n:views}]];
   throw Error('unexpected_sql');
  }
 };
}
test('lab credentials are separate and exact database name is required',()=>{
 assert.equal(getLabConfig(safeEnv).database,LAB_DATABASE);
 for(const bad of [
  {...safeEnv,RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'},
  {...safeEnv,RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest_backup'},
  {...safeEnv,RD_DB_NAME:LAB_DATABASE},
  {...safeEnv,RD_TRIGGER_LAB_DB_PASSWORD:''}
 ])assert.throws(()=>getLabConfig(bad),/lab_/);
});
test('only queries metadata from an empty lab',async()=>{
 const conn=fakeConn();
 assert.deepEqual(await inspectLab(conn),{database:LAB_DATABASE,tables:0,triggers:0,views:0});
 assert.equal(conn.queries.length,4);
 assert.ok(conn.queries.every(sql=>sql.startsWith('SELECT ')));
});
test('nonempty, wrong database, installed trigger or views are blocked',async()=>{
 for(const opts of [
  {database:'ratsadaa_connect'}, {tables:1},{triggers:1},{views:1}
 ])await assert.rejects(()=>inspectLab(fakeConn(opts)),/lab_/);
});
test('successful check closes pool and does not print secrets',async()=>{
 const logs=[],warnings=[];
 let closed=false,released=false;
 const c=fakeConn();c.release=()=>{released=true};
 const driver={createPool:config=>{
  assert.equal(config.database,LAB_DATABASE);
  assert.equal(config.connectionLimit,1);
  return {getConnection:async()=>c,end:async()=>{closed=true}};
 }};
 assert.equal(await run({env:safeEnv,driver,log:x=>logs.push(x),warn:x=>warnings.push(x)}),0);
 assert.equal(closed,true);assert.equal(released,true);
 assert.deepEqual(warnings,[]);
 assert.match(logs.join(' '),/STEP 7.3 OK/);
 assert.doesNotMatch(logs.join(' '),/synthetic_test_password|synthetic_lab_user/);
});
test('reject wrong database without exposing connection details',async()=>{
 const warning=[];
 const c=fakeConn({database:'ratsadaa_connect'});let closed=false;
 const driver={createPool:()=>({getConnection:async()=>c,end:async()=>{closed=true}})};
 assert.equal(await run({env:safeEnv,driver,log:()=>{},warn:x=>warning.push(x)}),1);
 assert.equal(closed,true);assert.match(warning[0],/lab_database_mismatch/);
});
