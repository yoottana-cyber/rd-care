'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {simulateDelivery,mockedProviderResponse,attemptSql}
 =require('../src/lab-push-mock-dispatch.cjs');
const {run}=require('../scripts/check-lab-push-dispatch-rollback.cjs');
const env={RD_DB_NAME:'ratsadaa_connect',RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
 RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:'RUN_LAB_PUSH_QUEUE_ROLLBACK_B1'};
const job={event_id:77,generation:1,type:'advisor',subscription_id:99};
function conn({claimable=true,receiptAffected=1}={}){
 const calls=[];
 return {calls,async execute(sql,args=[]){
  calls.push({sql,args});
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
  if(sql.startsWith('UPDATE ')&&sql.includes("SET state='sending'"))
   return [{affectedRows:claimable?1:0}];
  if(sql.startsWith('SELECT attempts,state'))
   return [[{attempts:2,state:'sending'}]];
  if(sql.startsWith('UPDATE ')&&sql.includes('SET state=?,last_http_status=?'))
   return [{affectedRows:receiptAffected}];
  throw Error('unexpected query');
 }};
}
test('synthetic provider 201 is stored only after conditional SQL claim',async()=>{
 const c=conn();
 const report=await simulateDelivery(c,job,201,{env});
 assert.equal(report.claimed,true);
 assert.equal(report.provider_accepted,true);
 assert.equal(report.device_delivery_confirmed,false);
 assert.equal(report.attempt,2);
 assert.equal(report.simulation_only,true);
 assert.equal(c.calls.filter(x=>x.sql.startsWith('UPDATE ')).length,2);
 assert.deepEqual(c.calls.at(-1).args,['delivered',201,1,77,1,99,2]);
});
test('no claim means no fake provider response is recorded',async()=>{
 const c=conn({claimable:false});
 const out=await simulateDelivery(c,job,201,{env});
 assert.equal(out.claimed,false);
 assert.equal(out.provider_accepted,false);
 assert.equal(c.calls.some(x=>x.sql.includes('last_http_status')),false);
});
test('unknown network result leaves sending, and never marks accepted',async()=>{
 const c=conn();
 const out=await simulateDelivery(c,job,null,{env});
 assert.equal(out.claimed,true);
 assert.equal(out.outcome,'unknown');
 assert.equal(out.receipt_acknowledged,false);
 assert.equal(out.provider_accepted,false);
 assert.equal(c.calls.some(x=>x.sql.includes('last_http_status')),false);
});
test('HTTP 410 requests cleanup but no recipient/subscription is deleted by lab',async()=>{
 const c=conn();
 const out=await simulateDelivery(c,{...job,type:'guardian'},410,{env});
 assert.equal(out.requires_subscription_cleanup,true);
 assert.equal(out.provider_accepted,false);
 assert.equal(c.calls.every(x=>!x.sql.startsWith('DELETE ')),true);
});
test('HTTP 429 and 503 remain bounded, failed and not accepted',async()=>{
 for(const status of [429,503]){
  const c=conn();
  const out=await simulateDelivery(c,{...job,type:'student'},status,{env});
  assert.equal(out.provider_accepted,false);
  assert.equal(out.outcome,'retryable_failure');
  assert.equal(out.receipt_acknowledged,true);
  assert.equal(c.calls.at(-1).args[0],'failed');
  assert.equal(c.calls.at(-1).args[2],0);
 }
});
test('stale provider response cannot override a newer attempt',async()=>{
 const c=conn({receiptAffected:0});
 const out=await simulateDelivery(c,job,202,{env});
 assert.equal(out.provider_accepted,false);
 assert.equal(out.receipt_acknowledged,false);
});
test('reject wrong DB, opt-in, invalid type or fake URL before using query',async()=>{
 for(const options of [
  {env:{...env,RD_DB_NAME:'ratsadaa_trgtest'}},
  {env:{...env,RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE:''}}
 ]){
  const c=conn();
  await assert.rejects(()=>simulateDelivery(c,job,201,options),/lab_push_/);
  assert.equal(c.calls.length,0);
 }
 for(const invalid of [{...job,type:'stranger'},{
  ...job,subscription_id:-1
 }]){
  const c=conn();
  await assert.rejects(()=>simulateDelivery(c,invalid,201,{env}),
   /lab_dispatch_job_invalid/);
  assert.equal(c.calls.length,0);
 }
 assert.throws(()=>mockedProviderResponse('201'),/lab_dispatch_mock_response_invalid/);
 assert.throws(()=>attemptSql('unknown'),/lab_dispatch_audience_invalid/);
});
test('full MariaDB script refuses to create pool without explicit opt-in',async()=>{
 let opened=false;
 const lines=[];
 const code=await run({env:{},driver:{createPool(){
  opened=true;throw Error('unexpected pool created');
 }},log:()=>{},warn:s=>lines.push(s)});
 assert.equal(code,1);
 assert.equal(opened,false);
 assert.match(lines[0],/lab_push_opt_in_required/);
});
