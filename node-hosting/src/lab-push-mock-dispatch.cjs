'use strict';
// RD CONNECT isolated lab-only sender orchestration, mock HTTP response only.
// Prohibits actual transport: this source imports no fetch/http/web-push.
// Caller holds a transaction and MUST ROLLBACK. No COMMIT or public API.
// All recipient IDs are synthetic and derived from verified queue records.
const {claim,checkPermission,checkConnection}=require('./lab-truancy-push-queue.cjs');
const {recordProviderReceipt}=require('./lab-push-provider-receipt.cjs');
const need=(ok,code)=>{if(!ok)throw Error('lab_dispatch_'+code)};
const TYPES=new Set(['advisor','guardian','student']);
const pos=n=>Number.isSafeInteger(n)&&n>0;
function attemptSql(type){
 need(TYPES.has(type),'audience_invalid');
 if(type==='student')return `SELECT attempts,state
 FROM student_push_deliveries
 WHERE event_kind='truancy' AND event_id=? AND generation=?
 AND subscription_id=? LIMIT 1 FOR UPDATE`;
 return `SELECT attempts,state FROM truancy_push_deliveries
 WHERE event_id=? AND generation=? AND recipient_type=?
 AND subscription_id=? LIMIT 1 FOR UPDATE`;
}
function jobArgs(job){
 return job.type==='student'?
  [job.event_id,job.generation,job.subscription_id]:
  [job.event_id,job.generation,job.type,job.subscription_id];
}
function validateJob(job){
 need(job&&TYPES.has(job.type)&&pos(job.event_id)&&
  pos(job.generation)&&pos(job.subscription_id),'job_invalid');
}
function mockedProviderResponse(status){
 // The lab accepts only an explicit deterministic, numeric synthetic result
 // or null for an unknown network result; no URLs, callbacks or sockets.
 need(status===null||(Number.isInteger(status)&&status>=100&&status<=599),
  'mock_response_invalid');
 return status;
}
async function simulateDelivery(conn,job,providerHttpStatus,{env}={}){
 checkPermission(env);validateJob(job);
 const status=mockedProviderResponse(providerHttpStatus);
 await checkConnection(conn);
 const attempt=await claim(conn,job,{env});
 if(!attempt.claimed)return {
  claimed:false,provider_accepted:false,device_delivery_confirmed:false,
  simulation_only:true,reason:'not_claimable'
 };
 const [[row]]=await conn.execute(attemptSql(job.type),jobArgs(job));
 need(row&&row.state==='sending'&&pos(Number(row.attempts))&&
  Number(row.attempts)<=3,'claim_state_missing');
 const receipt=await recordProviderReceipt(conn,
  {...job,attempt:Number(row.attempts)},status,{env});
 return {
  claimed:true,attempt:Number(row.attempts),
  receipt_acknowledged:receipt.acknowledged,
  outcome:receipt.outcome,
  provider_accepted:receipt.accepted_by_provider===true,
  device_delivery_confirmed:false,
  requires_subscription_cleanup:receipt.requires_subscription_cleanup===true,
  simulation_only:true
 };
}
module.exports={TYPES,attemptSql,jobArgs,validateJob,mockedProviderResponse,simulateDelivery};
