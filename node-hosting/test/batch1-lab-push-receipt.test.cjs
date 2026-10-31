'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 SQL,classifyProviderStatus,recordProviderReceipt
}=require('../src/lab-push-provider-receipt.cjs');
const OPT_IN='RUN_LAB_PUSH_QUEUE_ROLLBACK_B1';
const env={RD_DB_NAME:'ratsadaa_connect',
 RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
 RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:OPT_IN};
const base={event_id:20,generation:2,type:'advisor',subscription_id:9,attempt:1};
function fake(affectedRows=1){
 const calls=[];
 return {calls,async execute(sql,args=[]){
  calls.push({sql,args});
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
  if(sql.startsWith('UPDATE '))return [{affectedRows}];
  throw Error('unapproved SQL');
 }};
}
test('only confirmed push provider 201 or 202 counts as accepted, never end-device delivered',()=>{
 for(const status of [201,202]){
  const result=classifyProviderStatus(status);
  assert.equal(result.state,'delivered');
  assert.equal(result.accepted_by_provider,true);
  assert.equal(result.outcome,'provider_accepted');
 }
 for(const status of [200,204,301,400,401,403,404,410,429,500,503]){
  assert.equal(classifyProviderStatus(status).accepted_by_provider,false);
 }
});
test('terminal gone subscriptions 404/410 are not retried and only request targeted cleanup',async()=>{
 for(const status of [404,410]){
  const conn=fake();
  const result=await recordProviderReceipt(conn,{...base,type:'guardian'},status,{env});
  assert.equal(result.acknowledged,true);
  assert.equal(result.state,'failed');
  assert.equal(result.requires_subscription_cleanup,true);
  assert.equal(result.device_delivery_confirmed,false);
  assert.deepEqual(conn.calls.at(-1).args,
   ['failed',status,1,20,2,9,1]);
 }
});
test('rate limited and server failures can be retried after bounded cooldown',async()=>{
 for(const status of [408,429,500,502,503,599]){
  const conn=fake();
  const result=await recordProviderReceipt(conn,base,status,{env});
  assert.equal(result.outcome,'retryable_failure');
  assert.equal(result.terminal,false);
  assert.equal(result.requires_subscription_cleanup,false);
  assert.equal(conn.calls.at(-1).args[2],0);
 }
});
test('missing network response stays sending and is never misreported as delivered',async()=>{
 const conn=fake();
 const result=await recordProviderReceipt(conn,base,null,{env});
 assert.equal(result.outcome,'unknown');
 assert.equal(result.acknowledged,false);
 assert.equal(result.accepted_by_provider,false);
 assert.equal(result.device_delivery_confirmed,false);
 assert.equal(conn.calls.length,1);
});
test('stale receipt from old claim attempt cannot overwrite a newer claim',async()=>{
 const conn=fake(0);
 const result=await recordProviderReceipt(conn,{...base,attempt:1},
  201,{env});
 assert.equal(result.acknowledged,false);
 assert.equal(result.accepted_by_provider,false);
 assert.equal(conn.calls.at(-1).sql.includes("state='sending' AND attempts=?"),true);
});
test('all audiences update only state and HTTP status for the matching claim',async()=>{
 for(const type of ['advisor','guardian','student']){
  const conn=fake();
  const result=await recordProviderReceipt(conn,{...base,type,attempt:2},
   202,{env});
  assert.equal(result.acknowledged,true);
  assert.equal(result.device_delivery_confirmed,false);
  assert.equal(result.sent,false);
  assert.match(SQL[type],/WHERE event/);
  assert.match(SQL[type],/attempts=\?/);
  assert.deepEqual(conn.calls.at(-1).args,['delivered',202,1,20,2,9,2]);
 }
});
test('4xx/redirect/ambiguous 2xx never permit a false success or unbounded retries',()=>{
 for(const status of [200,204,301,400,401,403,422]){
  const outcome=classifyProviderStatus(status);
  assert.equal(outcome.accepted_by_provider,false);
  assert.equal(outcome.state,'failed');
  assert.equal(outcome.terminal,true);
 }
 assert.throws(()=>classifyProviderStatus(undefined),/invalid_http_status/);
 assert.throws(()=>classifyProviderStatus(999),/invalid_http_status/);
});
test('cannot accidentally use staging database, wrong flag or invalid audience',async()=>{
 const conn=fake();
 await assert.rejects(()=>recordProviderReceipt(conn,base,201,
  {env:{...env,RD_DB_NAME:'ratsadaa_trgtest'}}),/lab_push_wrong_environment/);
 await assert.rejects(()=>recordProviderReceipt(conn,base,201,
  {env:{...env,RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:''}}),/lab_push_opt_in_required/);
 await assert.rejects(()=>recordProviderReceipt(conn,{...base,type:'public'},201,{env}),
  /lab_push_receipt_invalid_job/);
 assert.equal(conn.calls.length,0);
});
