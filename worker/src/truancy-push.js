// Room notifications include both advisor slots; D1 migration 0035 preserves the original primary assignment.
// Opt-in, relationship-verified truancy alerts for staff advisors and guardians.
// Push carries only an encrypted event reference and non-identifying lesson summary.
import {validPushSubscription,sendPriorityPush,sendPushTest,diagnoseVapid} from './staff-push.js';
import {notificationEnabled} from './notification-policy.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{code:status})};
const reply=(data)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const ready=env=>Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
async function read(req){const raw=await req.text();if(raw.length>6500)fail(413,'ข้อมูลอุปกรณ์ใหญ่เกินไป');try{const data=JSON.parse(raw);if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data}catch{fail(400,'ข้อมูลแจ้งเตือนไม่ถูกต้อง')}}
export async function guardianPushRoutes(req,env,account,path){
 if(account.role!=='guardian'||!account.active||account.must_change_password)fail(403,'เฉพาะผู้ปกครองที่ยืนยันตัวตนและเปลี่ยนรหัสผ่านแล้ว');
 if(path==='/api/portal/push/config'&&req.method==='GET')
  return reply({enabled:ready(env),publicKey:ready(env)?env.VAPID_PUBLIC_KEY:null});
 if(path==='/api/portal/push/subscribe'&&req.method==='POST'){
  if(!ready(env))fail(503,'ระบบแจ้งเตือนยังไม่ได้เปิดใช้งาน');
  const subscription=await read(req);
  if(!validPushSubscription(subscription))fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  // Verified school link is mandatory. An unlinked guardian may not subscribe.
  const link=await env.DB.prepare('SELECT 1 AS ok FROM guardian_student_links WHERE guardian_account_id=? LIMIT 1').bind(account.id).first();
  if(!link)fail(403,'โรงเรียนยังไม่ยืนยันนักเรียนในความดูแล');
  const otherStaff=await env.DB.prepare('SELECT id FROM staff_push_subscriptions WHERE endpoint=?').bind(subscription.endpoint).first();
  if(otherStaff)fail(409,'อุปกรณ์นี้ยังสมัคร Push ด้วยบัญชีครู กรุณาออกจากระบบครูก่อน');
  const studentOther=await env.DB.prepare('SELECT id FROM student_push_subscriptions WHERE endpoint=?').bind(subscription.endpoint).first();
  if(studentOther)fail(409,'อุปกรณ์นี้สมัคร Push ด้วยบัญชีนักเรียนอยู่ กรุณาปิด Push เดิมก่อน');
  const old=await env.DB.prepare('SELECT guardian_account_id FROM guardian_push_subscriptions WHERE endpoint=?').bind(subscription.endpoint).first();
  if(old&&old.guardian_account_id!==account.id)fail(409,'อุปกรณ์ผูกกับบัญชีผู้ปกครองอื่น');
  if(!old){
   const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM guardian_push_subscriptions WHERE guardian_account_id=?').bind(account.id).first();
   if(Number(count?.total||0)>=5)fail(429,'ลงทะเบียนอุปกรณ์ได้ไม่เกิน 5 เครื่องต่อบัญชี');
  }
  await env.DB.prepare(`INSERT INTO guardian_push_subscriptions(guardian_account_id,endpoint,p256dh,auth)
   VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET
   p256dh=excluded.p256dh,auth=excluded.auth
   WHERE guardian_push_subscriptions.guardian_account_id=excluded.guardian_account_id`)
   .bind(account.id,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth).run();
  return reply({ok:true,subscribed:true});
 }
 if(path==='/api/portal/push/status'&&req.method==='POST'){
  const data=await read(req);
  if(typeof data.endpoint!=='string'||data.endpoint.length>1800)fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  const owned=await env.DB.prepare('SELECT id FROM guardian_push_subscriptions WHERE endpoint=? AND guardian_account_id=?')
    .bind(data.endpoint,account.id).first();
  return reply({subscribed:!!owned});
 }
 if(path==='/api/portal/push/test'&&req.method==='POST'){
  const data=await read(req);
  if(typeof data.endpoint!=='string'||data.endpoint.length>1800)fail(400,'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
  const diagnostic=await diagnoseVapid(env);
  if(!diagnostic.ready)return reply({accepted:false,code:diagnostic.code,missing:diagnostic.missing});
  const verified=await env.DB.prepare('SELECT 1 AS ok FROM guardian_student_links WHERE guardian_account_id=? LIMIT 1')
   .bind(account.id).first();
  if(!verified)fail(403,'บัญชีไม่มีนักเรียนในความดูแลที่ยืนยันแล้ว');
  const device=await env.DB.prepare(`SELECT id,endpoint,p256dh,auth FROM guardian_push_subscriptions
    WHERE guardian_account_id=? AND endpoint=?`).bind(account.id,data.endpoint).first();
  if(!device)return reply({accepted:false,code:'device_not_registered'});
  try{
   const result=await sendPushTest(device,env,'guardian');
   if(result.status===404||result.status===410)
    await env.DB.prepare('DELETE FROM guardian_push_subscriptions WHERE id=? AND guardian_account_id=?')
     .bind(device.id,account.id).run();
   return reply({accepted:result.ok,code:result.ok?'accepted':'provider_rejected',
     providerStatus:result.status});
  }catch(e){
   console.warn('RD CONNECT guardian push self-test failed',e?.name||'network');
   return reply({accepted:false,code:'network_or_crypto_error'});
  }
 }
 if(path==='/api/portal/push/unsubscribe'&&req.method==='POST'){
  const data=await read(req);
  if(typeof data.endpoint!=='string'||data.endpoint.length>1800)fail(400,'อุปกรณ์ไม่ถูกต้อง');
  await env.DB.prepare('DELETE FROM guardian_push_subscriptions WHERE endpoint=? AND guardian_account_id=?')
   .bind(data.endpoint,account.id).run();
  return reply({ok:true,subscribed:false});
 }
 fail(404,'ไม่พบ API');
}
export async function guardianTruancyItems(env,account,range=null){
 if(account.role!=='guardian')return [];
 const {results}=await env.DB.prepare(`SELECT e.id,e.student_id,e.school_date,t.period,t.subject,s.full_name,
  e.created_at FROM truancy_events e
  JOIN period_truancy tr ON tr.student_id=e.student_id AND tr.timetable_id=e.timetable_id
    AND tr.school_date=e.school_date
  JOIN attendance_period p ON p.student_id=e.student_id AND p.timetable_id=e.timetable_id
    AND p.school_date=e.school_date AND p.status='absent'
  JOIN timetable t ON t.id=e.timetable_id
  JOIN students s ON s.id=e.student_id AND s.active=1
  JOIN guardian_student_links l ON l.student_id=e.student_id
  WHERE l.guardian_account_id=? AND e.active=1
   ${range?'AND e.school_date BETWEEN ? AND ?':"AND e.school_date>=date('now','-30 days')"}
  ORDER BY e.created_at DESC,e.id DESC LIMIT 40`)
  .bind(account.id,...(range?[range.from,range.to]:[])).all();
 return results;
}
export async function advisorTruancyItems(env,user){
 const scope=['admin','staff'].includes(user.role)?'':' AND (c.advisor_user_id=? OR c.advisor2_user_id=?)';
 const args=['admin','staff'].includes(user.role)?[]:[user.id,user.id];
 const {results}=await env.DB.prepare(`SELECT e.id,e.school_date,t.classroom_id,t.period,t.subject,c.label AS classroom_label,s.full_name
 FROM truancy_events e JOIN timetable t ON t.id=e.timetable_id
 JOIN classrooms c ON c.id=t.classroom_id JOIN students s ON s.id=e.student_id AND s.active=1
 WHERE e.active=1 AND e.school_date>=date('now','-30 days')`+scope+
 ' ORDER BY e.id DESC LIMIT 60').bind(...args).all();
 return results;
}
// Feedback for the teacher who just saved a period mark. This is not a delivery
// receipt: it describes subscribed, eligible recipients without exposing endpoints,
// family details or student data to the browser.
export async function truancyPushReadiness(env,roomId,studentIds){
 const count=studentIds.length;
 if(!count)return {events:0,advisorDevices:0,guardianDevices:0,ready:false,reason:'no_events'};
 const enabled=ready(env);
 const room=await env.DB.prepare(`SELECT c.advisor_user_id,c.advisor2_user_id FROM classrooms c WHERE c.id=?`)
   .bind(roomId).first();
 const [advisor,guardians]=await Promise.all([
  room?.advisor_user_id||room?.advisor2_user_id?env.DB.prepare(`SELECT COUNT(*) AS total
    FROM staff_push_subscriptions p JOIN users u ON u.id=p.user_id AND u.active=1
    WHERE p.user_id IN (?,?)`).bind(room.advisor_user_id||0,room.advisor2_user_id||0).first():Promise.resolve({total:0}),
  env.DB.prepare(`SELECT COUNT(DISTINCT ps.id) AS total
    FROM guardian_push_subscriptions ps
    JOIN portal_accounts a ON a.id=ps.guardian_account_id AND a.role='guardian'
      AND a.active=1 AND a.must_change_password=0
    JOIN guardian_student_links l ON l.guardian_account_id=a.id
    WHERE l.student_id IN (${studentIds.map(()=>'?').join(',')})`).bind(...studentIds).first()
 ]);
 const advisorDevices=Number(advisor?.total||0),guardianDevices=Number(guardians?.total||0);
 return {events:count,advisorDevices,guardianDevices,ready:enabled,
  reason:!enabled?'missing_vapid':advisorDevices+guardianDevices===0?'no_subscribers':'queued'};
}
// Priority dispatch: immediately after commit (waitUntil) and fallback on 5-min cron.
// At most three attempts/device/event, never retry after the push service accepted it.
// Edits of the allowed 14-day attendance window count as new actionable incidents;
// key off the recent EDIT timestamp, not today's lesson date.
export async function deliverTruancyPush(env){
 if(!env.DB||!ready(env))return {enabled:false,processed:0,delivered:0};
 const {results:events}=await env.DB.prepare(`SELECT e.id,e.generation,e.student_id,e.school_date,
  c.advisor_user_id,c.advisor2_user_id,t.period,t.subject FROM truancy_events e
 JOIN period_truancy tr ON tr.student_id=e.student_id
   AND tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
 JOIN attendance_period p ON p.student_id=e.student_id
   AND p.timetable_id=e.timetable_id AND p.school_date=e.school_date AND p.status='absent'
 JOIN timetable t ON t.id=e.timetable_id JOIN classrooms c ON c.id=t.classroom_id
 WHERE e.active=1 AND e.school_date BETWEEN date('now','+7 hours','-14 days')
    AND date('now','+7 hours')
   AND e.updated_at>=datetime('now','-1 day')
   AND (
    ((c.advisor_user_id IS NOT NULL OR c.advisor2_user_id IS NOT NULL) AND EXISTS(
      SELECT 1 FROM staff_push_subscriptions s JOIN users u ON u.id=s.user_id AND u.active=1
      WHERE s.user_id IN (c.advisor_user_id,c.advisor2_user_id) AND NOT EXISTS(
       SELECT 1 FROM truancy_push_deliveries d
       WHERE d.event_id=e.id AND d.generation=e.generation
         AND d.recipient_type='advisor' AND d.subscription_id=s.id
         AND (d.state='delivered' OR d.attempts>=3)
      )
    ))
    OR EXISTS(
      SELECT 1 FROM guardian_push_subscriptions ps
      JOIN portal_accounts a ON a.id=ps.guardian_account_id
        AND a.role='guardian' AND a.active=1 AND a.must_change_password=0
      JOIN guardian_student_links l ON l.guardian_account_id=a.id
      WHERE l.student_id=e.student_id AND NOT EXISTS(
       SELECT 1 FROM truancy_push_deliveries d
       WHERE d.event_id=e.id AND d.generation=e.generation
         AND d.recipient_type='guardian' AND d.subscription_id=ps.id
         AND (d.state='delivered' OR d.attempts>=3)
      )
    )
   )
 ORDER BY e.id DESC LIMIT 25`).all();
 let delivered=0,failed=0;
 for(const event of events){
  const {results:staff}=event.advisor_user_id||event.advisor2_user_id?await env.DB.prepare(`SELECT s.id,s.endpoint,s.p256dh,s.auth
   FROM staff_push_subscriptions s JOIN users u ON u.id=s.user_id AND u.active=1
   WHERE s.user_id IN (?,?) LIMIT 10`).bind(event.advisor_user_id||0,event.advisor2_user_id||0).all():{results:[]};
  const {results:guardians}=await env.DB.prepare(`SELECT ps.id,ps.endpoint,ps.p256dh,ps.auth
   FROM guardian_push_subscriptions ps JOIN portal_accounts a ON a.id=ps.guardian_account_id
   JOIN guardian_student_links l ON l.guardian_account_id=a.id
   WHERE a.role='guardian' AND a.active=1 AND a.must_change_password=0
    AND l.student_id=? LIMIT 30`).bind(event.student_id).all();
  // Place the advisor first, then guardians. Send small waves concurrently so
  // many subscribed devices never block a parent behind unrelated deliveries.
  const targets=[...(await notificationEnabled(env,'truancy_advisor')?staff:[]).map(d=>({type:'advisor',device:d})),
    ...(await notificationEnabled(env,'truancy_guardian')?guardians:[]).map(d=>({type:'guardian',device:d}))];
  async function sendTarget({type,device}){
   await env.DB.prepare(`INSERT OR IGNORE INTO truancy_push_deliveries
     (event_id,generation,recipient_type,subscription_id)
     VALUES(?,?,?,?)`).bind(event.id,event.generation,type,device.id).run();
   const claim=await env.DB.prepare(`UPDATE truancy_push_deliveries
    SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE event_id=? AND generation=? AND recipient_type=? AND subscription_id=?
      AND attempts<3 AND (state='pending'
       OR (state IN ('sending','failed') AND updated_at<datetime('now','-2 minutes')))`)
    .bind(event.id,event.generation,type,device.id).run();
   if(!claim.meta?.changes)return;
   // Recheck that the teacher has not corrected their entry while dispatching.
   const active=await env.DB.prepare(`SELECT 1 AS ok FROM truancy_events e
     JOIN period_truancy tr ON tr.student_id=e.student_id
       AND tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
     JOIN attendance_period p ON p.student_id=e.student_id
       AND p.timetable_id=e.timetable_id AND p.school_date=e.school_date AND p.status='absent'
     WHERE e.id=? AND e.generation=? AND e.active=1`)
    .bind(event.id,event.generation).first();
   if(!active)return;
   let result='failed',httpStatus=null;
   try{
    const response=await sendPriorityPush(device,env,type,{
     eventId:event.id,date:event.school_date,period:event.period,subject:event.subject
    });
    httpStatus=response.status;
    if(response.ok){result='delivered';delivered++}
    if(response.status===404||response.status===410){
     const table=type==='advisor'?'staff_push_subscriptions':'guardian_push_subscriptions';
     await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(device.id).run();
    }
   }catch(error){console.warn('RD priority push dispatch failed',error?.name||'network')}
   if(result==='failed')failed++;
   await env.DB.prepare(`UPDATE truancy_push_deliveries
     SET state=?,last_http_status=?,updated_at=CURRENT_TIMESTAMP
     WHERE event_id=? AND generation=? AND recipient_type=? AND subscription_id=?`)
    .bind(result,httpStatus,event.id,event.generation,type,device.id).run();
  }
  // Four concurrent outbound requests is a balanced ceiling for Worker limits.
  for(let i=0;i<targets.length;i+=4){
   await Promise.allSettled(targets.slice(i,i+4).map(sendTarget));
  }
 }
 return {enabled:true,processed:events.length,delivered,failed};
}
