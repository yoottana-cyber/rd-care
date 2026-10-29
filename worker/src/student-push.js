// Independent opt-in Web Push for student accounts: no guardian or staff data access.
// Dispatches only verified late QR records and active period truancy events.
import {validPushSubscription,sendPushTest,sendStudentAttendancePush,diagnoseVapid} from './staff-push.js';
import {notificationEnabled} from './notification-policy.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const ready=env=>Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
async function read(req){
 const raw=await req.text();
 if(raw.length>6500)fail(413,'ข้อมูลอุปกรณ์ใหญ่เกินไป');
 let value;try{value=JSON.parse(raw)}catch{fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง')}
 if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
 return value;
}
function allowed(account){
 if(account.role!=='student'||!account.active||!account.student_id||account.must_change_password)
  fail(403,'เฉพาะบัญชีนักเรียนที่เปิดใช้งานแล้ว');
}
export async function studentPushRoutes(req,env,account,path){
 allowed(account);
 if(path==='/api/portal/student-push/config'&&req.method==='GET')
  return reply({enabled:ready(env),publicKey:ready(env)?env.VAPID_PUBLIC_KEY:null});
 if(path==='/api/portal/student-push/subscribe'&&req.method==='POST'){
  if(!ready(env))fail(503,'ระบบ Push ยังไม่พร้อมให้บริการ');
  const sub=await read(req);
  if(!validPushSubscription(sub))fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  // Push subscriptions belong to a service-worker registration; never steal an
  // endpoint from a guardian, staff member, or a different student.
  const [staff,guardian,current]=await Promise.all([
   env.DB.prepare('SELECT id FROM staff_push_subscriptions WHERE endpoint=?').bind(sub.endpoint).first(),
   env.DB.prepare('SELECT id FROM guardian_push_subscriptions WHERE endpoint=?').bind(sub.endpoint).first(),
   env.DB.prepare('SELECT student_account_id FROM student_push_subscriptions WHERE endpoint=?').bind(sub.endpoint).first()
  ]);
  if(staff||guardian||current&&current.student_account_id!==account.id)
   fail(409,'อุปกรณ์นี้ผูกกับบัญชีอื่น กรุณาปิด Push ของบัญชีเดิมก่อน');
  if(!current){
   const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM student_push_subscriptions WHERE student_account_id=?')
    .bind(account.id).first();
   if(Number(count?.total||0)>=5)fail(429,'สมัครรับแจ้งเตือนได้ไม่เกิน 5 อุปกรณ์');
  }
  await env.DB.prepare(`INSERT INTO student_push_subscriptions(student_account_id,endpoint,p256dh,auth)
   VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth
   WHERE student_push_subscriptions.student_account_id=excluded.student_account_id`)
   .bind(account.id,sub.endpoint,sub.keys.p256dh,sub.keys.auth).run();
  return reply({ok:true,subscribed:true});
 }
 if(path==='/api/portal/student-push/status'&&req.method==='POST'){
  const body=await read(req);
  if(typeof body.endpoint!=='string'||body.endpoint.length>1800)fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  const found=await env.DB.prepare('SELECT id FROM student_push_subscriptions WHERE endpoint=? AND student_account_id=?')
   .bind(body.endpoint,account.id).first();
  return reply({subscribed:!!found});
 }
 if(path==='/api/portal/student-push/unsubscribe'&&req.method==='POST'){
  const body=await read(req);
  if(typeof body.endpoint!=='string'||body.endpoint.length>1800)fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  await env.DB.prepare('DELETE FROM student_push_subscriptions WHERE endpoint=? AND student_account_id=?')
   .bind(body.endpoint,account.id).run();
  return reply({ok:true,subscribed:false});
 }
 if(path==='/api/portal/student-push/test'&&req.method==='POST'){
  const body=await read(req);
  if(typeof body.endpoint!=='string'||body.endpoint.length>1800)fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  const diagnostic=await diagnoseVapid(env);
  if(!diagnostic.ready)return reply({accepted:false,code:diagnostic.code,missing:diagnostic.missing});
  const device=await env.DB.prepare(`SELECT id,endpoint,p256dh,auth FROM student_push_subscriptions
    WHERE student_account_id=? AND endpoint=?`).bind(account.id,body.endpoint).first();
  if(!device)return reply({accepted:false,code:'device_not_registered'});
  try{
   const response=await sendPushTest(device,env,'student');
   if(response.status===404||response.status===410)
    await env.DB.prepare('DELETE FROM student_push_subscriptions WHERE id=? AND student_account_id=?')
     .bind(device.id,account.id).run();
   return reply({accepted:response.ok,code:response.ok?'accepted':'provider_rejected',providerStatus:response.status});
  }catch(err){
   console.warn('RD student Push test failed',err?.name||'network');
   return reply({accepted:false,code:'network_or_crypto_error'});
  }
 }
 fail(404,'ไม่พบ API การแจ้งเตือนนักเรียน');
}
// A student can only open an incident tied to their own school identity,
// even when a notice URL is copied across accounts.
export async function studentPushTarget(req,env,account){
 allowed(account);
 const q=new URL(req.url).searchParams,kind=q.get('kind'),raw=q.get('id');
 if(!['late','truancy'].includes(kind)||!/^\d{1,15}$/.test(raw||''))fail(400,'รายการแจ้งเตือนไม่ถูกต้อง');
 const id=Number(raw);
 if(!Number.isSafeInteger(id)||id<1)fail(400,'รายการแจ้งเตือนไม่ถูกต้อง');
 const sql=kind==='late'?
  `SELECT e.school_date,e.id FROM late_qr_auto_events e
    JOIN late_self_requests r ON r.id=e.request_id AND r.state='verified'
    WHERE e.id=? AND e.active=1 AND e.student_id=?`:
  `SELECT e.school_date,e.id FROM truancy_events e
    JOIN period_truancy t ON t.student_id=e.student_id AND t.timetable_id=e.timetable_id AND t.school_date=e.school_date
    WHERE e.id=? AND e.active=1 AND e.student_id=?`;
 const found=await env.DB.prepare(sql).bind(id,account.student_id).first();
 if(!found)fail(404,'ไม่พบรายการแจ้งเตือนสำหรับบัญชีนี้');
 return reply({kind,id,school_date:found.school_date,student_id:account.student_id});
}
async function pending(env,kind){
 const sql=kind==='late'?`
 SELECT e.id,e.student_id,e.school_date,1 AS generation FROM late_qr_auto_events e
 JOIN late_self_requests r ON r.id=e.request_id AND r.state='verified'
 WHERE e.active=1 AND e.school_date=date('now','+7 hours')
  AND e.created_at>=datetime('now','-1 day')
  AND EXISTS(SELECT 1 FROM portal_accounts a JOIN student_push_subscriptions s ON s.student_account_id=a.id
    WHERE a.role='student' AND a.student_id=e.student_id AND a.active=1 AND a.must_change_password=0
    AND NOT EXISTS(SELECT 1 FROM student_push_deliveries d
      WHERE d.event_kind='late' AND d.event_id=e.id AND d.generation=1 AND d.subscription_id=s.id
      AND (d.state='delivered' OR d.attempts>=3)))
 ORDER BY e.id DESC LIMIT 12`:`
 SELECT e.id,e.student_id,e.school_date,e.generation FROM truancy_events e
 JOIN period_truancy t ON t.student_id=e.student_id AND t.timetable_id=e.timetable_id AND t.school_date=e.school_date
 JOIN attendance_period p ON p.student_id=e.student_id AND p.timetable_id=e.timetable_id
  AND p.school_date=e.school_date AND p.status='absent'
 WHERE e.active=1 AND e.school_date BETWEEN date('now','+7 hours','-14 days') AND date('now','+7 hours')
  AND e.updated_at>=datetime('now','-1 day')
  AND EXISTS(SELECT 1 FROM portal_accounts a JOIN student_push_subscriptions s ON s.student_account_id=a.id
    WHERE a.role='student' AND a.student_id=e.student_id AND a.active=1 AND a.must_change_password=0
    AND NOT EXISTS(SELECT 1 FROM student_push_deliveries d
      WHERE d.event_kind='truancy' AND d.event_id=e.id AND d.generation=e.generation AND d.subscription_id=s.id
      AND (d.state='delivered' OR d.attempts>=3)))
 ORDER BY e.id DESC LIMIT 12`;
 return (await env.DB.prepare(sql).all()).results||[];
}
export async function deliverStudentPush(env,{kind=null}={}){
 if(!env.DB||!ready(env))return {enabled:false,processed:0,delivered:0};
 let delivered=0,processed=0;
 for(const type of (kind?[kind]:['truancy','late'])){
  if(!['truancy','late'].includes(type))continue;
  if(!await notificationEnabled(env,type+'_student'))continue;
  const events=await pending(env,type);
  for(const e of events){
   const {results:devices}=await env.DB.prepare(`SELECT s.id,s.endpoint,s.p256dh,s.auth FROM student_push_subscriptions s
    JOIN portal_accounts a ON a.id=s.student_account_id AND a.role='student'
       AND a.active=1 AND a.must_change_password=0
    WHERE a.student_id=? LIMIT 5`).bind(e.student_id).all();
   for(const device of devices||[]){
    await env.DB.prepare(`INSERT OR IGNORE INTO student_push_deliveries(event_kind,event_id,generation,subscription_id)
     VALUES(?,?,?,?)`).bind(type,e.id,e.generation,device.id).run();
    const claim=await env.DB.prepare(`UPDATE student_push_deliveries
     SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
     WHERE event_kind=? AND event_id=? AND generation=? AND subscription_id=?
      AND attempts<3 AND (state='pending'
       OR (state IN ('sending','failed') AND updated_at<datetime('now','-2 minutes')))`)
     .bind(type,e.id,e.generation,device.id).run();
    if(!claim.meta?.changes)continue;
    processed++;
    const valid=type==='late'?
     await env.DB.prepare(`SELECT 1 AS ok FROM late_qr_auto_events e
      JOIN late_self_requests r ON r.id=e.request_id AND r.state='verified'
      WHERE e.id=? AND e.student_id=? AND e.active=1`).bind(e.id,e.student_id).first():
     await env.DB.prepare(`SELECT 1 AS ok FROM truancy_events e
      JOIN period_truancy t ON t.student_id=e.student_id AND t.timetable_id=e.timetable_id AND t.school_date=e.school_date
      JOIN attendance_period p ON p.student_id=e.student_id AND p.timetable_id=e.timetable_id
        AND p.school_date=e.school_date AND p.status='absent'
      WHERE e.id=? AND e.student_id=? AND e.generation=? AND e.active=1`)
       .bind(e.id,e.student_id,e.generation).first();
    let state='failed',httpStatus=null;
    if(valid)try{
     // Generic notification text only: no name, incident type, score, or classroom
     // appears on a shared phone lock screen; details require student login.
     const response=await sendStudentAttendancePush(device,env,{kind:type,eventId:e.id});
     httpStatus=response.status;
     if(response.ok){state='delivered';delivered++}
     if([404,410].includes(response.status))
      await env.DB.prepare('DELETE FROM student_push_subscriptions WHERE id=?').bind(device.id).run();
    }catch(error){console.warn('RD student push delivery failed',error?.name||'network')}
    await env.DB.prepare(`UPDATE student_push_deliveries SET state=?,last_http_status=?,updated_at=CURRENT_TIMESTAMP
     WHERE event_kind=? AND event_id=? AND generation=? AND subscription_id=?`)
     .bind(state,httpStatus,type,e.id,e.generation,device.id).run();
   }
  }
 }
 return {enabled:true,processed,delivered};
}
