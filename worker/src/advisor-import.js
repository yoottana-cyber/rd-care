import {validUsername} from './core.js';
import {passwordHash} from './password.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const text=v=>typeof v==='string'?v.trim():'';
const hex=bytes=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function validate(raw,rooms,accounts){
 const roomLabel=text(raw?.classroom),name=text(raw?.full_name),username=text(raw?.username).toLowerCase();
 const pwd=raw?.password;
 const room=rooms.get(roomLabel);
 let message='',mode='';
 if(!room)message='ไม่พบห้องเรียน '+roomLabel;
 else if(room.advisor_user_id)message='ห้อง '+roomLabel+' มีครูที่ปรึกษาแล้ว กรุณาตรวจสอบ/เปลี่ยนในเมนูครูและระบบ';
 else if(!name||name.length>100||/[\u0000-\u001f\u007f\ufffd]/.test(name))message='ชื่อ–สกุลครูไม่ถูกต้อง';
 else if(!validUsername(username))message='Username ต้องมี 3–40 ตัว (อังกฤษ/ตัวเลข/จุด/ขีด)';
 else if(roomLabel.includes('\ufffd'))message='ชื่อห้องมีอักขระเสียหาย กรุณาบันทึกเป็น CSV UTF-8';
 else{
  const current=accounts.get(username);
  if(current){
   if(current.role!=='teacher'||!current.active)message='Username นี้ไม่ใช่บัญชีครูที่ใช้งาน';
   else if(current.display_name!==name)message='Username มีบัญชีอยู่แล้วแต่ชื่อไม่ตรงกัน';
   else if(pwd!=='')message='บัญชีครูมีอยู่แล้ว ให้เว้น Password ว่างเพื่อผูกห้อง โดยไม่เปลี่ยนรหัสผ่านเดิม';
   else mode='link';
  }else{
   if(typeof pwd!=='string'||pwd.length<12||pwd.length>128||/[\u0000-\u001f\u007f]/.test(pwd))
    message='ครูใหม่ต้องกำหนด Password 12–128 ตัวอักษร';
   else if(/^\d{13}$/.test(pwd))message='ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน';
   else mode='create';
  }
 }
 return {source_row:Number(raw?.source_row)||0,room:roomLabel,full_name:name,username,mode,
  status:message?'error':'ready',message};
}
export function planAdvisorImport(rows,roomMap,existingUsers=[]){
 const accounts=new Map(existingUsers.map(user=>[String(user.username).toLowerCase(),user]));
 const seenRooms=new Set(),seenUsers=new Set();
 const items=rows.map((raw,index)=>{
  const result=validate(raw,roomMap,accounts);
  if(!result.source_row)result.source_row=index+2;
  if(seenRooms.has(result.room))result.message||='ห้องเรียนซ้ำในไฟล์';
  if(seenUsers.has(result.username))result.message||='Username ซ้ำในไฟล์ (กรุณาผูกห้องเพิ่มเติมแยกครั้ง)';
  seenRooms.add(result.room);seenUsers.add(result.username);
  result.status=result.message?'error':'ready';
  return result;
 });
 return {ready:items.length>0&&items.every(x=>x.status==='ready'),
  valid:items.filter(x=>x.status==='ready').length,
  errors:items.filter(x=>x.status==='error').length,items};
}
export async function advisorImportEndpoint(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะ Admin เท่านั้น');
 if(req.method!=='POST')fail(405,'วิธีเรียก API ไม่ถูกต้อง');
 const bodyText=await req.text();
 if(bodyText.length>100000)fail(413,'ข้อมูลใหญ่เกินไป');
 let body;try{body=JSON.parse(bodyText)}catch{fail(400,'JSON ไม่ถูกต้อง')}
 if(!body||!Array.isArray(body.advisors))fail(400,'ต้องส่งรายชื่อ advisors');
 const rows=body.advisors,commit=path.endsWith('/commit');
 if(rows.length<1||rows.length>(commit?5:50))
  fail(400,commit?'บันทึกชุดละไม่เกิน 5 ครู':'ตรวจครั้งละไม่เกิน 50 ครู');
 const [roomData,userData]=await env.DB.batch([
  env.DB.prepare('SELECT id,label,advisor_user_id FROM classrooms'),
  env.DB.prepare("SELECT id,username,display_name,role,active FROM users")
 ]);
 const roomMap=new Map(roomData.results.map(r=>[r.label,r]));
 const plan=planAdvisorImport(rows,roomMap,userData.results);
 if(!commit)return reply(plan);
 if(!plan.ready)fail(409,'พบรายการผิดพลาด กรุณาตรวจสอบรายชื่อครูและห้องเรียนใหม่');
 // Prepare all hashes before any database mutation. D1.batch is transactional.
 const statements=[];
 for(let i=0;i<rows.length;i++){
  const item=plan.items[i],row=rows[i],room=roomMap.get(item.room);
  if(item.mode==='create'){
   const salt=hex(16),hash=await passwordHash(row.password,salt);
   statements.push(env.DB.prepare("INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES(?,?,'teacher',?,?)")
    .bind(item.username,item.full_name,salt,hash));
  }
  statements.push(env.DB.prepare("UPDATE classrooms SET advisor_user_id=(SELECT id FROM users WHERE username=? AND role='teacher' AND active=1) WHERE id=? AND advisor_user_id IS NULL")
   .bind(item.username,room.id));
  statements.push(env.DB.prepare("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'advisor_bulk_assigned','classrooms',?)")
   .bind(user.id,String(room.id)));
 }
 await env.DB.batch(statements);
 return reply({ok:true,assigned:plan.items.length,created:plan.items.filter(x=>x.mode==='create').length});
}
