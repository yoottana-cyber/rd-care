'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {requestHandler}=require('../src/http-handler.cjs');
function response(){
 let status=null,payload=null;
 return {
  get result(){return {status,payload}},
  writeHead(s){status=s;},
  end(str){payload=JSON.parse(str)}
 };
}
test('all old auth HTTP paths are still fail-closed, even after internal module is present',()=>{
 const paths=[
  '/api/auth/login','/api/auth/me','/api/auth/logout','/api/auth/keep-alive',
  '/api/portal/auth/login','/api/portal/auth/me','/api/portal/auth/logout',
  '/web/rd-connect-node-test/api/auth/login',
  '/web/rd-connect-node-test/api/portal/auth/login'
 ];
 for(const path of paths){
  for(const method of ['GET','POST']){
   const res=response();
   requestHandler({url:path,method},res);
   assert.equal(res.result.status,501,path+' '+method);
   assert.equal(res.result.payload.error,'endpoint_not_migrated');
  }
 }
});
test('health route is not advertised as ready',()=>{
 const res=response();
 requestHandler({url:'/api/health',method:'GET'},res);
 assert.equal(res.result.status,503);
 assert.equal(res.result.payload.error,'migration_not_ready');
});
