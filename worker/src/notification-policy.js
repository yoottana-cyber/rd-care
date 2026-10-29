// Central, admin-managed switches for school Push categories.
// These regulate delivery, not the recording of attendance or behavior events.
export const NOTIFICATION_CATEGORIES=Object.freeze([
 {key:'score_student',group:'คะแนนพฤติกรรม',label:'หักคะแนนความผิด → นักเรียน'},
 {key:'score_guardian',group:'คะแนนพฤติกรรม',label:'หักคะแนนความผิด → ผู้ปกครอง'},
 {key:'warning_student',group:'คะแนนพฤติกรรม',label:'ตักเตือนโดยยังไม่หักคะแนน → นักเรียน'},
 {key:'warning_guardian',group:'คะแนนพฤติกรรม',label:'ตักเตือนโดยยังไม่หักคะแนน → ผู้ปกครอง'},
 {key:'truancy_student',group:'การเข้าเรียน',label:'หนีเรียน → นักเรียน'},
 {key:'truancy_guardian',group:'การเข้าเรียน',label:'หนีเรียน → ผู้ปกครอง'},
 {key:'truancy_advisor',group:'การเข้าเรียน',label:'หนีเรียน → ครูที่ปรึกษา'},
 {key:'late_student',group:'การเข้าเรียน',label:'มาสายผ่าน QR → นักเรียน'},
 {key:'late_guardian',group:'การเข้าเรียน',label:'มาสายผ่าน QR → ผู้ปกครอง'},
 {key:'late_advisor',group:'การเข้าเรียน',label:'มาสายผ่าน QR → ครูที่ปรึกษา'},
 {key:'review_advisor',group:'งานครู',label:'ขาดรายคาบรอตรวจสอบ → ครูที่ปรึกษา'},
 {key:'daily_reminder_advisor',group:'งานครู',label:'เตือนเช็กชื่อรายวัน → ครูที่ปรึกษา'},
 {key:'student_message',group:'ข้อความ',label:'ข้อความใหม่ → นักเรียน'}
]);
const VALID=new Set(NOTIFICATION_CATEGORIES.map(x=>x.key));
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export async function notificationEnabled(env,key){
 if(!VALID.has(key))throw Error('Unknown notification category');
 const row=await env.DB.prepare('SELECT enabled FROM notification_preferences WHERE event_key=?')
  .bind(key).first();
 return row===null||row===undefined||Number(row.enabled)===1;
}
export async function notificationPolicyRoutes(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบเท่านั้น');
 if(path!=='/api/admin/notification-preferences')fail(404,'ไม่พบหน้าตั้งค่าการแจ้งเตือน');
 if(req.method==='GET'){
  const {results=[]}=await env.DB.prepare('SELECT event_key,enabled,updated_at FROM notification_preferences').all();
  const map=Object.fromEntries(results.map(x=>[x.event_key,Number(x.enabled)===1]));
  const defaultOn=key=>!key.startsWith('warning_');
  return reply({items:NOTIFICATION_CATEGORIES.map(x=>({...x,enabled:map[x.key]??defaultOn(x.key)}))});
 }
 if(req.method!=='POST')fail(405,'ไม่รองรับคำขอ');
 const raw=await req.text();
 if(raw.length>2000)fail(413,'ข้อมูลตั้งค่ายาวเกินไป');
 let b;try{b=JSON.parse(raw)}catch{fail(400,'ข้อมูลตั้งค่าไม่ถูกต้อง')}
 if(!b||typeof b!=='object'||Array.isArray(b)||!VALID.has(b.key)||typeof b.enabled!=='boolean'||
  Object.keys(b).some(key=>!['key','enabled'].includes(key)))
  fail(400,'ประเภทการแจ้งเตือนหรือสถานะไม่ถูกต้อง');
 const current=await notificationEnabled(env,b.key);
 if(current===b.enabled)return reply({ok:true,key:b.key,enabled:current,unchanged:true});
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO notification_preferences(event_key,enabled,updated_by,updated_at)
   VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_key) DO UPDATE SET
   enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
   .bind(b.key,b.enabled?1:0,user.id),
  env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
   VALUES(?,'notification_preference_changed','notification_preferences',?)`)
   .bind(user.id,b.key)
 ]);
 return reply({ok:true,key:b.key,enabled:b.enabled});
}
