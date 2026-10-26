import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,webcrypto,randomBytes} from 'node:crypto';
import {diagnoseVapid,staffPushRoutes} from '../worker/src/staff-push.js';
import {guardianPushRoutes} from '../worker/src/truancy-push.js';

globalThis.crypto??=webcrypto;
const key=()=>{
 const e=createECDH('prime256v1');e.generateKeys();
 return {VAPID_PUBLIC_KEY:e.getPublicKey(null,'uncompressed').toString('base64url'),
  VAPID_PRIVATE_KEY:Buffer.from(e.getPrivateKey().toString('hex').padStart(64,'0'),'hex').toString('base64url'),
  VAPID_SUBJECT:'mailto:help@school.example.ac.th'};
};
const req=(path,body)=>new Request('https://rd-care.local'+path,{
 method:'POST',body:JSON.stringify(body||{})});
const staff={id:3,username:'advisor',role:'teacher',active:1};
const guardian={id:5,username:'parent',role:'guardian',active:1,must_change_password:0};
const db=()=>({
 prepare(sql){return {bind(...args){return {
  async first(){
   if(sql.includes('FROM staff_push_subscriptions WHERE user_id=? AND endpoint=?'))return null;
   if(sql.includes('FROM guardian_student_links WHERE guardian_account_id=?'))return {ok:1};
   if(sql.includes('FROM guardian_push_subscriptions')&&sql.includes('endpoint=?'))return null;
   if(sql.includes('COUNT(*) AS total'))return {total:0};
   if(sql.includes('JOIN staff_push_subscriptions'))return null;
   throw Error('unexpected db query '+sql);
  },async all(){return {results:[]}}
 }}}}
});
test('admin diagnostic identifies missing VAPID_SUBJECT without leaking secrets',async()=>{
 const cfg=key();
 delete cfg.VAPID_SUBJECT;
 const r=await diagnoseVapid(cfg);
 assert.equal(r.ready,false);
 assert.equal(r.code,'missing_settings');
 assert.deepEqual(r.missing,['VAPID_SUBJECT']);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_KEY=.*|PUBLIC_KEY=.*/);
});
test('well-formed matching VAPID pair passes cryptographic signing/verification',async()=>{
 const valid=await diagnoseVapid(key());
 assert.deepEqual(valid,{ready:true,code:'ready',missing:[]});
});
test('public and private keys from different generations cannot pass diagnostics',async()=>{
 const a=key(),b=key();
 a.VAPID_PRIVATE_KEY=b.VAPID_PRIVATE_KEY;
 const diagnostic=await diagnoseVapid(a);
 assert.equal(diagnostic.ready,false);
 assert.ok(['keypair_mismatch','invalid_keypair'].includes(diagnostic.code));
});
test('VAPID contact must be a legitimate mailto or https URI',async()=>{
 assert.equal((await diagnoseVapid({...key(),VAPID_SUBJECT:'missing-at-mark'})).code,'invalid_subject');
 assert.equal((await diagnoseVapid({...key(),VAPID_SUBJECT:'mailto:not an email'})).code,'invalid_subject');
});
test('staff push self-test refuses devices unregistered to the signed-in staff account',async()=>{
 const env={...key(),DB:db()};
 const response=await staffPushRoutes(req('/api/push/test',{endpoint:'https://fcm.googleapis.com/fcm/send/example'}),env,staff,'/api/push/test');
 assert.deepEqual(await response.json(),{accepted:false,code:'device_not_registered'});
});
test('guardian push self-test refuses devices unregistered to the signed-in guardian account',async()=>{
 const env={...key(),DB:db()};
 const response=await guardianPushRoutes(req('/api/portal/push/test',{endpoint:'https://fcm.googleapis.com/fcm/send/example'}),env,guardian,'/api/portal/push/test');
 assert.deepEqual(await response.json(),{accepted:false,code:'device_not_registered'});
});
