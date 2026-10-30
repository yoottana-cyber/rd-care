'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {run,invoke}=require('../scripts/check-auth-http.cjs');
const {ROUTES,MAX_BODY_BYTES}=require('../src/staging-auth-http.cjs');
const {requestHandler}=require('../src/http-handler.cjs');

test('offline auth HTTP contract checks pass without network or DB writes',async()=>{
 const logs=[],warnings=[];
 const code=await run({log:message=>logs.push(message),warn:message=>warnings.push(message)});
 assert.equal(code,0);
 assert.deepEqual(warnings,[]);
 assert.match(logs.join('\n'),/PUBLIC AUTH STILL CLOSED/);
});
test('only exact staging auth routes are registered',()=>{
 assert.equal(Object.keys(ROUTES).length,6);
 assert.equal(MAX_BODY_BYTES,8192);
 assert.equal(ROUTES['/api/portal/auth/login'].kind,'portal');
 assert.equal(ROUTES['/api/auth/me'].method,'GET');
});
test('requests without an explicit DB connection fail closed',async()=>{
 const res=await invoke('POST','/api/auth/login',{username:'foo',password:'fake-pass'}, {},{});
 assert.equal(res.status,503);
 assert.equal(res.json().error,'auth_unavailable');
});
test('unexpected URL fails closed with no service calls',async()=>{
 let called=false;
 const services={login:async()=>{called=true;return {ok:true}}};
 const res=await invoke('POST','/web/rd-connect-node-test/api/private',
  {username:'foo',password:'synthetic'}, {},{connection:{},services});
 assert.equal(res.status,404);
 assert.equal(called,false);
});
test('production-facing HTTP router never imports the staging auth adapter',()=>{
 const res={status:0,text:'',writeHead(status){this.status=status},end(str){this.text=str}};
 requestHandler({url:'/api/auth/login',method:'POST'},res);
 assert.equal(res.status,501);
 assert.equal(JSON.parse(res.text).error,'endpoint_not_migrated');
});
