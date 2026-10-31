'use strict';
// RD CONNECT migration: lab-only classification / storage of Web Push responses.
// Provider-accepted (201/202) != confirmed delivered to the user's device.
// NO HTTP transport, VAPID, endpoint URL handling, COMMIT or API exposure.
// Storage requires an independently claimed synthetic delivery row.
const {checkPermission,checkConnection}=require('./lab-truancy-push-queue.cjs');
const need=(ok,code)=>{if(!ok)throw Error('lab_push_receipt_'+code)};
const pos=n=>Number.isSafeInteger(n)&&n>0;
function classifyProviderStatus(status){
 if(status===null)return {
  outcome:'unknown',persist:false,state:null,terminal:false,
  accepted_by_provider:false,subscription_expired:false
 };
 need(Number.isInteger(status)&&status>=100&&status<=599,'invalid_http_status');
 if(status===201||status===202)return {
  outcome:'provider_accepted',persist:true,state:'delivered',terminal:true,
  accepted_by_provider:true,subscription_expired:false
 };
 if(status===404||status===410)return {
  outcome:'subscription_expired',persist:true,state:'failed',terminal:true,
  accepted_by_provider:false,subscription_expired:true
 };
 if([408,425,429].includes(status)||status>=500)return {
  outcome:'retryable_failure',persist:true,state:'failed',terminal:false,
  accepted_by_provider:false,subscription_expired:false
 };
 // Ambiguous 2xx, redirections and 4xx must not count as delivered or be
 // retried blindly. Needs operator/provider diagnosis.
 return {
  outcome:'non_retryable_response',persist:true,state:'failed',terminal:true,
  accepted_by_provider:false,subscription_expired:false
 };
}
const SQL=Object.freeze({
 advisor:`UPDATE truancy_push_deliveries
 SET state=?,last_http_status=?,attempts=IF(?,3,attempts),
 updated_at=CURRENT_TIMESTAMP
 WHERE event_id=? AND generation=? AND recipient_type='advisor'
  AND subscription_id=? AND state='sending' AND attempts=?`,
 guardian:`UPDATE truancy_push_deliveries
 SET state=?,last_http_status=?,attempts=IF(?,3,attempts),
 updated_at=CURRENT_TIMESTAMP
 WHERE event_id=? AND generation=? AND recipient_type='guardian'
  AND subscription_id=? AND state='sending' AND attempts=?`,
 student:`UPDATE student_push_deliveries
 SET state=?,last_http_status=?,attempts=IF(?,3,attempts),
 updated_at=CURRENT_TIMESTAMP
 WHERE event_kind='truancy' AND event_id=? AND generation=?
  AND subscription_id=? AND state='sending' AND attempts=?`
});
async function recordProviderReceipt(conn,job,status,{env}={}){
 checkPermission(env);
 need(job&&pos(job.event_id)&&pos(job.generation)&&
  pos(job.subscription_id)&&pos(job.attempt)&&job.attempt<=3 &&
  Object.prototype.hasOwnProperty.call(SQL,job.type),'invalid_job');
 const outcome=classifyProviderStatus(status);
 await checkConnection(conn);
 // A request without a definitive provider HTTP response is NOT a receipt.
 // Leave sending unchanged; after cooldown the claim layer may retry. Push
 // delivery is at-least-once in network uncertainty, NOT exactly-once.
 if(!outcome.persist)return {
  ...outcome,acknowledged:false,sent:false,device_delivery_confirmed:false
 };
 const [updated]=await conn.execute(SQL[job.type],[
  outcome.state,status,outcome.terminal?1:0,job.event_id,
  job.generation,job.subscription_id,job.attempt
 ]);
 need(Number.isSafeInteger(Number(updated?.affectedRows)),'invalid_result');
 const acknowledged=Number(updated.affectedRows)===1;
 return {...outcome,acknowledged,accepted_by_provider:
  acknowledged&&outcome.accepted_by_provider,
  device_delivery_confirmed:false,
  requires_subscription_cleanup:acknowledged&&outcome.subscription_expired,
  sent:false
 };
}
module.exports={SQL,classifyProviderStatus,recordProviderReceipt};
