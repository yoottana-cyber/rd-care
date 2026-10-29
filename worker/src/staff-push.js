// Encrypted Web Push: event topics, dates and lesson/arrival times only.
// Names, student IDs and reasons are never sent to the device lock screen.
const err=(code,message)=>{throw Object.assign(new Error(message),{code})};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const enc=new TextEncoder();
const fromB64=value=>{
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const toB64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const vapidReady=env=>Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
function allowedEndpoint(endpoint){
 try{
  const u=new URL(endpoint);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search.length>600)return false;
  const h=u.hostname.toLowerCase();
  return h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||
   h==='web.push.apple.com'||h.endsWith('.push.apple.com')||
   h.endsWith('.notify.windows.com')||h.endsWith('.push.services.mozilla.com');
 }catch{return false}
}
export function validPushSubscription(body){
 const endpoint=body?.endpoint,p256dh=body?.keys?.p256dh,auth=body?.keys?.auth;
 if(typeof endpoint!=='string'||endpoint.length<30||endpoint.length>1800||!allowedEndpoint(endpoint))return false;
 if(typeof p256dh!=='string'||typeof auth!=='string'||
  !/^[\w-]{85,90}$/.test(p256dh)||!/^[\w-]{20,27}$/.test(auth))return false;
 try{return fromB64(p256dh).length===65&&fromB64(p256dh)[0]===4&&fromB64(auth).length===16}
 catch{return false}
}
async function input(req){
 const raw=await req.text();
 if(raw.length>6500)throw err(413,'ข้อมูลอุปกรณ์มีขนาดใหญ่เกินไป');
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}
 catch{throw err(400,'ข้อมูลสมัครแจ้งเตือนไม่ถูกต้อง')}
}
async function signer(env){
 const pub=fromB64(env.VAPID_PUBLIC_KEY),priv=fromB64(env.VAPID_PRIVATE_KEY);
 if(pub.length!==65||pub[0]!==4||priv.length!==32)throw Error('VAPID key pair invalid');
 return crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:toB64(pub.slice(1,33)),
   y:toB64(pub.slice(33,65)),d:toB64(priv),ext:false,key_ops:['sign']},
   {name:'ECDSA',namedCurve:'P-256'},false,['sign']);
}
// Checks private/public key correspondence without returning key material.
// Secrets may be present but invalid or copied from different VAPID keypairs.
export async function diagnoseVapid(env){
 const required=['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
 const missing=required.filter(name=>!String(env[name]||'').trim());
 if(missing.length)return {ready:false,code:'missing_settings',missing};
 if(!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(env.VAPID_SUBJECT))
  return {ready:false,code:'invalid_subject',missing:[]};
 try{
  const pub=fromB64(env.VAPID_PUBLIC_KEY);
  if(pub.length!==65||pub[0]!==4)return {ready:false,code:'invalid_keypair',missing:[]};
  const privateKey=await signer(env);
  const publicKey=await crypto.subtle.importKey('raw',pub,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const message=enc.encode('rd-care-vapid-self-check');
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,message);
  const matched=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,sig,message);
  return {ready:matched,code:matched?'ready':'keypair_mismatch',missing:[]};
 }catch{
  return {ready:false,code:'invalid_keypair',missing:[]};
 }
}
export async function makeVapidAuthorization(endpoint,env){
 if(!vapidReady(env))throw Error('VAPID configuration missing');
 const audience=new URL(endpoint).origin;
 const jwtHeader=toB64(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
 const jwtClaims=toB64(enc.encode(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+3600,sub:env.VAPID_SUBJECT})));
 const message=jwtHeader+'.'+jwtClaims;
 const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},await signer(env),enc.encode(message)));
 return 'vapid t='+message+'.'+toB64(signature)+', k='+env.VAPID_PUBLIC_KEY;
}
export async function staffPushRoutes(req,env,user,path){
 if(!['teacher','staff','admin'].includes(user.role))throw err(403,'ไม่มีสิทธิ์ใช้งานการแจ้งเตือนครู');
 if(path==='/api/push/config'&&req.method==='GET')
  return json({enabled:vapidReady(env),publicKey:vapidReady(env)?env.VAPID_PUBLIC_KEY:null,scope:'staff_only'});
 if(path==='/api/push/subscribe'&&req.method==='POST'){
  if(!vapidReady(env))throw err(503,'ยังไม่เปิดตั้งค่าระบบ Push บนเซิร์ฟเวอร์');
  const subscription=await input(req);
  if(!validPushSubscription(subscription))throw err(400,'ข้อมูลอุปกรณ์แจ้งเตือนไม่ถูกต้อง');
  const current=await env.DB.prepare('SELECT id,user_id FROM staff_push_subscriptions WHERE endpoint=?')
   .bind(subscription.endpoint).first();
  if(current&&current.user_id!==user.id)throw err(409,'อุปกรณ์นี้ผูกกับบัญชีอื่น กรุณาออกจากระบบเดิมและปิดแจ้งเตือนก่อน');
  const portalOther=await env.DB.prepare('SELECT id FROM student_push_subscriptions WHERE endpoint=?').bind(subscription.endpoint).first();
  if(portalOther)throw err(409,'อุปกรณ์นี้สมัครแจ้งเตือนด้วยบัญชีนักเรียนอยู่ กรุณาปิด Push เดิมก่อน');
  if(!current){
   const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM staff_push_subscriptions WHERE user_id=?').bind(user.id).first();
   if(Number(count?.total||0)>=5)throw err(429,'สมัครรับแจ้งเตือนได้สูงสุด 5 อุปกรณ์ต่อบัญชี');
  }
  await env.DB.prepare(`INSERT INTO staff_push_subscriptions(user_id,endpoint,p256dh,auth)
   VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
    updated_at=CURRENT_TIMESTAMP WHERE staff_push_subscriptions.user_id=excluded.user_id`)
    .bind(user.id,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth).run();
  return json({ok:true,subscribed:true});
 }
 if(path==='/api/push/diagnostics'&&req.method==='GET'){
  const config=await diagnoseVapid(env);
  const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM staff_push_subscriptions WHERE user_id=?')
   .bind(user.id).first();
  const recent=await env.DB.prepare(`SELECT d.state,d.attempts,d.last_http_status
    FROM truancy_push_deliveries d
    JOIN staff_push_subscriptions s ON s.id=d.subscription_id
    WHERE d.recipient_type='advisor' AND s.user_id=?
    ORDER BY d.updated_at DESC LIMIT 1`).bind(user.id).first();
  return json({vapid:config,registeredDevices:Number(count?.total||0),
   recent:recent?{state:recent.state,attempts:recent.attempts,
    providerStatus:recent.last_http_status}:null});
 }
 if(path==='/api/push/test'&&req.method==='POST'){
  const b=await input(req);
  if(typeof b.endpoint!=='string'||b.endpoint.length>1800)throw err(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  const config=await diagnoseVapid(env);
  if(!config.ready)return json({accepted:false,code:config.code,missing:config.missing});
  const device=await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM staff_push_subscriptions WHERE user_id=? AND endpoint=?')
   .bind(user.id,b.endpoint).first();
  if(!device)return json({accepted:false,code:'device_not_registered'});
  try{
   const result=await sendPushTest(device,env,'advisor');
   if(result.status===404||result.status===410)
    await env.DB.prepare('DELETE FROM staff_push_subscriptions WHERE id=? AND user_id=?')
     .bind(device.id,user.id).run();
   return json({accepted:result.ok,code:result.ok?'accepted':'provider_rejected',providerStatus:result.status});
  }catch(e){
   console.warn('RD CONNECT staff push self-test failed',e?.name||'network');
   return json({accepted:false,code:'network_or_crypto_error'});
  }
 }
 if(path==='/api/push/unsubscribe'&&req.method==='POST'){
  const body=await input(req);
  if(typeof body.endpoint!=='string'||body.endpoint.length>1800)throw err(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  await env.DB.prepare('DELETE FROM staff_push_subscriptions WHERE endpoint=? AND user_id=?')
   .bind(body.endpoint,user.id).run();
  return json({ok:true,subscribed:false});
 }
 throw err(404,'ไม่พบ API แจ้งเตือน');
}
import {encryptPriorityPush} from './web-push-crypto.js';
// Explicit whitelist blocks student identity and reason from entering Web Push.
export function safePushEventInfo(info,kind){
 const eventId=Number(info?.eventId);
 if(!Number.isSafeInteger(eventId)||eventId<1)return {};
 const data={eventId};
 if(/^\d{4}-\d{2}-\d{2}$/.test(String(info?.date||'')))data.date=info.date;
 if(kind==='truancy'){
  const period=Number(info?.period);
  if(Number.isInteger(period)&&period>0&&period<=12)data.period=period;
  if(typeof info?.subject==='string')data.subject=info.subject.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,55);
 }else if(kind==='late'&&/^\d{2}:\d{2}$/.test(String(info?.arrival||''))){
  data.arrival=info.arrival;
 }
 return data;
}

// Distinct encrypted category for an urgent review; no student/room/incident
// details are transmitted in notification payload or device lock screen.
export async function sendPriorityPush(device,env,audience,eventInfo={}){
 if(!allowedEndpoint(device.endpoint))throw Error('Push endpoint not permitted');
 if(audience!=='advisor'&&audience!=='guardian')throw Error('Invalid push audience');
 const body=await encryptPriorityPush(device,{kind:'urgent_review',audience,...safePushEventInfo(eventInfo,'truancy')});
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 return fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'3600',Urgency:'high',
  'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'
 },body,signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
}
// Category-only encrypted push for late arrivals. No child names, classroom,
// or attendance identifiers are ever included in the notification payload.
export async function sendLateArrivalPush(device,env,audience,eventInfo={}){
 if(!allowedEndpoint(device.endpoint))throw Error('Push endpoint not permitted');
 if(audience!=='advisor'&&audience!=='guardian')throw Error('Invalid push audience');
 const body=await encryptPriorityPush(device,{kind:'late_arrival',audience,...safePushEventInfo(eventInfo,'late')});
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 return fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'3600',Urgency:'normal',
  'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'
 },body,signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
}
// Notify a class advisor to complete daily check-in. Contains no student names,
// missing counts or personal data; classroom authorization is checked after login.
export async function sendDailyAttendanceReminderPush(device,env,{classroomId,date}){
 if(!allowedEndpoint(device.endpoint))throw Error('Push endpoint not permitted');
 const room=Number(classroomId);
 if(!Number.isSafeInteger(room)||room<1||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))
  throw Error('Invalid daily reminder metadata');
 const body=await encryptPriorityPush(device,{kind:'daily_attendance_reminder',audience:'advisor',
  classroomId:room,date});
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 return fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'3600',Urgency:'normal',
  'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'
 },body,signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
}
// No student identity is included in either category or test notifications.
export async function sendAttendanceReviewPush(device,env,eventInfo){
 if(!allowedEndpoint(device.endpoint))throw Error('Push endpoint not permitted');
 const body=await encryptPriorityPush(device,{kind:'attendance_review',audience:'advisor',...safePushEventInfo(eventInfo,'truancy')});
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 return fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'1200',Urgency:'normal',
  'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'
 },body,signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
}
export async function sendPushTest(device,env,audience){
 if(!allowedEndpoint(device.endpoint))throw Error('Push endpoint not permitted');
 if(!['advisor','guardian','student'].includes(audience))throw Error('Invalid push audience');
 const body=await encryptPriorityPush(device,{kind:'push_test',audience});
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 return fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'300',Urgency:'normal',
  'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'
 },body,signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
}
// Generic private student notice. No incident type or student identity appears
// in the Push payload or lock-screen text; the incident lookup is authorized.
export async function sendStudentAttendancePush(device,env,{kind,eventId}){
 if(!allowedEndpoint(device.endpoint))throw Error('Push endpoint not permitted');
 if(!['late','truancy'].includes(kind)||!Number.isSafeInteger(eventId)||eventId<1)
  throw Error('Invalid student attendance notification');
 const body=await encryptPriorityPush(device,{kind:'pupil_notice',audience:'student',noticeKind:kind,eventId});
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 return fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'1200',Urgency:'normal',
  'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'
 },body,signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(8000):undefined});
}
// Legacy payload-free push for older administrative notices.
export async function sendGenericPush(endpoint,env){
 if(!allowedEndpoint(endpoint))throw Error('Push endpoint not permitted');
 const authorized=await makeVapidAuthorization(endpoint,env);
 return fetch(endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'300',Urgency:'high'
 }});
}
async function deliverOne(env,entry,device,eventInfo){
 const response=await sendAttendanceReviewPush(device,env,eventInfo);
 if(response.ok)return {delivered:true};
 if(response.status===404||response.status===410){
  await env.DB.prepare('DELETE FROM staff_push_subscriptions WHERE id=? AND user_id=?')
   .bind(device.id,device.user_id).run();
  return {expired:true};
 }
 return {failed:true,status:response.status};
}
export async function deliverAdvisorPush(env){
 if(!env.DB||!vapidReady(env))return {processed:0,enabled:false};
 const {results:events}=await env.DB.prepare(`SELECT o.id AS outbox_id,c.advisor_user_id,c.advisor2_user_id
  FROM notification_outbox o JOIN attendance_alerts a ON a.id=o.alert_id
  JOIN timetable t ON t.id=a.timetable_id JOIN classrooms c ON c.id=t.classroom_id
  WHERE (c.advisor_user_id IS NOT NULL OR c.advisor2_user_id IS NOT NULL)
   AND o.state='pending' AND o.audience='advisor' AND o.event_type='attendance_review_requested'
    AND o.created_at>=datetime('now','-1 day') AND a.state='pending_review'
    AND NOT EXISTS(SELECT 1 FROM attendance_daily d
      WHERE d.student_id=a.student_id AND d.school_date=a.school_date AND d.status='absent')
  ORDER BY o.id LIMIT 25`).all();
 let delivered=0;
 for(const event of events){
  const detail=await env.DB.prepare(`SELECT a.id AS eventId,a.school_date AS date,t.period,t.subject
   FROM notification_outbox o JOIN attendance_alerts a ON a.id=o.alert_id
   JOIN timetable t ON t.id=a.timetable_id
   WHERE o.id=? AND o.state='pending' AND a.state='pending_review'`).bind(event.outbox_id).first();
  if(!detail)continue;
  const {results:devices}=await env.DB.prepare('SELECT p.id,p.user_id,p.endpoint,p.p256dh,p.auth FROM staff_push_subscriptions p JOIN users u ON u.id=p.user_id AND u.active=1 WHERE p.user_id IN (?,?) ORDER BY p.id LIMIT 10')
   .bind(event.advisor_user_id||0,event.advisor2_user_id||0).all();
  for(const device of devices){
   await env.DB.prepare(`INSERT OR IGNORE INTO staff_push_deliveries(outbox_id,subscription_id,state)
    VALUES(?,?,'pending')`).bind(event.outbox_id,device.id).run();
   const claim=await env.DB.prepare(`UPDATE staff_push_deliveries SET state='sending',updated_at=CURRENT_TIMESTAMP
    WHERE outbox_id=? AND subscription_id=? AND (state='pending'
    OR (state IN ('sending','failed') AND updated_at<datetime('now','-10 minutes')))`)
    .bind(event.outbox_id,device.id).run();
   if(!claim.meta?.changes)continue;
   let result;
   try{result=await deliverOne(env,event,device,detail)}catch(e){
    console.warn('RD CONNECT staff push send failed',String(e?.name||'network'));result={failed:true};
   }
   if(!result.expired){
    await env.DB.prepare(`UPDATE staff_push_deliveries SET state=?,updated_at=CURRENT_TIMESTAMP
      WHERE outbox_id=? AND subscription_id=?`)
      .bind(result.delivered?'delivered':'failed',event.outbox_id,device.id).run();
   }
   if(result.delivered)delivered++;
  }
  // Each event is an individual notification with its own link and delivery ledger.
  await env.DB.prepare(`UPDATE notification_outbox SET state='delivered',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND state='pending' AND audience='advisor'
      AND EXISTS(SELECT 1 FROM staff_push_deliveries
        WHERE outbox_id=? AND state='delivered')`).bind(event.outbox_id,event.outbox_id).run();
 }
 return {processed:events.length,delivered,enabled:true};
}
