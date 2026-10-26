import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createECDH,randomBytes} from 'node:crypto';
import {encryptPriorityPush} from '../worker/src/web-push-crypto.js';
import {sendPriorityPush} from '../worker/src/staff-push.js';

const b64=data=>Buffer.from(data).toString('base64url');
async function setup(){
 globalThis.crypto??=webcrypto;
 const browserKeys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const publicKey=new Uint8Array(await crypto.subtle.exportKey('raw',browserKeys.publicKey));
 const auth=randomBytes(16);
 return {
  browserKeys,auth,publicKey,
  subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/endpoint-12345',
   p256dh:b64(publicKey),auth:b64(auth)}
 };
}
async function deriveHkdf(secret,salt,info,bits){
 const key=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,bits));
}
async function decodeBrowserPayload(bytes,{browserKeys,auth,publicKey}){
 const header=new Uint8Array(bytes);
 const salt=header.slice(0,16);
 const rs=new DataView(header.buffer,header.byteOffset).getUint32(16,false);
 assert.equal(rs,4096);
 assert.equal(header[20],65);
 const ephemeral=await crypto.subtle.importKey('raw',header.slice(21,86),{
  name:'ECDH',namedCurve:'P-256'
 },false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:ephemeral},browserKeys.privateKey,256);
 const info=new Uint8Array([...new TextEncoder().encode('WebPush: info'),0,
  ...publicKey,...header.slice(21,86)]);
 const ikm=await deriveHkdf(shared,auth,info,256);
 const cek=await deriveHkdf(ikm,salt,new TextEncoder().encode('Content-Encoding: aes128gcm\x00'),128);
 const nonce=await deriveHkdf(ikm,salt,new TextEncoder().encode('Content-Encoding: nonce\x00'),96);
 const key=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['decrypt']);
 const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,tagLength:128},key,header.slice(86)));
 assert.equal(plain.at(-1),2);
 return JSON.parse(new TextDecoder().decode(plain.slice(0,-1)));
}
test('browser can decrypt priority Web Push with RFC 8291 aes128gcm and no personal details',async()=>{
 const sub=await setup();
 const payload={kind:'urgent_review',audience:'guardian'};
 const body=await encryptPriorityPush(sub.subscription,payload);
 assert.deepEqual(await decodeBrowserPayload(body,sub),payload);
 assert.equal(body.length>85,true);
 assert.equal(Buffer.from(body).includes(Buffer.from('urgent_review')),false);
});
test('encrypted alerts have unique randomness, separated priority and generic data',async()=>{
 const sub=await setup();
 const a=await encryptPriorityPush(sub.subscription,{kind:'urgent_review',audience:'advisor'});
 const b=await encryptPriorityPush(sub.subscription,{kind:'urgent_review',audience:'advisor'});
 assert.notDeepEqual(Buffer.from(a),Buffer.from(b));
 assert.deepEqual(await decodeBrowserPayload(a,sub),{kind:'urgent_review',audience:'advisor'});
});
test('outbound priority push has high urgency, longer TTL and encrypted body',async()=>{
 const sub=await setup();
 const origFetch=globalThis.fetch;
 const vapid=createECDH('prime256v1');vapid.generateKeys();
 const env={VAPID_PUBLIC_KEY:b64(vapid.getPublicKey()),
  VAPID_PRIVATE_KEY:b64(Buffer.from(vapid.getPrivateKey().toString('hex').padStart(64,'0'),'hex')),
  VAPID_SUBJECT:'mailto:school@example.ac.th'};
 let sent;
 globalThis.fetch=async (url,opts)=>{sent={url,opts};return {status:201,ok:true}};
 try{
  const reply=await sendPriorityPush(sub.subscription,env,'advisor');
  assert.equal(reply.ok,true);
  assert.equal(sent.opts.headers.Urgency,'high');
  assert.equal(sent.opts.headers.TTL,'3600');
  assert.equal(sent.opts.headers['Content-Encoding'],'aes128gcm');
  assert.match(sent.opts.headers.Authorization,/^vapid t=/);
  assert.deepEqual(await decodeBrowserPayload(sent.opts.body,sub),{kind:'urgent_review',audience:'advisor'});
 }finally{globalThis.fetch=origFetch}
});
test('priority sender refuses arbitrary destinations and audience injection',async()=>{
 const sub=await setup();
 await assert.rejects(()=>encryptPriorityPush({...sub.subscription,p256dh:'invalid'},{}));
 await assert.rejects(()=>sendPriorityPush({...sub.subscription,endpoint:'https://example.com/push'}, {},'guardian'),/not permitted/);
 await assert.rejects(()=>sendPriorityPush(sub.subscription,{},'student'),/Invalid push audience/);
});
