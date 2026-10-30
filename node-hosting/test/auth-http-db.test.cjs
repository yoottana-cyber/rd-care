'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {run,request,verifyAll}=require('../scripts/check-auth-http-db.cjs');
test('integration guard rejects unexpected staging DB before any write',async()=>{
 const sql=[];
 const conn={
  async execute(query){
   sql.push(query);
   if(query==='SELECT DATABASE() AS db')return [[{db:'production'}]];
   throw new Error('Unexpected query');
  }
 };
 await assert.rejects(()=>verifyAll(conn),/staging_database_required/);
 assert.deepEqual(sql,['SELECT DATABASE() AS db']);
});
test('script reports blocked test, releases connection and keeps secrets out of logs',async()=>{
 let released=false,closed=false;
 const conn={
  async execute(query){
   if(query==='SELECT DATABASE() AS db')return [[{db:'production'}]];
   throw new Error('Sensitive internal failure');
  },
  release(){released=true}
 };
 const logs=[],errors=[];
 const code=await run({
  makePool:()=>({getConnection:async()=>conn,end:async()=>{closed=true}}),
  log:v=>logs.push(v),warn:v=>errors.push(v)
 });
 assert.equal(code,1);
 assert.equal(released,true);
 assert.equal(closed,true);
 assert.deepEqual(logs,[]);
 assert.match(errors[0],/staging_database_required/);
 assert.doesNotMatch(errors.join(' '),/Sensitive internal failure/);
});
test('HTTP contract returns no-store error without a DB connection',async()=>{
 const connection={};
 const bad=await request('POST','/api/auth/login','{invalid-json',{},connection,400);
 assert.equal(bad.ok,false);
 assert.equal(bad.error,'invalid_request');
});
