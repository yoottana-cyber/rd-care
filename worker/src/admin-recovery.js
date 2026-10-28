import {passwordHash} from './password.js';
import {validateUserPassword} from './user-password-policy.js';
import {validUsername} from './core.js';

// Recovery is a one-use, secret-protected operation for the school operator.
// No password, token or hash is ever placed in logs or returned in the response.
const deny=(code,message)=>{throw Object.assign(new Error(message),{code})};
const hex=bytes=>[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
};
export async function recoverAdminPassword(req,env){
 if(req.method!=='POST')deny(405,'Method not allowed');
 const length=Number(req.headers.get('content-length')||'0');
 if(length>8192)deny(413,'คำขอใหญ่เกินไป');
 const raw=await req.text();
 if(raw.length>8192)deny(413,'คำขอใหญ่เกินไป');
 let data;
 try{data=JSON.parse(raw)}catch{deny(400,'ข้อมูลไม่ถูกต้อง')}
 if(!data||typeof data!=='object'||Array.isArray(data))deny(400,'ข้อมูลไม่ถูกต้อง');
 const supplied=data.setup_token;
 const secret=env.SETUP_TOKEN;
 if(typeof secret!=='string'||secret.length<32||
  secret==='REPLACE_WITH_A_LONG_RANDOM_ONE_TIME_SECRET')
  deny(503,'กรุณาตั้งค่า SETUP_TOKEN ที่ยาวอย่างน้อย 32 ตัวอักษรใน Cloudflare Worker ก่อน');
 if(typeof supplied!=='string'||!equal(supplied,secret))
  deny(403,'รหัสยืนยันผู้ดูแลระบบไม่ถูกต้อง');
 if(data.confirm!=='RESET-ADMIN-PASSWORD')
  deny(400,'กรุณายืนยันการตั้งรหัสผ่านใหม่');
 if(!validateUserPassword(data.password,'admin'))
  deny(400,'รหัสผ่าน Admin ใหม่ต้องมี 12–128 ตัวอักษร และไม่ใช้เลขประจำตัวประชาชน');
 const {results}=await env.DB.prepare(
  "SELECT id,username FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL ORDER BY id LIMIT 2"
 ).all();
 if(!Array.isArray(results)||results.length>1)
  deny(409,'มีบัญชี Admin ใช้งานอยู่มากกว่าหนึ่งบัญชี กรุณาตรวจสอบสิทธิ์ก่อน');
 const user=results[0]||null;
 const newUsername=String(data.username||'admin').trim().toLowerCase();
 if(!user&&!validUsername(newUsername))
  deny(400,'ชื่อผู้ใช้ Admin ต้องมี 3–40 ตัว และใช้ภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่างเท่านั้น');
 if(!user){
  const existing=await env.DB.prepare('SELECT id FROM users WHERE username=? LIMIT 1').bind(newUsername).first();
  if(existing)deny(409,'ชื่อผู้ใช้ Admin นี้มีอยู่แล้ว กรุณาเลือกชื่ออื่น');
 }
 const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
 const hash=await passwordHash(data.password,salt);
 // Both password recovery and initial administrator creation are one-use
 // operations protected by the same marker and atomic D1.batch transaction.
 try{
  const statements=[env.DB.prepare('INSERT INTO admin_recovery_state(id) VALUES(1)')];
  if(user){
   statements.push(env.DB.prepare(
    "UPDATE users SET password_salt=?,password_hash=? WHERE id=? AND role='admin' AND active=1 AND deleted_at IS NULL"
   ).bind(salt,hash,user.id));
   statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id));
   statements.push(env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(user.username));
   statements.push(env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'admin_password_recovered','users',?)"
   ).bind(user.id,String(user.id)));
  }else{
   statements.push(env.DB.prepare(
    "INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES(?,?,'admin',?,?)"
   ).bind(newUsername,'ผู้ดูแลระบบ',salt,hash));
   statements.push(env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(newUsername));
   statements.push(env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(NULL,'initial_admin_recovered','users',?)"
   ).bind(newUsername));
  }
  await env.DB.batch(statements);
 }catch{
  deny(409,'ไม่สามารถสร้างหรือเปลี่ยนรหัส Admin ได้ อาจเคยใช้สิทธิ์กู้คืนครั้งเดียวแล้ว หรือชื่อผู้ใช้ซ้ำ กรุณาตรวจสอบข้อมูล');
 }
 return Response.json({ok:true,username:user?.username||newUsername,
  message:user?'ตั้งรหัส Admin ใหม่สำเร็จแล้ว':'สร้างบัญชี Admin ใหม่สำเร็จแล้ว'},
  {headers:{'cache-control':'no-store'}});
}
