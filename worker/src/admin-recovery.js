import {passwordHash} from './password.js';
import {validateUserPassword} from './user-password-policy.js';

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
 if(results?.length!==1)
  deny(409,'ต้องมีบัญชี Admin ที่ใช้งานอยู่เพียงบัญชีเดียวจึงจะกู้คืนด้วยวิธีนี้ได้');
 const user=results[0];
 const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
 const hash=await passwordHash(data.password,salt);
 // D1.batch is transactional. A PRIMARY KEY guard makes the recovery
 // one-time even if two authorized requests arrive concurrently.
 try{
  await env.DB.batch([
   env.DB.prepare("INSERT INTO admin_recovery_state(id) VALUES(1)"),
   env.DB.prepare(
    "UPDATE users SET password_salt=?,password_hash=? WHERE id=? AND role='admin' AND active=1 AND deleted_at IS NULL"
   ).bind(salt,hash,user.id),
   env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
   env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(user.username),
   env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'admin_password_recovered','users',?)"
   ).bind(user.id,String(user.id))
  ]);
 }catch{
  deny(409,'เคยกู้คืนรหัส Admin ด้วยวิธีนี้แล้ว หรือฐานข้อมูลไม่พร้อม กรุณาตรวจสอบการตั้งค่าระบบ');
 }
 return Response.json({ok:true,username:user.username,message:'ตั้งรหัส Admin ใหม่สำเร็จแล้ว'},
  {headers:{'cache-control':'no-store'}});
}
