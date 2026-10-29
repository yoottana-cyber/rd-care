// Push only for newly created, active point deductions, never for warnings,
// merits or historical records. Guardian relationship and portal account state
// are verified at delivery. Notification text contains no private student data.
import {notificationEnabled} from './notification-policy.js';
import {sendScoreChangePush} from './staff-push.js';
const ready=env=>Boolean(env.DB&&env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
export async function deliverScorePush(env){
 if(!ready(env))return {enabled:false,processed:0,delivered:0};
 const studentOn=await notificationEnabled(env,'score_student');
 const guardianOn=await notificationEnabled(env,'score_guardian');
 if(!studentOn&&!guardianOn)return {enabled:false,processed:0,delivered:0};
 const {results:events=[]}=await env.DB.prepare(`SELECT i.id AS incident_id,i.student_id
  FROM behavior_score_push_events e
  JOIN behavior_incidents i ON i.id=e.incident_id
  JOIN behavior_records b ON b.id=i.behavior_record_id AND b.deleted_at IS NULL
  WHERE i.points_applied<0 AND i.deleted_at IS NULL
   AND e.created_at>=datetime('now','-1 day')
   AND (
    (?=1 AND e.created_at >= (SELECT updated_at FROM notification_preferences WHERE event_key='score_student')
      AND EXISTS(SELECT 1 FROM student_push_subscriptions s
        JOIN portal_accounts a ON a.id=s.student_account_id AND a.student_id=i.student_id
          AND a.role='student' AND a.active=1 AND a.must_change_password=0
        WHERE NOT EXISTS(SELECT 1 FROM behavior_score_push_deliveries d
         WHERE d.incident_id=i.id AND d.recipient_type='student' AND d.subscription_id=s.id
         AND (d.state='delivered' OR d.attempts>=3))))
    OR
    (?=1 AND e.created_at >= (SELECT updated_at FROM notification_preferences WHERE event_key='score_guardian')
      AND EXISTS(SELECT 1 FROM guardian_push_subscriptions s
        JOIN portal_accounts a ON a.id=s.guardian_account_id AND a.role='guardian'
          AND a.active=1 AND a.must_change_password=0
        JOIN guardian_student_links l ON l.guardian_account_id=a.id AND l.student_id=i.student_id
        WHERE NOT EXISTS(SELECT 1 FROM behavior_score_push_deliveries d
         WHERE d.incident_id=i.id AND d.recipient_type='guardian' AND d.subscription_id=s.id
         AND (d.state='delivered' OR d.attempts>=3))))
   )
  ORDER BY e.incident_id DESC LIMIT 30`).bind(studentOn?1:0,guardianOn?1:0).all();
 let delivered=0,processed=0;
 for(const event of events){
  const targets=[];
  if(studentOn){
   const {results:students=[]}=await env.DB.prepare(`SELECT s.id,s.endpoint,s.p256dh,s.auth
    FROM student_push_subscriptions s
    JOIN portal_accounts a ON a.id=s.student_account_id AND a.role='student'
      AND a.active=1 AND a.must_change_password=0
    WHERE a.student_id=? LIMIT 5`).bind(event.student_id).all();
   targets.push(...students.map(device=>({audience:'student',device})));
  }
  if(guardianOn){
   const {results:guardians=[]}=await env.DB.prepare(`SELECT s.id,s.endpoint,s.p256dh,s.auth
    FROM guardian_push_subscriptions s
    JOIN portal_accounts a ON a.id=s.guardian_account_id AND a.role='guardian'
      AND a.active=1 AND a.must_change_password=0
    JOIN guardian_student_links l ON l.guardian_account_id=a.id AND l.student_id=?
    LIMIT 30`).bind(event.student_id).all();
   targets.push(...guardians.map(device=>({audience:'guardian',device})));
  }
  async function dispatch({audience,device}){
   const key=audience==='student'?'score_student':'score_guardian';
   // A switch may change after this dispatch started.
   if(!await notificationEnabled(env,key))return;
   const active=await env.DB.prepare(`SELECT 1 AS ok FROM behavior_incidents i
    JOIN behavior_records b ON b.id=i.behavior_record_id AND b.deleted_at IS NULL
    JOIN behavior_score_push_events e ON e.incident_id=i.id
    JOIN notification_preferences p ON p.event_key=?
      AND p.enabled=1 AND e.created_at>=p.updated_at
    WHERE i.id=? AND i.student_id=? AND i.points_applied<0 AND i.deleted_at IS NULL`)
    .bind(key,event.incident_id,event.student_id).first();
   if(!active)return;
   await env.DB.prepare(`INSERT OR IGNORE INTO behavior_score_push_deliveries
    (incident_id,recipient_type,subscription_id) VALUES(?,?,?)`)
    .bind(event.incident_id,audience,device.id).run();
   const claimed=await env.DB.prepare(`UPDATE behavior_score_push_deliveries
    SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE incident_id=? AND recipient_type=? AND subscription_id=?
     AND attempts<3 AND (state='pending' OR
       (state IN ('sending','failed') AND updated_at<datetime('now','-2 minutes')))`)
    .bind(event.incident_id,audience,device.id).run();
   if(!claimed.meta?.changes)return;
   processed++;
   let state='failed',httpStatus=null;
   try{
    const response=await sendScoreChangePush(device,env,audience);
    httpStatus=response.status;
    if(response.ok){state='delivered';delivered++}
    if([404,410].includes(response.status)){
     const subscriptionTable=audience==='student'?'student_push_subscriptions':'guardian_push_subscriptions';
     await env.DB.prepare(`DELETE FROM ${subscriptionTable} WHERE id=?`).bind(device.id).run();
    }
   }catch(error){console.warn('RD score Push failed',error?.name||'network')}
   await env.DB.prepare(`UPDATE behavior_score_push_deliveries
    SET state=?,last_http_status=?,updated_at=CURRENT_TIMESTAMP
    WHERE incident_id=? AND recipient_type=? AND subscription_id=?`)
    .bind(state,httpStatus,event.incident_id,audience,device.id).run();
  }
  for(let i=0;i<targets.length;i+=4)
   await Promise.allSettled(targets.slice(i,i+4).map(dispatch));
 }
 return {enabled:true,events:events.length,processed,delivered};
}
