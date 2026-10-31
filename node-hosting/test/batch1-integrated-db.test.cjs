'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {run}=require('../scripts/check-integrated-http-db.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const {handleIntegratedStaging}=require('../src/staging-integrated-http.cjs');
const {Readable}=require('node:stream');

test('real SQL integration CLI refuses wrong database before opening a connection',async()=>{
 let opens=0;
 const warnings=[];
 const code=await run({env:{RD_DB_NAME:'ratsadaa_trgtest'},
  makePool:()=>{opens++;throw Error('pool must not open')},
  log:()=>{},warn:message=>warnings.push(message)});
 assert.equal(code,1);assert.equal(opens,0);
 assert.match(warnings[0],/integrated_http_staging_only/);
});
test('integration CLI fails closed if school imports or public writes are enabled',async()=>{
 for(const env of [
  {RD_DB_NAME:'ratsadaa_connect',RD_MIGRATION_ALLOW_IMPORT:'yes'},
  {RD_DB_NAME:'ratsadaa_connect',RD_ENABLE_SCHOOL_WRITES:'yes'}
 ]){
  let opens=0;
  const code=await run({env,makePool:()=>{opens++;throw Error('unsafe')},
   log:()=>{},warn:()=>{}});
  assert.equal(code,1);assert.equal(opens,0);
 }
});
test('private router cannot process logins without injected connection',async()=>{
 const req=Readable.from([]);
 req.method='POST';req.url='/api/auth/login';req.headers={};
 const res={status:0,body:null,
  writeHead(status){this.status=status},
  end(value){this.body=JSON.parse(value)}
 };
 await handleIntegratedStaging(req,res);
 assert.equal(res.status,503);
 assert.equal(res.body.error,'service_unavailable');
});
test('real public Passenger listener still denies every private integrated route',()=>{
 for(const [method,url] of [
  ['POST','/api/auth/login'],['GET','/api/classrooms'],
  ['GET','/api/attendance'],['GET','/api/portal/children'],
  ['POST','/web/rd-connect-node-test/api/portal/auth/login']
 ]){
  const res={status:0,body:null,writeHead(status){this.status=status},
   end(value){this.body=JSON.parse(value)}};
  requestHandler({method,url,headers:{}},res);
  assert.equal(res.status,501);
  assert.equal(res.body.error,'endpoint_not_migrated');
 }
});
