// Opt-in, relationship-verified truancy alerts for staff advisors and guardians.
// Notification payloads are empty; never put students' identities or allegations on lock screens.
import {validPushSubscription,sendGenericPush} from './staff-push.js';
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
 if(path==='/api/portal/push/unsubscribe'&&req.method==='POST'){
  const data=await read(req);
  if(typeof data.endpoint!=='string'||data.endpoint.length>1800)fail(400,'อุปกรณ์ไม่ถูกต้อง');
  await env.DB.prepare('DELETE FROM guardian_push_subscriptions WHERE endpoint=? AND guardian_account_id=?')
   .bind(data.endpoint,account.id).run();
  return reply({ok:true,subscribed:false});
 }
 fail(404,'ไม่พบ API');
}
export async function guardianTruancyItems(env,account){
 if(account.role!=='guardian')return [];
 const {results}=await env.DB.prepare(`SELECT e.id,e.school_date,t.period,t.subject,s.full_name,
  e.created_at FROM truancy_events e
  JOIN timetable t ON t.id=e.timetable_id
  JOIN students s ON s.id=e.student_id AND s.active=1
  JOIN guardian_student_links l ON l.student_id=e.student_id
  WHERE l.guardian_account_id=? AND e.active=1
   AND e.school_date>=date('now','-30 days')
  ORDER BY e.created_at DESC,e.id DESC LIMIT 40`).bind(account.id).all();
 return results;
}
export async function advisorTruancyItems(env,user){
 const scope=['admin','staff'].includes(user.role)?'':' AND c.advisor_user_id=?';
 const args=['admin','staff'].includes(user.role)?[]:[user.id];
 const {results}=await env.DB.prepare(`SELECT e.id,e.school_date,t.classroom_id,t.period,t.subject,c.label AS classroom_label,s.full_name
 FROM truancy_events e JOIN timetable t ON t.id=e.timetable_id
 JOIN classrooms c ON c.id=t.classroom_id JOIN students s ON s.id=e.student_id AND s.active=1
 WHERE e.active=1 AND e.school_date>=date('now','-30 days')`+scope+
 ' ORDER BY e.id DESC LIMIT 60').bind(...args).all();
 return results;
}
export async function deliverTruancyPush(env){
 if(!env.DB||!ready(env))return {enabled:false,delivered:0};
 // Re-query actual current attendance and verified links at send time. Corrections,
 // disabled guardians or withdrawn relationships cannot receive pending notifications.
 const {results:events}=await env.DB.prepare(`SELECT e.id,e.generation,e.student_id,t.classroom_id,c.advisor_user_id
 FROM truancy_events e
 JOIN period_truancy tr ON tr.student_id=e.student_id AND tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
 JOIN attendance_period p ON p.student_id=e.student_id AND p.timetable_id=e.timetable_id AND p.school_date=e.school_date AND p.status='absent'
 JOIN timetable t ON t.id=e.timetable_id JOIN classrooms c ON c.id=t.classroom_id
 WHERE e.active=1 AND e.created_at>=datetime('now','-1 day')
 ORDER BY e.id DESC LIMIT 40`).all();
 let delivered=0;
 for(const event of events){
  const {results:staff}=event.advisor_user_id?await env.DB.prepare(`SELECT s.id,s.endpoint
   FROM staff_push_subscriptions s JOIN users u ON u.id=s.user_id AND u.active=1
   WHERE s.user_id=? LIMIT 5`).bind(event.advisor_user_id).all():{results:[]};
  const {results:guardians}=await env.DB.prepare(`SELECT ps.id,ps.endpoint
   FROM guardian_push_subscriptions ps JOIN portal_accounts a ON a.id=ps.guardian_account_id
   JOIN guardian_student_links l ON l.guardian_account_id=a.id
   WHERE a.role='guardian' AND a.active=1 AND a.must_change_password=0
    AND l.student_id=? LIMIT 30`).bind(event.student_id).all();
  for(const [type,devices] of [['advisor',staff],['guardian',guardians]]){
   for(const device of devices){
    await env.DB.prepare(`INSERT OR IGNORE INTO truancy_push_deliveries
     (event_id,generation,recipient_type,subscription_id) VALUES(?,?,?,?)`)
     .bind(event.id,event.generation,type,device.id).run();
    const claim=await env.DB.prepare(`UPDATE truancy_push_deliveries SET state='sending',updated_at=CURRENT_TIMESTAMP
     WHERE event_id=? AND generation=? AND recipient_type=? AND subscription_id=?
     AND (state='pending' OR (state IN ('sending','failed') AND updated_at<datetime('now','-10 minutes')))`)
     .bind(event.id,event.generation,type,device.id).run();
    if(!claim.meta?.changes)continue;
    // Check active status again before delivery; a teacher may have just corrected the mark.
    const active=await env.DB.prepare(`SELECT 1 AS ok FROM truancy_events e
      JOIN period_truancy tr ON tr.student_id=e.student_id AND tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
      WHERE e.id=? AND e.generation=? AND e.active=1`)
     .bind(event.id,event.generation).first();
    if(!active)continue;
    let result='failed';
    try{
     const response=await sendGenericPush(device.endpoint,env);
     if(response.ok){result='delivered';delivered++}
     if(response.status===404||response.status===410){
      await env.DB.prepare(`DELETE FROM ${type==='advisor'?'staff_push_subscriptions':'guardian_push_subscriptions'} WHERE id=?`)
       .bind(device.id).run();
     }
    }catch(error){console.warn('RD truancy push delivery failed',error?.name||'network')}
    await env.DB.prepare(`UPDATE truancy_push_deliveries SET state=?,updated_at=CURRENT_TIMESTAMP
      WHERE event_id=? AND generation=? AND recipient_type=? AND subscription_id=?`)
      .bind(result,event.id,event.generation,type,device.id).run();
   }
  }
 }
 return {enabled:true,delivered};
}
