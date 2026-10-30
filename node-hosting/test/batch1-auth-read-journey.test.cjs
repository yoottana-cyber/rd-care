'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {request,run}=require('../scripts/check-lab-auth-read-journey.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const {AUTH_PATHS,READ_PATHS,normalize}
 =require('../src/staging-school-internal-router.cjs');
test('internal routes include 6 exact auth and 8 scoped read views, never write endpoints',()=>{
 assert.equal(AUTH_PATHS.size,6);
 assert.equal(READ_PATHS.size,8);
 assert.ok(AUTH_PATHS.has('/api/auth/login'));
 assert.ok(AUTH_PATHS.has('/api/portal/auth/me'));
 assert.ok(READ_PATHS.has('/api/attendance'));
 assert.ok(READ_PATHS.has('/api/portal/behavior'));
 assert.ok(!READ_PATHS.has('/api/attendance/commit'));
});
test('Internal router rejects unknown routing, disallowed method and absent tokens',async()=>{
 const conn={};
 const a=await request(conn,'GET','/api/not_migrated');
 assert.equal(a.status,404);
 const b=await request(conn,'POST','/api/classrooms',{body:{other:true}});
 assert.equal(b.status,405);
 const c=await request(conn,'GET','/api/auth/me');
 assert.equal(c.status,401);
});
test('internal routing accepts the exact staging prefix, but not fake suffixes',()=>{
 assert.equal(normalize({url:'/web/rd-connect-node-test/api/classrooms'}),
  '/api/classrooms');
 assert.equal(normalize({url:'/some/other/api/classrooms'}),
  '/some/other/api/classrooms');
 assert.throws(()=>normalize({url:'http://user:password@localhost/api/classrooms'}),
  /invalid_url/);
});
test('public Passenger returns 501 for private auth, guardian and student views',()=>{
 const routes=['/api/auth/login','/api/auth/me','/api/classrooms',
  '/api/students','/api/attendance','/api/portal/children',
  '/api/portal/attendance','/api/portal/behavior'];
 for(const url of routes){
  const res={status:0,body:'',writeHead(status){this.status=status},
   end(body){this.body=String(body)}};
  requestHandler({url,method:'GET',headers:{}},res);
  assert.equal(res.status,501);
  assert.equal(JSON.parse(res.body).error,'endpoint_not_migrated');
 }
});
test('refuses lab auth scenario if staging alias, real writes or old flag are present',async()=>{
 for(const patch of [
  {RD_DB_NAME:'ratsadaa_trgtest'},
  {RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'},
  {RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:'old'}
 ]){
  let pooled=false;const warning=[];
  const env={RD_DB_NAME:'ratsadaa_connect',
   RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',...patch};
  const result=await run({env,driver:{createPool(){pooled=true;throw Error('unsafe_connect')}},
   log:()=>{},warn:x=>warning.push(x)});
  assert.equal(result,1);
  assert.equal(pooled,false);
  assert.match(warning[0],/AUTH \+ READ LAB FAILED/);
 }
});
test('never exposes token, password or SQL diagnostic details when missing DB credentials',async()=>{
 const warnings=[];const code=await run({env:{
  RD_DB_NAME:'ratsadaa_connect',RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest'
 },driver:{createPool(){throw Error('must not connect')}},
 log:()=>{},warn:x=>warnings.push(x)});
 assert.equal(code,1);
 const s=warnings.join(' ');
 assert.equal(s.includes('password='),false);
 assert.equal(s.includes('Bearer '),false);
 assert.match(s,/AUTH \+ READ LAB FAILED/);
});
