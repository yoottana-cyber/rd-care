// Admin-only personnel import: username is the immutable identity key.
// Modes: skip existing (default) or update existing display name, never reset
// passwords, activate suspended accounts or change privileged roles in bulk.
import {validUsername} from './core.js';
import {passwordHash,newPasswordSalt} from './password.js';
import {validateUserPassword,userPasswordMinimum} from './user-password-policy.js';

const MAX_PREVIEW=50,MAX_COMMIT=5;
const json=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const trim=v=>typeof v==='string'?v.trim():'';
const roles=new Set(['teacher','staff']);
const cleanName=v=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=100&&
 !/[\u0000-\u001f\u007f\ufffd]/.test(v);
const passOk=(password,role)=>validateUserPassword(password,role);

export function planPersonnelImport(rows,existing=[],mode='skip'){
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_PREVIEW)
  throw Error('ตรวจครั้งละ 1–50 รายการ');
 if(!['skip','update'].includes(mode))throw Error('โหมดนำเข้าบุคลากรไม่ถูกต้อง');
 const previous=new Map(existing.map(u=>[trim(u.username).toLowerCase(),u]));
 const seen=new Set();
 const items=rows.map((raw,index)=>{
  const source_row=Number.isSafeInteger(Number(raw?.source_row))&&Number(raw?.source_row)>0
   ?Number(raw.source_row):index+2;
  const username=trim(raw?.username).toLowerCase();
  const display_name=trim(raw?.display_name);
  const role=trim(raw?.role).toLowerCase();
  const password=raw?.password;
  const old=previous.get(username);
  let status='ready',message='';
  if(!validUsername(username))message='Username ต้องมี 3–40 ตัวอักษรอังกฤษ ตัวเลข จุดหรือขีด';
  else if(seen.has(username))message='Username ซ้ำภายในไฟล์';
  else if(!cleanName(raw?.display_name))message='ชื่อ–สกุลไม่ถูกต้องหรือยาวเกิน 100 ตัว';
  else if(!roles.has(role))message='บทบาทต้องเป็น teacher หรือ staff เท่านั้น';
  else if(old?.deleted_at)message='บัญชีนี้เคยถูกลบ ไม่สามารถสร้างซ้ำหรือกู้คืนด้วยการนำเข้า';
  else if(old&&old.role==='admin')message='ไม่อนุญาตให้นำเข้าทับบัญชีผู้ดูแลระบบ';
  else if(old&&old.role!==role&&mode==='update')
   message='บทบาทไม่ตรงกับบัญชีเดิม ต้องแก้ไขสิทธิ์แยกต่างหาก';
  else if(old&&mode==='skip'){
   status='skipped';message='มีบัญชีแล้ว ข้ามโดยไม่แก้ข้อมูลหรือรหัสผ่าน';
  }else if(old&&mode==='update'){
   status='update';message=old.active===0?
    'อัปเดตเฉพาะชื่อที่แสดง (บัญชียังคงถูกพัก รหัสผ่านและสิทธิ์เดิมไม่เปลี่ยน)':
    'อัปเดตเฉพาะชื่อที่แสดง ไม่เปลี่ยนรหัสผ่าน บทบาทหรือสิทธิ์';
  }else if(!passOk(password,role)){
   message='บัญชีใหม่ต้องมี Password '+userPasswordMinimum(role)+
    '–128 ตัว ไม่ใช้เลขประจำตัวประชาชน';
  }else{
   status='ready';message='เพิ่มบุคลากรใหม่';
  }
  seen.add(username);
  if(message&&status==='ready'&&(!old||!passOk(password,role)))status='error';
  // Validation errors always block import, even if file includes other valid rows.
  if(message&&!['skipped','update'].includes(status))status='error';
  return {source_row,username,display_name,role,status,message};
 });
 return {ready:items.every(x=>x.status!=='error'),mode,
  created:items.filter(x=>x.status==='ready').length,
  updated:items.filter(x=>x.status==='update').length,
  skipped:items.filter(x=>x.status==='skipped').length,
  errors:items.filter(x=>x.status==='error').length,items};
}

export async function personnelImportEndpoint(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบ');
 if(req.method!=='POST')fail(405,'วิธีเรียก API ไม่ถูกต้อง');
 const raw=await req.text();
 if(raw.length>100000)fail(413,'ไฟล์นำเข้าบุคลากรใหญ่เกินไป');
 let body;try{body=JSON.parse(raw)}catch{fail(400,'JSON ไม่ถูกต้อง')}
 const commit=path.endsWith('/commit');
 if(!body||!Array.isArray(body.people)||body.people.length<1||
  body.people.length>(commit?MAX_COMMIT:MAX_PREVIEW))
  fail(400,commit?'บันทึกครั้งละ 1–5 คน':'ตรวจสอบครั้งละ 1–50 คน');
 if(!['skip','update'].includes(body.mode))fail(400,'กรุณาเลือกโหมดข้ามหรืออัปเดต');
 const rows=body.people,keys=rows.map(x=>trim(x?.username).toLowerCase())
  .filter(x=>x.length>0);
 const users=keys.length?
  (await env.DB.prepare('SELECT id,username,display_name,role,active,deleted_at FROM users WHERE lower(username) IN ('+
   keys.map(()=>'?').join(',')+')').bind(...keys).all()).results:[];
 const plan=planPersonnelImport(rows,users,body.mode);
 if(!commit)return json(plan);
 if(!plan.ready)fail(409,'พบข้อมูลผิดพลาด กรุณาตรวจสอบก่อนนำเข้าอีกครั้ง');
 if(!plan.created&&!plan.updated)return json({ok:true,created:0,updated:0,
  skipped:plan.skipped,items:plan.items});
 const statements=[];
 for(let i=0;i<rows.length;i++){
  const item=plan.items[i],original=rows[i];
  if(item.status==='ready'){
   const salt=newPasswordSalt(),hash=await passwordHash(original.password,salt);
   statements.push(env.DB.prepare(
    'INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?)'
   ).bind(item.username,item.display_name,item.role,salt,hash));
   statements.push(env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'personnel_import_created','users',?)"
   ).bind(user.id,item.username));
  }else if(item.status==='update'){
   // Additional scope guard at the database write: only existing role matches.
   // Never change role, active, password, student-affairs grant or session.
   statements.push(env.DB.prepare(
    'UPDATE users SET display_name=? WHERE username=? AND role=? AND deleted_at IS NULL'
   ).bind(item.display_name,item.username,item.role));
   statements.push(env.DB.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'personnel_import_updated','users',?)"
   ).bind(user.id,item.username));
  }
 }
 await env.DB.batch(statements);
 return json({ok:true,created:plan.created,updated:plan.updated,
  skipped:plan.skipped,
  items:plan.items.map(x=>({...x,status:x.status==='ready'?'imported':
   x.status==='update'?'updated':x.status}))});
}
