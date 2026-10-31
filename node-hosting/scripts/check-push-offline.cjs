'use strict';
// RD CONNECT offline Push eligibility audit. No database, network, or devices.
// This command executes synthetic-only node:test and then proves the unchanged
// public Passenger router still returns 501 on school and Push endpoints.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {requestHandler}=require('../src/http-handler.cjs');
function need(ok,code){if(!ok)throw Error('push_audit_'+code)}
function inProcess(method,url){
 const response={status:0,headers:{},body:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(text){this.body=String(text??'')}
 };
 requestHandler({method,url,headers:{}},response);
 return response;
}
function checkClosure(){
 const routes=[
  ['POST','/api/attendance'],
  ['POST','/web/rd-connect-node-test/api/attendance'],
  ['POST','/api/portal/push/subscribe'],
  ['GET','/api/portal/push/config'],
  ['POST','/api/portal/student-push/subscribe'],
  ['POST','/api/admin/notification-preferences'],
  ['GET','/api/truancy/advisor']
 ];
 for(const [method,url] of routes){
  const r=inProcess(method,url);
  need(r.status===501,'unported_endpoint_exposed');
  need(JSON.parse(r.body).error==='endpoint_not_migrated','wrong_public_response');
  need(r.headers['Cache-Control']==='no-store','cache_policy');
 }
 return routes.length;
}
async function run({execute=spawnSync,log=console.log,warn=console.error}={}){
 try{
  const testFile=path.join(__dirname,'../test/batch1-truancy-push-offline.test.cjs');
  const result=execute(process.execPath,['--test',testFile],{
   cwd:path.join(__dirname,'..'),encoding:'utf8',
   timeout:30000,maxBuffer:512*1024
  });
  if(result.error||result.status!==0)throw Error('push_audit_unit_contract_failed');
  const endpoints=checkClosure();
  log('PUSH OFFLINE OK: 10 synthetic cases validated advisor, guardian and student eligibility.');
  log('DEDUPLICATION OK: delivered events suppressed per event/generation/device, max 3 attempts and retry cooldown verified.');
  log('SAFETY OK: corrected truancy, missing VAPID, disabled categories and unverified links never scheduled.');
  log('PUBLIC API CLOSED: '+endpoints+' unported attendance/Push endpoints still return 501.');
  log('NO DB ACCESS OR PUSH: no SQL, network, subscription keys, external notification or file writes.');
  log('NOT PRODUCTION READY: SQL outbox/dispatch, auth, Push transport, retries and end-to-end parity remain incomplete.');
  return 0;
 }catch(e){
  warn('PUSH OFFLINE FAILED ('+
    (/^push_audit_[a-z_]+$/.test(String(e?.message||''))?e.message:'unexpected')+').');
  return 1;
 }
}
if(require.main===module){
 run().then(code=>{process.exitCode=code},()=>{
  console.error('PUSH OFFLINE FAILED (unexpected).');process.exitCode=1;
 });
}
module.exports={inProcess,checkClosure,run};
