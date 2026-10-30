'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {makeAuthProbe,configured,secretMatches}=require('../src/https-auth-probe.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const {run}=require('../scripts/check-https-auth-gate.cjs');
const SECRET='ab'.repeat(32),AT=1800000000000;
function req(method='POST',secret=SECRET){
 return {method,url:'/api/migration/auth-probe',headers:{'x-rd-https-probe-secret':secret,'content-length':'0'}};
}
async function hit(handler,request){
 const res={status:0,body:null,headers:null,
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.body=JSON.parse(body)}
 };
 await handler(request,res);return res;
}
test('probe requires opt-in, 32-byte token and bounded expiry',()=>{
 const env={RD_AUTH_HTTPS_PROBE_ENABLE:'1',RD_AUTH_HTTPS_PROBE_SECRET:SECRET,
  RD_AUTH_HTTPS_PROBE_UNTIL:String(AT/1000+600)};
 assert.equal(configured(env,AT),true);
 assert.equal(configured({...env,RD_AUTH_HTTPS_PROBE_ENABLE:'0'},AT),false);
 assert.equal(configured({...env,RD_AUTH_HTTPS_PROBE_UNTIL:String(AT/1000+3601)},AT),false);
 assert.equal(configured({...env,RD_AUTH_HTTPS_PROBE_UNTIL:String(AT/1000-1)},AT),false);
 assert.equal(secretMatches(SECRET,SECRET),true);
 assert.equal(secretMatches('cd'.repeat(32),SECRET),false);
});
test('one-shot synthetic probe closes pool; unauthorized calls never touch DB',async()=>{
 let opened=0,closed=0,released=0;
 const env={RD_AUTH_HTTPS_PROBE_ENABLE:'1',RD_AUTH_HTTPS_PROBE_SECRET:SECRET,
  RD_AUTH_HTTPS_PROBE_UNTIL:String(AT/1000+600)};
 const handler=makeAuthProbe({env,now:()=>AT,
  makePool:()=>{opened++;return {getConnection:async()=>({release(){released++}}),end:async()=>{closed++}};},
  verifyAll:async()=>true
 });
 assert.equal((await hit(handler,req('GET'))).status,405);
 assert.equal((await hit(handler,req('POST','cd'.repeat(32)))).status,404);
 assert.equal(opened,0);
 const ok=await hit(handler,req());
 assert.equal(ok.status,200);assert.equal(ok.body.rollback_verified,true);
 assert.equal(ok.body.login_enabled,false);assert.equal(ok.body.migration_ready,false);
 assert.equal(opened,1);assert.equal(closed,1);assert.equal(released,1);
 assert.equal((await hit(handler,req())).status,429);
 assert.equal(opened,1);
});
test('offline gate preflight succeeds while public auth stays closed',async()=>{
 const logs=[],errors=[];
 assert.equal(await run({log:s=>logs.push(s),warn:s=>errors.push(s)}),0);
 assert.deepEqual(errors,[]);
 for(const path of ['/api/auth/login','/api/portal/auth/login']){
  const res=await hit(requestHandler,{method:'POST',url:path,headers:{}});
  assert.equal(res.status,501);assert.equal(res.body.error,'endpoint_not_migrated');
 }
});
