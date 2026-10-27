// Push delivery for verified late QR arrivals. Subscriptions are opt-in;
// alerts have a generic category-only encrypted payload.
import {sendLateArrivalPush} from './staff-push.js';
const ready=env=>Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
export async function deliverLateQrPush(env){
 if(!env.DB||!ready(env))return {enabled:false,processed:0,delivered:0};
 const {results:events}=await env.DB.prepare(`SELECT e.id,e.student_id,c.advisor_user_id
 FROM late_qr_auto_events e
 JOIN late_self_requests r ON r.id=e.request_id AND r.state='verified'
 JOIN student_enrollments h ON h.student_id=e.student_id
   AND h.start_date<=e.school_date AND (h.end_date IS NULL OR h.end_date>e.school_date)
 JOIN classrooms c ON c.id=h.classroom_id
 WHERE e.active=1 AND e.school_date=date('now','+7 hours')
  AND e.created_at>=datetime('now','-1 day')
  AND (
   EXISTS(SELECT 1 FROM staff_push_subscriptions ps
    JOIN users u ON u.id=ps.user_id AND u.active=1
    WHERE ps.user_id=c.advisor_user_id AND NOT EXISTS(
      SELECT 1 FROM late_qr_push_deliveries d
      WHERE d.event_id=e.id AND d.recipient_type='advisor' AND d.subscription_id=ps.id
      AND (d.state='delivered' OR d.attempts>=3)))
   OR EXISTS(SELECT 1 FROM guardian_push_subscriptions ps
    JOIN portal_accounts a ON a.id=ps.guardian_account_id
      AND a.role='guardian' AND a.active=1 AND a.must_change_password=0
    JOIN guardian_student_links g ON g.guardian_account_id=a.id AND g.student_id=e.student_id
    WHERE NOT EXISTS(SELECT 1 FROM late_qr_push_deliveries d
     WHERE d.event_id=e.id AND d.recipient_type='guardian' AND d.subscription_id=ps.id
      AND (d.state='delivered' OR d.attempts>=3)))
  )
 ORDER BY e.id DESC LIMIT 25`).all();
 let delivered=0,failed=0;
 for(const event of events){
  const {results:staff}=event.advisor_user_id?
   await env.DB.prepare(`SELECT ps.id,ps.endpoint,ps.p256dh,ps.auth
    FROM staff_push_subscriptions ps JOIN users u ON u.id=ps.user_id AND u.active=1
    WHERE ps.user_id=? LIMIT 5`).bind(event.advisor_user_id).all():{results:[]};
  const {results:guardians}=await env.DB.prepare(`SELECT ps.id,ps.endpoint,ps.p256dh,ps.auth
   FROM guardian_push_subscriptions ps
   JOIN portal_accounts a ON a.id=ps.guardian_account_id AND a.role='guardian'
     AND a.active=1 AND a.must_change_password=0
   JOIN guardian_student_links g ON g.guardian_account_id=a.id
   WHERE g.student_id=? LIMIT 30`).bind(event.student_id).all();
  const targets=[...staff.map(device=>({type:'advisor',device})),
   ...guardians.map(device=>({type:'guardian',device}))];
  async function sendOne({type,device}){
   await env.DB.prepare(`INSERT OR IGNORE INTO late_qr_push_deliveries
     (event_id,recipient_type,subscription_id) VALUES(?,?,?)`)
    .bind(event.id,type,device.id).run();
   const claim=await env.DB.prepare(`UPDATE late_qr_push_deliveries
    SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE event_id=? AND recipient_type=? AND subscription_id=?
     AND attempts<3
     AND (state='pending' OR
       (state IN ('sending','failed') AND updated_at<datetime('now','-2 minutes')))`)
    .bind(event.id,type,device.id).run();
   if(!claim.meta?.changes)return;
   const stillValid=await env.DB.prepare(`SELECT 1 AS ok FROM late_qr_auto_events e
    JOIN late_self_requests r ON r.id=e.request_id AND r.state='verified'
    WHERE e.id=? AND e.active=1`).bind(event.id).first();
   if(!stillValid){
    await env.DB.prepare(`UPDATE late_qr_push_deliveries
     SET attempts=3,state='failed',updated_at=CURRENT_TIMESTAMP
     WHERE event_id=? AND recipient_type=? AND subscription_id=?`)
    .bind(event.id,type,device.id).run();
    return;
   }
   let state='failed',httpStatus=null;
   try{
    const response=await sendLateArrivalPush(device,env,type);
    httpStatus=response.status;
    if(response.ok){state='delivered';delivered++}
    if(response.status===404||response.status===410){
     const table=type==='advisor'?'staff_push_subscriptions':'guardian_push_subscriptions';
     await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(device.id).run();
    }
   }catch(error){console.warn('RD late QR Push failed',error?.name||'network')}
   if(state==='failed')failed++;
   await env.DB.prepare(`UPDATE late_qr_push_deliveries
     SET state=?,last_http_status=?,updated_at=CURRENT_TIMESTAMP
     WHERE event_id=? AND recipient_type=? AND subscription_id=?`)
    .bind(state,httpStatus,event.id,type,device.id).run();
  }
  for(let i=0;i<targets.length;i+=4)
   await Promise.allSettled(targets.slice(i,i+4).map(sendOne));
 }
 return {enabled:true,processed:events.length,delivered,failed};
}
