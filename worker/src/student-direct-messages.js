import {notificationEnabled} from './notification-policy.js';
import {sendStudentDirectMessagePush} from './staff-push.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const integer=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
const authorizedSender=u=>u?.role==='admin'||u?.role==='staff'||
 (u?.role==='teacher'&&Number(u?.student_affairs)===1);
const validText=(value,min,max,label)=>{
 if(typeof value!=='string')fail(400,'กรุณากรอก'+label);
 const cleaned=value.trim();
 if(cleaned.length<min||cleaned.length>max||/[\u0000-\u001f\u007f]/.test(cleaned))
  fail(400,label+'ต้องมีความยาว '+min+'–'+max+' ตัวอักษร และไม่มีอักขระควบคุม');
 return cleaned;
};

// Only Student Affairs teachers/staff and school admins can send a direct notice.
// Never accept sender IDs or recipient account IDs from the browser.
export async function affairsMessageRoutes(req,env,user,path,ctx){
 if(!authorizedSender(user))fail(403,'เฉพาะผู้ได้รับสิทธิ์ฝ่ายกิจการนักเรียน');
 if(path==='/api/affairs/messages/sent'&&req.method==='GET'){
  const items=(await env.DB.prepare(`SELECT m.id,m.subject,m.body,m.created_at,m.read_at,
     s.student_no,s.full_name,c.label AS classroom_label,
     (SELECT COUNT(*) FROM student_message_push_deliveries d
       WHERE d.message_id=m.id AND d.state='delivered') AS push_delivered
    FROM student_direct_messages m JOIN students s ON s.id=m.student_id
    LEFT JOIN classrooms c ON c.id=s.classroom_id
    WHERE m.sender_id=? ORDER BY m.id DESC LIMIT 25`).bind(user.id).all()).results||[];
  return reply({items});
 }
 if(path==='/api/affairs/messages/send'&&req.method==='POST'){
  const raw=await req.text();
  if(raw.length>1800)fail(413,'ข้อความมีขนาดใหญ่เกินไป');
  let body;
  try{body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object')throw Error()}
  catch{fail(400,'รูปแบบข้อมูลไม่ถูกต้อง')}
  const studentId=integer(body.student_id);
  if(!studentId)fail(400,'กรุณาเลือกนักเรียนหนึ่งคน');
  const subject=validText(body.subject,2,80,'หัวข้อข้อความ');
  const text=validText(body.body,5,500,'รายละเอียดข้อความ');
  const student=await env.DB.prepare(`SELECT s.id FROM students s
    WHERE s.id=? AND s.active=1 AND EXISTS(
      SELECT 1 FROM portal_accounts a WHERE a.student_id=s.id AND a.role='student' AND a.active=1)`)
   .bind(studentId).first();
  if(!student)fail(409,'ไม่พบบัญชีนักเรียนที่เปิดใช้งาน กรุณาตรวจสอบข้อมูลบัญชี');
  const same=await env.DB.prepare(`SELECT 1 AS found FROM student_direct_messages
   WHERE sender_id=? AND student_id=? AND created_at>datetime('now','-1 minute')
   LIMIT 1`).bind(user.id,studentId).first();
  if(same)fail(429,'เพิ่งส่งข้อความถึงนักเรียนคนนี้ กรุณาเว้นอย่างน้อย 1 นาที');
  const quota=await env.DB.prepare(`SELECT COUNT(*) AS total FROM student_direct_messages
   WHERE sender_id=? AND created_at>datetime('now','-1 day')`).bind(user.id).first();
  if(Number(quota?.total||0)>=80)fail(429,'ส่งข้อความครบ 80 รายการใน 24 ชั่วโมงแล้ว');
  const result=await env.DB.batch([
   env.DB.prepare('INSERT INTO student_direct_messages(student_id,sender_id,subject,body) VALUES(?,?,?,?)')
    .bind(studentId,user.id,subject,text),
   env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
    VALUES(?,'student_private_message_sent','students',?)`).bind(user.id,String(studentId))
  ]);
  const messageId=Number(result[0].meta.last_row_id);
  const devices=await env.DB.prepare(`SELECT COUNT(*) AS total FROM student_push_subscriptions p
   JOIN portal_accounts a ON a.id=p.student_account_id AND a.role='student' AND a.active=1
   WHERE a.student_id=?`).bind(studentId).first();
  // Push is best effort; the durable inbox entry exists even if the student
  // has not subscribed, has no network, or the provider temporarily fails.
  if(ctx?.waitUntil)ctx.waitUntil(deliverStudentMessages(env,{messageId})
   .catch(e=>console.warn('RD student private-message push',e?.name||'network')));
  return reply({ok:true,id:messageId,inbox_saved:true,
   push_devices:Number(devices?.total||0),
   message:'บันทึกข้อความในแอปนักเรียนแล้ว; Push จะส่งเฉพาะอุปกรณ์ที่เปิดรับแจ้งเตือน'},201);
 }
 fail(404,'ไม่พบ API ข้อความฝ่ายกิจการนักเรียน');
}

// Only the authenticated student may list/read their own inbox; parents and
// other students must never receive message bodies.
export async function portalStudentMessages(req,env,account,path){
 if(account?.role!=='student'||!account.active||!account.student_id||account.must_change_password)
  fail(403,'เฉพาะนักเรียนที่เข้าสู่ระบบ');
 if(path==='/api/portal/messages'&&req.method==='GET'){
  const [list,unread]=await Promise.all([
   env.DB.prepare(`SELECT m.id,m.subject,m.body,m.created_at,m.read_at,
     u.display_name AS sender_name
    FROM student_direct_messages m JOIN users u ON u.id=m.sender_id
    WHERE m.student_id=? ORDER BY m.id DESC LIMIT 50`).bind(account.student_id).all(),
   env.DB.prepare(`SELECT COUNT(*) AS total FROM student_direct_messages
    WHERE student_id=? AND read_at IS NULL`).bind(account.student_id).first()
  ]);
  return reply({items:list.results||[],unread:Number(unread?.total)||0});
 }
 const match=/^\/api\/portal\/messages\/(\d+)\/read$/.exec(path);
 if(req.method==='POST'&&match){
  const messageId=integer(match[1]);
  if(!messageId)fail(400,'รหัสข้อความไม่ถูกต้อง');
  const result=await env.DB.prepare(`UPDATE student_direct_messages
   SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
   WHERE id=? AND student_id=?`).bind(messageId,account.student_id).run();
  if(!result.meta?.changes)fail(404,'ไม่พบข้อความสำหรับบัญชีนี้');
  return reply({ok:true});
 }
 fail(404,'ไม่พบ API ข้อความนักเรียน');
}

export async function deliverStudentMessages(env,{messageId=null}={}){
 if(!await notificationEnabled(env,'student_message'))return {processed:0,delivered:0,enabled:false};
 if(!env.DB||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)
  return {processed:0,delivered:0,enabled:false};
 const [records]=await Promise.all([
  messageId?
   env.DB.prepare(`SELECT m.id,m.student_id FROM student_direct_messages m
     WHERE m.id=? AND m.created_at>=datetime('now','-1 day')`).bind(messageId).all():
   env.DB.prepare(`SELECT m.id,m.student_id FROM student_direct_messages m
    WHERE m.created_at>=datetime('now','-1 day')
     AND EXISTS(SELECT 1 FROM portal_accounts a JOIN student_push_subscriptions p
       ON p.student_account_id=a.id WHERE a.student_id=m.student_id
       AND a.active=1 AND a.role='student'
       AND NOT EXISTS(SELECT 1 FROM student_message_push_deliveries d
          WHERE d.message_id=m.id AND d.subscription_id=p.id
          AND (d.state='delivered' OR d.attempts>=3)))
    ORDER BY m.id DESC LIMIT 10`).all()
 ]);
 let processed=0,delivered=0;
 for(const item of records.results||[]){
  const devices=(await env.DB.prepare(`SELECT p.id,p.endpoint,p.p256dh,p.auth FROM student_push_subscriptions p
   JOIN portal_accounts a ON a.id=p.student_account_id
   WHERE a.student_id=? AND a.role='student' AND a.active=1 LIMIT 5`)
   .bind(item.student_id).all()).results||[];
  for(const device of devices){
   await env.DB.prepare(`INSERT OR IGNORE INTO student_message_push_deliveries(message_id,subscription_id)
    VALUES(?,?)`).bind(item.id,device.id).run();
   const claimed=await env.DB.prepare(`UPDATE student_message_push_deliveries
    SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE message_id=? AND subscription_id=? AND attempts<3
      AND (state='pending' OR (state IN ('failed','sending')
         AND updated_at<datetime('now','-2 minutes')))`)
    .bind(item.id,device.id).run();
   if(!claimed.meta?.changes)continue;
   processed++;
   let status=null,deliveredStatus='failed';
   try{
    // The only Push metadata is an opaque message ID. Message body/subject,
    // student identity, sender, and classroom never leave the authenticated API.
    const response=await sendStudentDirectMessagePush(device,env,item.id);
    status=response.status;
    if(response.ok){deliveredStatus='delivered';delivered++}
    if([404,410].includes(status))
     await env.DB.prepare('DELETE FROM student_push_subscriptions WHERE id=?').bind(device.id).run();
   }catch(error){console.warn('RD student private-message delivery',error?.name||'network')}
   await env.DB.prepare(`UPDATE student_message_push_deliveries
     SET state=?,last_http_status=?,updated_at=CURRENT_TIMESTAMP
     WHERE message_id=? AND subscription_id=?`)
    .bind(deliveredStatus,status,item.id,device.id).run();
  }
 }
 return {enabled:true,processed,delivered};
}
