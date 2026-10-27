import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,createECDH,randomBytes} from 'node:crypto';
import {sendLateArrivalPush} from '../worker/src/staff-push.js';

globalThis.crypto??=webcrypto;
const b64=x=>Buffer.from(x).toString('base64url');
const content=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('late QR Push has distinct encrypted category, opt-in audiences and correct headers',async()=>{
 const vapid=createECDH('prime256v1');vapid.generateKeys();
 const client=createECDH('prime256v1');client.generateKeys();
 const env={VAPID_PUBLIC_KEY:b64(vapid.getPublicKey(null,'uncompressed')),
  VAPID_PRIVATE_KEY:b64(vapid.getPrivateKey()),
  VAPID_SUBJECT:'mailto:school@example.ac.th'};
 const device={endpoint:'https://fcm.googleapis.com/fcm/send/mock1234567890',
  p256dh:b64(client.getPublicKey(null,'uncompressed')),auth:b64(randomBytes(16))};
 const original=globalThis.fetch;let saved=null;
 globalThis.fetch=async (url,options)=>{saved={url,options};return {ok:true,status:201}};
 try{
  const accepted=await sendLateArrivalPush(device,env,'guardian');
  assert.equal(accepted.ok,true);
  assert.equal(saved.url,device.endpoint);
  assert.equal(saved.options.headers['Content-Encoding'],'aes128gcm');
  assert.equal(saved.options.headers.Urgency,'normal');
  assert.match(saved.options.headers.Authorization,/^vapid t=/);
  assert.ok(saved.options.body instanceof Uint8Array);
  assert.doesNotMatch(Buffer.from(saved.options.body).toString(),/student_no|full_name|late_arrival/);
 }finally{globalThis.fetch=original}
});
test('late QR notifications never send to an unauthorized audience or endpoint',async()=>{
 const device={endpoint:'https://evil.example.test/route'};
 await assert.rejects(()=>sendLateArrivalPush(device,{},'advisor'),/not permitted/);
 await assert.rejects(()=>sendLateArrivalPush({endpoint:'https://fcm.googleapis.com/fcm/send/mock'}, {},'student'),/Invalid push audience/);
});
test('student scan dispatches verified late event without waiting on Push',()=>{
 const portal=content('worker/src/portal.js'),late=content('worker/src/late-qr.js');
 const auto=content('worker/src/late-qr-auto.js'),cron=content('worker/src/worker.js');
 const push=content('worker/src/late-qr-push.js');
 assert.match(portal,/ctx\?\.waitUntil/);
 assert.match(portal,/deliverLateQrPush\(env\)/);
 assert.match(cron,/deliverLateQrPush\(env\)/);
 assert.match(late,/autoApproveLateQr\(env/);
 assert.match(auto,/INSERT INTO attendance_daily/);
 assert.match(auto,/DO UPDATE SET status='late'/);
 assert.match(auto,/previous_daily_status/);
 assert.match(auto,/late_qr_auto_approved/);
 assert.match(push,/JOIN guardian_student_links/);
 assert.match(push,/c\.advisor_user_id/);
 assert.match(push,/attempts<3/);
 assert.match(push,/e\.active=1/);
});
test('only approved QR check-ins have an authorized delete path and privacy-safe SW alert',()=>{
 const late=content('worker/src/late-qr.js'),sw=content('web/sw.js'),ui=content('web/late-gate.js');
 assert.match(late,/revokeAutoLateQr\(env,user/);
 assert.match(late,/can_delete/);
 assert.match(ui,/data-qr-delete/);
 assert.match(sw,/late_arrival/);
 assert.match(sw,/rd-care-late-arrival/);
 assert.match(sw,/\?tab=lateGate/);
 assert.doesNotMatch(sw,/full_name|student_no/);
});
