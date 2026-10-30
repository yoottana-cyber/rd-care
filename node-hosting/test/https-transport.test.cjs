'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {run,checkPath}=require('../scripts/check-https-transport.cjs');

test('static transport health and closed auth contracts',()=>{
 const warnings=[],logs=[];
 assert.equal(run({log:x=>logs.push(x),warn:x=>warnings.push(x)}),0);
 assert.deepEqual(warnings,[]);
 assert.match(logs.join(' '),/LOGIN CLOSED/);
});
test('staging transport is static and explicitly says not production ready',()=>{
 for(const url of ['/api/migration/transport','/web/rd-connect-node-test/api/migration/transport']){
  const res=checkPath(url,'GET');
  assert.equal(res.status,200);
  assert.deepEqual(res.body,{ok:true,check:'transport_only',login_enabled:false,migration_ready:false});
  assert.equal(res.headers['Cache-Control'],'no-store');
 }
});
test('auth login remains unexposed and health still fail closed',()=>{
 assert.equal(checkPath('/api/health','GET').status,503);
 for(const p of ['/api/auth/login','/api/portal/auth/login']){
  assert.equal(checkPath(p,'POST').status,501);
 }
 assert.equal(checkPath('/api/migration/transport','POST').status,405);
});
