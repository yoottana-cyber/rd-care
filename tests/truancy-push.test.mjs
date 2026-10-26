import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createECDH} from 'node:crypto';
import {guardianPushRoutes,deliverTruancyPush} from '../worker/src/truancy-push.js';
import {STATUS,PERIOD_STATUS,validateEntries} from '../worker/src/core.js';
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const subscription={
 endpoint:'https://fcm.googleapis.com/fcm/send/'+b64(randomBytes(32)),
 keys:{p256dh:b64(ecdh.getPublicKey(null,'uncompressed')),auth:b64(randomBytes(16))}
};
const guardian={id:8,role:'guardian',active:1,must_change_password:0};
const keys={VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:school@example.ac.th'};
const req=(route,body)=>new Request('https://rd.test'+route,{method:'POST',
 headers:{'content-type':'application/json'},body:JSON.stringify(body)});
function db({linked=true,staffDevice=false,owner=null}={}){
 const calls=[];
 return {calls,prepare(sql){
  const record={sql,args:[]};calls.push(record);
  return {bind(...args){
   record.args=args;
   return {
    async first(){
     if(sql.includes('FROM guardian_student_links WHERE guardian_account_id'))return linked?{ok:1}:null;
     if(sql.includes('FROM staff_push_subscriptions WHERE endpoint'))return staffDevice?{id:3}:null;
     if(sql.includes('FROM guardian_push_subscriptions WHERE endpoint=? AND guardian_account_id=?'))return owner===8?{id:9}:null;
     if(sql.includes('SELECT guardian_account_id FROM guardian_push_subscriptions WHERE endpoint'))return owner?{guardian_account_id:owner}:null;
     if(sql.includes('COUNT(*) AS total'))return {total:0};
     throw Error('Unexpected query: '+sql)
    },async run(){return {meta:{changes:1}}}
   };
  }};
 }};
}
test('truancy is a special period-only state; daily attendance remains unchanged',()=>{
 const ids=new Set([1,2]);
 assert.equal(STATUS.has('truancy'),false);
 assert.equal(PERIOD_STATUS.has('truancy'),true);
 assert.equal(validateEntries([{student_id:1,status:'truancy'},{student_id:2,status:'present'}],ids),false);
 assert.equal(validateEntries([{student_id:1,status:'truancy'},{student_id:2,status:'present'}],ids,100,PERIOD_STATUS),true);
});
test('guardian push requires an active verified portal guardian and explicit link',async()=>{
 await assert.rejects(()=>guardianPushRoutes(req('/api/portal/push/subscribe',subscription),
  {...keys,DB:db()}, {...guardian,role:'student'},'/api/portal/push/subscribe'),{code:403});
 await assert.rejects(()=>guardianPushRoutes(req('/api/portal/push/subscribe',subscription),
  {...keys,DB:db()}, {...guardian,must_change_password:1},'/api/portal/push/subscribe'),{code:403});
 await assert.rejects(()=>guardianPushRoutes(req('/api/portal/push/subscribe',subscription),
  {...keys,DB:db({linked:false})},guardian,'/api/portal/push/subscribe'),{code:403});
 await assert.rejects(()=>guardianPushRoutes(req('/api/portal/push/subscribe',subscription),
  {...keys,DB:db({staffDevice:true})},guardian,'/api/portal/push/subscribe'),{code:409});
 const store=db();
 const reply=await guardianPushRoutes(req('/api/portal/push/subscribe',subscription),
  {...keys,DB:store},guardian,'/api/portal/push/subscribe');
 assert.equal(reply.status,200);
 assert.equal((await reply.json()).subscribed,true);
 const insert=store.calls.find(c=>c.sql.includes('INSERT INTO guardian_push_subscriptions'));
 assert.equal(insert.args[0],guardian.id);
});
test('guardian can unsubscribe only their own endpoint and status does not leak another account',async()=>{
 const store=db();
 const response=await guardianPushRoutes(req('/api/portal/push/unsubscribe',{endpoint:subscription.endpoint}),
  {DB:store},guardian,'/api/portal/push/unsubscribe');
 assert.equal((await response.json()).subscribed,false);
 const deletion=store.calls.find(c=>c.sql.startsWith('DELETE FROM guardian_push_subscriptions'));
 assert.deepEqual(deletion.args,[subscription.endpoint,guardian.id]);
 const status=await guardianPushRoutes(req('/api/portal/push/status',{endpoint:subscription.endpoint}),
  {DB:db({owner:9})},guardian,'/api/portal/push/status');
 assert.equal((await status.json()).subscribed,false);
});
test('dispatcher is disabled without VAPID and does not query private school DB',async()=>{
 const fake=db();
 assert.deepEqual(await deliverTruancyPush({DB:fake}),{enabled:false,processed:0,delivered:0});
 assert.equal(fake.calls.length,0);
});
