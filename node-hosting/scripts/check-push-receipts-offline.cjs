'use strict';
// One-command test of Push provider HTTP receipts and DB-update contracts.
// Runs synthetic node:test only. No DB connections or network requests.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {requestHandler}=require('../src/http-handler.cjs');
const {classifyProviderStatus}=require('../src/lab-push-provider-receipt.cjs');
function publicClosed(){
 const res={status:0,body:'',
  writeHead(code){this.status=code},end(s){this.body=String(s)}
 };
 requestHandler({method:'POST',url:'/api/portal/push/subscribe',headers:{}},res);
 return res.status===501&&JSON.parse(res.body).error==='endpoint_not_migrated';
}
function run({execute=spawnSync,log=console.log,warn=console.error}={}){
 try{
  const name=path.join(__dirname,'../test/batch1-lab-push-receipt.test.cjs');
  const p=execute(process.execPath,['--test',name],{
   cwd:path.join(__dirname,'..'),encoding:'utf8',
   timeout:30000,maxBuffer:1024*1024
  });
  if(p.error||p.status!==0)throw Error('synthetic_tests_failed');
  if(!publicClosed())throw Error('public_api_exposed');
  if(!classifyProviderStatus(201).accepted_by_provider||
    classifyProviderStatus(null).persist||
    classifyProviderStatus(410).accepted_by_provider)
   throw Error('receipt_contract_changed');
  log('PUSH RECEIPTS OFFLINE OK: 8 synthetic cases, claim-scoped SQL and HTTP response classification.');
  log('PROVIDER ACCEPTANCE OK: HTTP 201/202 only; not proof of device delivery.');
  log('FAILURE HANDLING OK: 404/410 terminal, 429/5xx retryable, unknown network outcome not accepted.');
  log('STALE CLAIMS BLOCKED: receipt cannot overwrite another retry attempt.');
  log('PUBLIC API CLOSED: unported Push registration still responds 501.');
  log('NO DB OR NETWORK: no MariaDB, provider calls, VAPID keys or real subscriptions accessed.');
  log('NOT PRODUCTION READY: provider sender and durable end-to-end delivery tests still pending.');
  return 0;
 }catch(e){
  const reason=String(e?.message||'');
  warn('PUSH RECEIPTS OFFLINE FAILED ('+
   (/^(synthetic_tests_failed|public_api_exposed|receipt_contract_changed)$/.test(reason)?
    reason:'unexpected')+').');
  return 1;
 }
}
if(require.main===module)process.exitCode=run();
module.exports={run,publicClosed};
