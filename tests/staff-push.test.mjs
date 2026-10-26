import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes,webcrypto} from 'node:crypto';
import {validPushSubscription,makeVapidAuthorization,staffPushRoutes,deliverAdvisorPush} from '../worker/src/staff-push.js';
const key=createECDH('prime256v1');key.generateKeys();
const b64=buffer=>Buffer.from(buffer).toString('base64url');
const keys={p256dh:b64(key.getPublicKey()),auth:b64(randomBytes(16))};
const endpoint='https://fcm.googleapis.com/fcm/send/'+b64(randomBytes(30));
const subscription={endpoint,keys};
test('push accepts browser delivery endpoints and rejects SSRF and malformed keys',()=>{
 assert.equal(validPushSubscription(subscription),true);
 for(const u of [
  'http://fcm.googleapis.com/fcm/send/abc','https://localhost/path',
  'https://fcm.googleapis.com.evil.test/push',
  'https://127.0.0.1/push','https://evil.push.apple.com.evil.com/endpoint'
 ]){
  assert.equal(validPushSubscription({...subscription,endpoint:u}),false,u);
 }
 assert.equal(validPushSubscription({...subscription,keys:{...keys,p256dh:'abc'}}),false);
});
test('VAPID JWT uses the endpoint origin and signs using P-256',async()=>{
 globalThis.crypto ??= webcrypto;
 const pair=createECDH('prime256v1');pair.generateKeys();
 const env={VAPID_PUBLIC_KEY:b64(pair.getPublicKey()),
 VAPID_PRIVATE_KEY:b64(pair.getPrivateKey()),
 VAPID_SUBJECT:'mailto:it@example.edu'};
 const authorization=await makeVapidAuthorization(endpoint,env);
 assert.match(authorization,/^vapid t=[A-Za-z0-9._-]+, k=[\w-]+$/);
 const token=authorization.split(' t=')[1].split(', k=')[0];
 const [header,claims,signature]=token.split('.');
 const payload=JSON.parse(Buffer.from(claims,'base64url').toString('utf8'));
 assert.equal(payload.aud,'https://fcm.googleapis.com');
 assert.equal(payload.sub,env.VAPID_SUBJECT);
 assert.equal(JSON.parse(Buffer.from(header,'base64url').toString('utf8')).alg,'ES256');
 const pub=await webcrypto.subtle.importKey('raw',pair.getPublicKey(),
 {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 assert.equal(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,
 Buffer.from(signature,'base64url'),Buffer.from(header+'.'+claims)),true);
});
function fakeDb({existing=null,count=0}={}){
 const calls=[];
 return {calls,prepare(sql){
  const entry={sql,values:[]};calls.push(entry);
  return {bind(...args){entry.values=args;return {
   first:async()=>sql.includes('COUNT(*)')?{total:count}:existing,
   run:async()=>({meta:{changes:1}})
  }}};
 }};
}
const req=(path,body)=>new Request('https://rd.local'+path,{method:'POST',
 body:JSON.stringify(body),headers:{'content-type':'application/json'}});
test('opt-in requires server keys and binds devices to authenticated users',async()=>{
 const env={DB:fakeDb(),VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:it@example.edu'};
 const out=await staffPushRoutes(req('/api/push/subscribe',subscription),env,{id:7,role:'teacher'},'/api/push/subscribe');
 assert.equal(out.status,200);
 const insert=env.DB.calls.find(x=>x.sql.includes('INSERT INTO staff_push_subscriptions'));
 assert.equal(insert.values[0],7);
 assert.equal(insert.values[1],endpoint);
 await assert.rejects(()=>staffPushRoutes(req('/api/push/subscribe',subscription),
 {...env,DB:fakeDb({existing:{id:1,user_id:13}})},
 {id:7,role:'teacher'},'/api/push/subscribe'),{code:409});
 await assert.rejects(()=>staffPushRoutes(req('/api/push/subscribe',subscription),{DB:fakeDb()},
 {id:7,role:'teacher'},'/api/push/subscribe'),{code:503});
});
test('unsubscribing only deletes the current user’s endpoint',async()=>{
 const db=fakeDb();
 const result=await staffPushRoutes(req('/api/push/unsubscribe',{endpoint}),{DB:db},{id:9,role:'teacher'},'/api/push/unsubscribe');
 assert.equal((await result.json()).subscribed,false);
 const del=db.calls.find(x=>x.sql.startsWith('DELETE FROM staff_push_subscriptions'));
 assert.deepEqual(del.values,[endpoint,9]);
});
test('Push dispatcher remains disabled when VAPID is not configured',async()=>{
 const env={DB:fakeDb()};
 assert.deepEqual(await deliverAdvisorPush(env),{processed:0,enabled:false});
 assert.equal(env.DB.calls.length,0);
});
