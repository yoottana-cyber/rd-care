// Standards-based payload-free Web Push to opted-in STAFF devices.
// Sending no encrypted payload means notifications deliberately reveal no student names,
// classes, absence status or other personal data on a locked phone.
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
 if(path==='/api/push/unsubscribe'&&req.method==='POST'){
  const body=await input(req);
  if(typeof body.endpoint!=='string'||body.endpoint.length>1800)throw err(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  await env.DB.prepare('DELETE FROM staff_push_subscriptions WHERE endpoint=? AND user_id=?')
   .bind(body.endpoint,user.id).run();
  return json({ok:true,subscribed:false});
 }
 throw err(404,'ไม่พบ API แจ้งเตือน');
}
async function deliverOne(env,entry,device,key){
 const authorized=await makeVapidAuthorization(device.endpoint,env);
 const response=await fetch(device.endpoint,{method:'POST',headers:{
  Authorization:authorized,TTL:'300',Urgency:'normal'
 }});
 if(response.ok)return {delivered:true};
 if(response.status===404||response.status===410){
  await env.DB.prepare('DELETE FROM staff_push_subscriptions WHERE id=? AND user_id=?')
   .bind(device.id,entry.recipient_id).run();
  return {expired:true};
 }
 return {failed:true,status:response.status};
}
export async function deliverAdvisorPush(env){
 if(!env.DB||!vapidReady(env))return {processed:0,enabled:false};
 const {results:events}=await env.DB.prepare(`SELECT MIN(o.id) AS outbox_id,c.advisor_user_id AS recipient_id
  FROM notification_outbox o JOIN attendance_alerts a ON a.id=o.alert_id
  JOIN timetable t ON t.id=a.timetable_id JOIN classrooms c ON c.id=t.classroom_id
  JOIN users u ON u.id=c.advisor_user_id AND u.active=1
  WHERE o.state='pending' AND o.audience='advisor' AND o.event_type='attendance_review_requested'
    AND o.created_at>=datetime('now','-1 day') AND a.state='pending_review'
    AND NOT EXISTS(SELECT 1 FROM attendance_daily d
      WHERE d.student_id=a.student_id AND d.school_date=a.school_date AND d.status='absent')
  GROUP BY c.advisor_user_id ORDER BY MIN(o.id) LIMIT 25`).all();
 let delivered=0;
 for(const event of events){
  const {results:devices}=await env.DB.prepare('SELECT id,endpoint FROM staff_push_subscriptions WHERE user_id=? ORDER BY id LIMIT 5')
   .bind(event.recipient_id).all();
  for(const device of devices){
   await env.DB.prepare(`INSERT OR IGNORE INTO staff_push_deliveries(outbox_id,subscription_id,state)
    VALUES(?,?,'pending')`).bind(event.outbox_id,device.id).run();
   const claim=await env.DB.prepare(`UPDATE staff_push_deliveries SET state='sending',updated_at=CURRENT_TIMESTAMP
    WHERE outbox_id=? AND subscription_id=? AND (state='pending'
    OR (state IN ('sending','failed') AND updated_at<datetime('now','-10 minutes')))`)
    .bind(event.outbox_id,device.id).run();
   if(!claim.meta?.changes)continue;
   let result;
   try{result=await deliverOne(env,event,device)}catch(e){
    console.warn('RD Care staff push send failed',String(e?.name||'network'));result={failed:true};
   }
   if(!result.expired){
    await env.DB.prepare(`UPDATE staff_push_deliveries SET state=?,updated_at=CURRENT_TIMESTAMP
      WHERE outbox_id=? AND subscription_id=?`)
      .bind(result.delivered?'delivered':'failed',event.outbox_id,device.id).run();
   }
   if(result.delivered)delivered++;
  }
  // One generic alert per advisor covers all pending review tasks in this batch.
  await env.DB.prepare(`UPDATE notification_outbox SET state='delivered',updated_at=CURRENT_TIMESTAMP
    WHERE state='pending' AND audience='advisor' AND event_type='attendance_review_requested'
      AND alert_id IN (
        SELECT a.id FROM attendance_alerts a JOIN timetable t ON t.id=a.timetable_id
        JOIN classrooms c ON c.id=t.classroom_id
        WHERE c.advisor_user_id=? AND a.state='pending_review'
          AND NOT EXISTS(SELECT 1 FROM attendance_daily d
            WHERE d.student_id=a.student_id AND d.school_date=a.school_date AND d.status='absent')
      ) AND EXISTS(SELECT 1 FROM staff_push_deliveries
        WHERE outbox_id=? AND state='delivered')`).bind(event.recipient_id,event.outbox_id).run();
 }
 return {processed:events.length,delivered,enabled:true};
}
