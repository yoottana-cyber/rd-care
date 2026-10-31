import {validUsername} from './core.js';
import {passwordHash,newPasswordSalt} from './password.js';
import {validateUserPassword,userPasswordMinimum} from './user-password-policy.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const text=v=>typeof v==='string'?v.trim():'';
const assignMode=mode=>mode==='skip'||mode==='update';

export function planAdvisorImport(rows,roomMap,existingUsers=[],existingMode='skip'){
 if(!assignMode(existingMode))throw Error('โหมดจัดการครูที่ปรึกษาไม่ถูกต้อง');
 const accounts=new Map(existingUsers.map(u=>[text(u.username).toLowerCase(),u]));
 const slotCounts=new Map(),assignedInFile=new Map(),seenUsers=new Set();
 const items=rows.map((raw,index)=>{
  const roomLabel=text(raw?.classroom),name=text(raw?.full_name),username=text(raw?.username).toLowerCase();
  const pwd=raw?.password,room=roomMap.get(roomLabel),account=accounts.get(username);
  const source_row=Number(raw?.source_row)||index+2;
  const result={source_row,room:roomLabel,full_name:name,username,mode:'',
   status:'ready',message:'',slot:0};
  let reason='';
  if(!room)reason='ไม่พบห้องเรียน '+roomLabel;
  else if(!name||name.length>100||/[\u0000-\u001f\u007f\ufffd]/.test(name))
   reason='ชื่อ–สกุลครูไม่ถูกต้อง';
  else if(!validUsername(username))reason='Username ต้องมี 3–40 ตัว (อังกฤษ/ตัวเลข/จุด/ขีด)';
  else if(roomLabel.includes('\ufffd'))
   reason='ชื่อห้องมีอักขระเสียหาย กรุณาบันทึกเป็น CSV UTF-8';
  else if(seenUsers.has(username))
   reason='Username ซ้ำในไฟล์ (กรุณาผูกห้องเพิ่มเติมแยกครั้ง)';
  else if(account&&(account.role!=='teacher'||!account.active||account.deleted_at))
   reason='Username นี้ไม่ใช่บัญชีครูที่ใช้งาน';
  else if(account&&[room.advisor_user_id,room.advisor2_user_id].includes(account.id)){
   result.slot=room.advisor_user_id===account.id?1:2;
   if(existingMode==='update'&&account.display_name!==name){
    result.mode='update_name';
    result.message='ปรับปรุงชื่อบัญชีครูที่ผูกกับห้องนี้แล้ว โดยไม่เปลี่ยนรหัสผ่านหรือครูอีกคน';
   }else{
    result.mode='skip';
    result.status='skipped';
    result.message='มีครูที่ปรึกษาคนนี้ในห้องแล้ว ข้ามโดยไม่เปลี่ยนข้อมูล';
   }
  }else{
   const pending=slotCounts.get(roomLabel)||0;
   const occupied=(room.advisor_user_id?1:0)+(room.advisor2_user_id?1:0);
   const slot=occupied+pending+1;
   if(slot>2)reason='ห้อง '+roomLabel+' มีครูที่ปรึกษาครบ 2 คนแล้ว (ไม่เขียนทับ)';
   else if(account&&account.display_name!==name&&existingMode==='skip')
    reason='Username นี้มีอยู่แล้วแต่ชื่อไม่ตรงกัน ให้ตรวจตัวตนหรือใช้โหมดอัปเดต';
   else if(!account&&typeof pwd==='string'&&/^\d{13}$/.test(pwd))
    reason='ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน';
   else if(!account&&!validateUserPassword(pwd,'teacher'))
    reason='ครูใหม่ต้องกำหนด Password '+userPasswordMinimum('teacher')+'–128 ตัวอักษร';
   else{
    result.slot=slot;
    result.mode=!account?'create':account.display_name!==name?'link_update':'link';
    result.message=!account?'สร้างบัญชีครูใหม่และผูกห้อง':
     result.mode==='link_update'?'ผูกครูเดิมเข้าห้องใหม่ พร้อมอัปเดตชื่อ ไม่เปลี่ยนรหัสผ่าน':
     'ผูกบัญชีครูที่มีอยู่เข้าห้องว่าง ไม่เปลี่ยนรหัสผ่าน';
    slotCounts.set(roomLabel,pending+1);
    const planned=assignedInFile.get(roomLabel)||new Set();
    planned.add(username);assignedInFile.set(roomLabel,planned);
   }
  }
  seenUsers.add(username);
  if(reason){result.status='error';result.message=reason}
  return result;
 });
 return {ready:items.length>0&&items.every(x=>x.status!=='error'),
  valid:items.filter(x=>x.status==='ready').length,
  errors:items.filter(x=>x.status==='error').length,
  created:items.filter(x=>x.mode==='create').length,
  assigned:items.filter(x=>['create','link','link_update'].includes(x.mode)).length,
  updated:items.filter(x=>['update_name','link_update'].includes(x.mode)).length,
  skipped:items.filter(x=>x.status==='skipped').length,
  items};
}
export async function advisorImportEndpoint(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะ Admin เท่านั้น');
 if(req.method!=='POST')fail(405,'วิธีเรียก API ไม่ถูกต้อง');
 const bodyText=await req.text();
 if(bodyText.length>100000)fail(413,'ข้อมูลใหญ่เกินไป');
 let body;try{body=JSON.parse(bodyText)}catch{fail(400,'JSON ไม่ถูกต้อง')}
 if(!body||!Array.isArray(body.advisors))fail(400,'ต้องส่งรายชื่อ advisors');
 const rows=body.advisors,commit=path.endsWith('/commit'),existingMode=body.existingMode??'skip';
 if(!assignMode(existingMode))fail(400,'โหมดจัดการครูที่ปรึกษาไม่ถูกต้อง');
 if(rows.length<1||rows.length>(commit?5:50))
  fail(400,commit?'บันทึกชุดละไม่เกิน 5 ครู':'ตรวจครั้งละไม่เกิน 50 ครู');
 const [roomData,userData]=await env.DB.batch([
  env.DB.prepare('SELECT id,label,advisor_user_id,advisor2_user_id FROM classrooms'),
  env.DB.prepare('SELECT id,username,display_name,role,active,deleted_at FROM users')
 ]);
 const roomMap=new Map(roomData.results.map(r=>[r.label,r]));
 const plan=planAdvisorImport(rows,roomMap,userData.results,existingMode);
 if(!commit)return reply(plan);
 if(!plan.ready)fail(409,'พบรายการผิดพลาด กรุณาตรวจสอบรายชื่อครูและห้องเรียนใหม่');
 const statements=[];
 for(let i=0;i<rows.length;i++){
  const item=plan.items[i],row=rows[i],room=roomMap.get(item.room);
  if(item.mode==='skip')continue;
  if(item.mode==='create'){
   const salt=newPasswordSalt(),hash=await passwordHash(row.password,salt);
   statements.push(env.DB.prepare(
    "INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES(?,?,'teacher',?,?)"
   ).bind(item.username,item.full_name,salt,hash));
  }
  if(item.mode==='update_name'||item.mode==='link_update'){
   statements.push(env.DB.prepare(
    "UPDATE users SET display_name=? WHERE username=? AND role='teacher' AND active=1 AND deleted_at IS NULL"
   ).bind(item.full_name,item.username));
   statements.push(env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'advisor_bulk_name_updated','users',?)"
   ).bind(user.id,item.username));
  }
  if(['create','link','link_update'].includes(item.mode)){
   const col=item.slot===1?'advisor_user_id':'advisor2_user_id';
   statements.push(env.DB.prepare("UPDATE classrooms SET "+col+
    "=(SELECT id FROM users WHERE username=? AND role='teacher' AND active=1 AND deleted_at IS NULL) "+
    "WHERE id=? AND "+col+" IS NULL").bind(item.username,room.id));
   statements.push(env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'advisor_bulk_assigned','classrooms',?)"
   ).bind(user.id,String(room.id)));
  }
 }
 if(statements.length)await env.DB.batch(statements);
 return reply({ok:true,assigned:plan.assigned,created:plan.created,
  updated:plan.updated,skipped:plan.skipped,
  items:plan.items.map(x=>({...x,status:x.status==='ready'?'imported':x.status}))});
}
