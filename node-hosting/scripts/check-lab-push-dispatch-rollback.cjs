'use strict';
// RD CONNECT: fake Web Push response end-to-end through MariaDB's lab queue.
// No network calls, no HTTP endpoints, no VAPID, no school data.
// ALL synthetic records and receipts are rolled back even on test success.
const {getLabConfig}=require('./check-trigger-lab.cjs');
const {inspectSet,assertEmpty}=require('../src/lab-timetable-guards.cjs');
const {category}=require('./check-db.cjs');
const {bangkokToday}=require('../src/attendance-write-contract.cjs');
const {prepare,queryStates}=require('./check-lab-push-queue-rollback.cjs');
const {OPT_IN,checkPermission,queueEvent}
 =require('../src/lab-truancy-push-queue.cjs');
const {recordProviderReceipt}=require('../src/lab-push-provider-receipt.cjs');
const {simulateDelivery}=require('../src/lab-push-mock-dispatch.cjs');
const need=(ok,code)=>{if(!ok)throw Error('lab_dispatch_'+code)};

async function fullCycle(conn,env,date,{injected=false}={}){
 await conn.beginTransaction();
 try{
  const f=await prepare(conn,date);
  const first=await queueEvent(conn,f.eventId,{env});
  need(first.queued===4&&first.advisor===2&&first.guardian===1&&
   first.student===1,'queue_incomplete');
  const pair={event_id:f.eventId,generation:1};
  const advisor1={...pair,type:'advisor',
   subscription_id:f.subscriptions.advisor[0]};
  const advisor2={...pair,type:'advisor',
   subscription_id:f.subscriptions.advisor[1]};
  const guardian={...pair,type:'guardian',
   subscription_id:f.subscriptions.guardian[0]};
  const student={...pair,type:'student',
   subscription_id:f.subscriptions.student[0]};
  const good=await simulateDelivery(conn,advisor1,201,{env});
  need(good.provider_accepted&&good.receipt_acknowledged&&
   !good.device_delivery_confirmed&&good.attempt===1,'provider_201_not_recorded');
  const duplicate=await simulateDelivery(conn,advisor1,201,{env});
  need(!duplicate.claimed,'delivered_duplicate_claim');
  if(injected)throw Error('lab_dispatch_injected_failure');
  const unknown=await simulateDelivery(conn,advisor2,null,{env});
  need(unknown.claimed&&!unknown.receipt_acknowledged&&
   !unknown.provider_accepted&&unknown.outcome==='unknown',
   'ambiguous_network_outcome');
  const immediate=await simulateDelivery(conn,advisor2,202,{env});
  need(!immediate.claimed,'cooldown_not_enforced');
  await conn.execute(
   "UPDATE truancy_push_deliveries SET updated_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 3 MINUTE) WHERE event_id=? AND recipient_type='advisor' AND subscription_id=?",
   [f.eventId,advisor2.subscription_id]);
  const server=await simulateDelivery(conn,advisor2,503,{env});
  need(server.claimed&&server.attempt===2&&
   server.outcome==='retryable_failure','retryable_503_not_recorded');
  const stale=await recordProviderReceipt(conn,{...advisor2,attempt:1},201,{env});
  need(!stale.acknowledged&&!stale.accepted_by_provider,
   'old_claim_overwrote_new_attempt');
  await conn.execute(
   "UPDATE truancy_push_deliveries SET updated_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 3 MINUTE) WHERE event_id=? AND recipient_type='advisor' AND subscription_id=?",
   [f.eventId,advisor2.subscription_id]);
  const accepted=await simulateDelivery(conn,advisor2,202,{env});
  need(accepted.provider_accepted&&accepted.attempt===3,'attempt3_acceptance_missing');
  const exhausted=await simulateDelivery(conn,advisor2,202,{env});
  need(!exhausted.claimed,'attempt_limit_overrun');
  const gone=await simulateDelivery(conn,guardian,410,{env});
  need(gone.claimed&&!gone.provider_accepted&&
   gone.requires_subscription_cleanup,'expired_410_not_terminal');
  const goneAgain=await simulateDelivery(conn,guardian,201,{env});
  need(!goneAgain.claimed,'expired_recipient_retried');
  const throttle=await simulateDelivery(conn,student,429,{env});
  need(throttle.claimed&&throttle.outcome==='retryable_failure',
   'rate_limit_retry_failed');
  await conn.execute(
   "UPDATE student_push_deliveries SET updated_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 3 MINUTE) WHERE event_kind='truancy' AND event_id=? AND subscription_id=?",
   [f.eventId,student.subscription_id]);
  const studentOkay=await simulateDelivery(conn,student,201,{env});
  need(studentOkay.provider_accepted&&studentOkay.attempt===2,
   'student_retry_not_accepted');
  const history=await queryStates(conn,f.eventId,1);
  need(history.staff.length===3&&history.students.length===1,
   'delivery_rows_missing');
  const statuses=history.staff.map(x=>x.state);
  need(statuses.filter(x=>x==='delivered').length===2&&
   statuses.filter(x=>x==='failed').length===1&&
   history.students[0].state==='delivered','status_counts_incorrect');
  await conn.execute('UPDATE truancy_events SET active=0 WHERE id=?',[f.eventId]);
  const stopped=await simulateDelivery(conn,{...advisor1,generation:2},201,{env});
  need(!stopped.claimed,'inactive_generation_accepted');
  await conn.execute('UPDATE truancy_events SET active=1,generation=2 WHERE id=?',[f.eventId]);
  const reopened=await queueEvent(conn,f.eventId,{env});
  need(reopened.generation===2&&reopened.queued===4,
   'new_generation_not_queued');
  return {claims:4,corrected_blocked:true,
   provider_acknowledgments:3,failed_receipt:2,
   unknown_kept_unconfirmed:true,rollback_required:true};
 }finally{
  await conn.rollback();
  await assertEmpty(conn);
 }
}
async function run({env=process.env,driver,
 log=console.log,warn=console.error}={}){
 let pool,conn,ok=false,error;
 try{
  checkPermission(env);
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...getLabConfig(env),connectionLimit:1,queueLimit:1});
  conn=await pool.getConnection();
  await inspectSet(conn,5);
  await assertEmpty(conn);
  const date=bangkokToday();
  const result=await fullCycle(conn,env,date);
  let injected=false;
  try{await fullCycle(conn,env,date,{injected:true})}catch(e){
   injected=e?.message==='lab_dispatch_injected_failure'
  }
  need(result.rollback_required&&injected,'injected_failure_not_rolled_back');
  await assertEmpty(conn);
  await inspectSet(conn,5);
  ok=true;
 }catch(e){error=e}
 finally{
  if(conn){
   let rolledBack=false;
   try{await conn.rollback();rolledBack=true}catch{}
   if(rolledBack){try{conn.release()}catch{}}
   else if(typeof conn.destroy==='function')try{conn.destroy()}catch{}
  }
  if(pool){try{await pool.end()}catch{}}
 }
 if(!ok){
  const reason=String(error?.message||'');
  warn('PUSH DISPATCH LAB FAILED ('+
   (/^lab_dispatch_[a-z_]+$/.test(reason)?reason:category(error))+').');
  warn('NO COMMIT executed; confirm lab emptiness before any retry if rollback uncertain.');
  return 1;
 }
 log('PUSH DISPATCH LAB OK: four synthetic devices processed using mocked HTTP provider responses.');
 log('RECEIPT INTEGRITY OK: 201/202 accepted, 410 terminal, 429/503 retryable and null response unknown.');
 log('RETRY SAFETY OK: one failed attempt cannot overwrite another; 2-minute cooldown, max 3 attempts and generation dedupe.');
 log('PUBLIC PUSH DISABLED: no actual network, VAPID, external device or public API involved.');
 log('ROLLBACK VERIFIED: complete mock dispatch and injected failure reverted without COMMIT.');
 log('LAB UNCHANGED: 63 empty tables, 5 original triggers, no permanent records.');
 log('NOT PRODUCTION READY: real sender, multi-connection concurrency, authorization and cutover remain unverified.');
 return 0;
}
if(require.main===module)run().then(c=>{process.exitCode=c},()=>{
 console.error('PUSH DISPATCH LAB FAILED (unexpected).');process.exitCode=1;
});
module.exports={OPT_IN,fullCycle,run};
