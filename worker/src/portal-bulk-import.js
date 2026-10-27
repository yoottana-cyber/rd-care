import {passwordHash} from './password.js';
import {validUsername} from './core.js';

// This is a bounded internal transport batch, not a user-facing file/record limit.
// The browser continuously sends chunks until an arbitrary-length selected roster completes.
const CHUNK_SIZE=5;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const clean=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
const validName=v=>!!v&&v.length<=100&&!/[\u0000-\u001f\u007f]/.test(v);
const validStudentName=v=>!!v&&v.length<=120&&!/[\u0000-\u001f\u007f]/.test(v);
const passwordOk=v=>typeof v==='string'&&v.length>=4&&v.length<=128&&
 !/^\d{13}$/.test(v)&&!/[\u0000-\u001f\u007f]/.test(v);
const salt=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store'
}});
// Passwords are intentionally never returned by the API, logged or stored as plain text.
export async function importPortalAccounts(req,env,actor){
 if(actor.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบ');
 const raw=await req.text();
 if(raw.length>60000)fail(413,'ชุดข้อมูลภายในใหญ่เกินไป');
 let body;
 try{body=JSON.parse(raw)}catch{fail(400,'JSON ไม่ถูกต้อง')}
 if(!body||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>CHUNK_SIZE)
  fail(400,'ส่งข้อมูลเป็นชุดย่อยขนาด 1–5 แถว ระบบจะประมวลผลทั้งไฟล์อัตโนมัติ');
 const rows=body.rows;
 if(rows.some(r=>r?.guardian_username)&&body.relationships_verified!==true)
  fail(400,'ต้องยืนยันการตรวจสอบตัวตนและความสัมพันธ์ของผู้ปกครองก่อนนำเข้า');
 const seen=new Set(),seenGuardians=new Map(),plans=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(!row||typeof row!=='object'||Array.isArray(row))fail(400,'ข้อมูลแถวไม่ถูกต้อง');
  const studentNo=clean(row.student_no,40);
  if(!studentNo||studentNo.length>40||/[\u0000-\u001f\u007f]/.test(studentNo))
   fail(400,'แถว '+(i+1)+': เลขประจำตัวนักเรียนไม่ถูกต้อง');
  if(seen.has(studentNo.toLowerCase()))fail(400,'เลขประจำตัวนักเรียนซ้ำภายในชุด: '+studentNo);
  seen.add(studentNo.toLowerCase());
  const student=await env.DB.prepare('SELECT id,full_name,active FROM students WHERE student_no=?')
   .bind(studentNo).first();
  if(!student?.active)fail(404,'ไม่พบเลขประจำตัวนักเรียน '+studentNo+' ในทะเบียน โปรดนำเข้าทะเบียนนักเรียนก่อน');
  const fullName=clean(row.full_name,120);
  if(fullName&&!validStudentName(fullName))fail(400,'แถว '+(i+1)+': ชื่อนักเรียนไม่ถูกต้อง');
  const old=await env.DB.prepare("SELECT id,username FROM portal_accounts WHERE student_id=? AND role='student'")
   .bind(student.id).first();
  const username=clean(row.student_username,40).toLowerCase()||old?.username||studentNo.toLowerCase();
  if(!validUsername(username))fail(400,'แถว '+(i+1)+': Username นักเรียนไม่ถูกต้อง');
  const conflict=await env.DB.prepare('SELECT id FROM portal_accounts WHERE username=? AND id!=?')
   .bind(username,old?.id||0).first();
  if(conflict)fail(409,'แถว '+(i+1)+': Username นักเรียนถูกใช้งานแล้ว');
  const stPass=typeof row.student_password==='string'?row.student_password:'';
  if((!old||stPass)&&!passwordOk(stPass))
   fail(400,'แถว '+(i+1)+': รหัสผ่านนักเรียนใหม่ต้องยาว 4–128 ตัว และไม่ใช่เลขบัตรประชาชน');
  const guardianUsername=clean(row.guardian_username,40).toLowerCase();
  const guardianName=clean(row.guardian_name,100);
  let guardianPass=typeof row.guardian_password==='string'?row.guardian_password:'';
  if(!guardianUsername&&(guardianName||guardianPass))
   fail(400,'แถว '+(i+1)+': กรุณาระบุ Username ผู้ปกครอง');
  let guardian=null;
  if(guardianUsername){
   if(!validUsername(guardianUsername)||username===guardianUsername)
    fail(400,'แถว '+(i+1)+': Username ผู้ปกครองไม่ถูกต้องหรือซ้ำกับนักเรียน');
   guardian=await env.DB.prepare('SELECT id,role,display_name FROM portal_accounts WHERE username=?')
    .bind(guardianUsername).first();
   if(guardian&&guardian.role!=='guardian')fail(409,'แถว '+(i+1)+': Username นี้เป็นบัญชีนักเรียน');
   if((!guardian||guardianName)&&!validName(guardianName))
    fail(400,'แถว '+(i+1)+': ชื่อผู้ปกครองไม่ถูกต้อง');
   const prev=seenGuardians.get(guardianUsername);
   if(prev){
    if(guardianName&&prev.name&&guardianName!==prev.name)
     fail(400,'แถว '+(i+1)+': ข้อมูลชื่อผู้ปกครอง Username เดียวกันไม่ตรงกัน');
    if(guardianPass&&prev.pass&&guardianPass!==prev.pass)
     fail(400,'แถว '+(i+1)+': Password ผู้ปกครอง Username เดียวกันไม่ตรงกัน');
    if(!guardianPass&&!guardian)guardianPass=prev.pass;
   }
   if((!guardian||guardianPass)&&!passwordOk(guardianPass))
    fail(400,'แถว '+(i+1)+': รหัสผ่านผู้ปกครองใหม่ต้องยาว 4–128 ตัว');
   if(!prev)seenGuardians.set(guardianUsername,{name:guardianName,pass:guardianPass});
  }
  plans.push({studentNo,studentId:student.id,student,old,username,fullName,stPass,
   guardianUsername,guardianName,guardianPass,guardian});
 }
 // Cross-role collisions within the same chunk are checked before any DB write.
 const usernames=new Map();
 for(const p of plans){
  for(const [name,role] of [[p.username,'student'],[p.guardianUsername,'guardian']]){
   if(!name)continue;
   const prev=usernames.get(name);
   if(prev&&prev!==role)fail(409,'Username ใช้ซ้ำข้ามประเภทบัญชีในไฟล์');
   if(role==='student'&&prev)fail(409,'Username นักเรียนซ้ำภายในชุด');
   usernames.set(name,role);
  }
 }
 const statements=[],result=[];
 for(const p of plans){
  const displayName=p.fullName||p.student.full_name;
  if(p.fullName&&p.fullName!==p.student.full_name)
   statements.push(statement(env.DB,'UPDATE students SET full_name=? WHERE id=?',
    p.fullName,p.studentId));
  if(p.old){
   const newHash=p.stPass?{salt:salt()}:null;
   if(newHash)newHash.hash=await passwordHash(p.stPass,newHash.salt);
   statements.push(newHash?
    statement(env.DB,`UPDATE portal_accounts SET username=?,display_name=?,active=1,
      password_salt=?,password_hash=?,must_change_password=0 WHERE id=?`,
      p.username,displayName,newHash.salt,newHash.hash,p.old.id):
    statement(env.DB,`UPDATE portal_accounts SET username=?,display_name=?,active=1,
      must_change_password=0 WHERE id=?`,p.username,displayName,p.old.id));
   if(newHash)statements.push(statement(env.DB,
    'DELETE FROM portal_sessions WHERE account_id=?',p.old.id));
  }else{
   const stSalt=salt(),hash=await passwordHash(p.stPass,stSalt);
   statements.push(statement(env.DB,`INSERT INTO portal_accounts
    (username,display_name,role,student_id,password_salt,password_hash,must_change_password,created_by)
    VALUES(?,?,'student',?,?,?,0,?)`,
    p.username,displayName,p.studentId,stSalt,hash,actor.id));
  }
  if(p.guardianUsername){
   if(p.guardian){
    if(p.guardianPass){
     const gSalt=salt(),hash=await passwordHash(p.guardianPass,gSalt);
     statements.push(statement(env.DB,`UPDATE portal_accounts SET display_name=?,
      password_salt=?,password_hash=?,active=1,must_change_password=0 WHERE id=?`,
      p.guardianName||p.guardian.display_name,gSalt,hash,p.guardian.id));
     statements.push(statement(env.DB,'DELETE FROM portal_sessions WHERE account_id=?',p.guardian.id));
    }else statements.push(statement(env.DB,`UPDATE portal_accounts SET display_name=?,
      active=1,must_change_password=0 WHERE id=?`,p.guardianName||p.guardian.display_name,p.guardian.id));
   }else{
    const gSalt=salt(),hash=await passwordHash(p.guardianPass,gSalt);
    statements.push(statement(env.DB,`INSERT INTO portal_accounts
     (username,display_name,role,password_salt,password_hash,must_change_password,created_by)
     VALUES(?,?,'guardian',?,?,0,?)
     ON CONFLICT(username) DO UPDATE SET
      display_name=excluded.display_name,password_salt=excluded.password_salt,
      password_hash=excluded.password_hash,active=1,must_change_password=0
      WHERE portal_accounts.role='guardian'`,
     p.guardianUsername,p.guardianName,gSalt,hash,actor.id));
   }
   statements.push(statement(env.DB,`INSERT INTO guardian_student_links
    (guardian_account_id,student_id,verified_by)
    SELECT a.id,?,? FROM portal_accounts a WHERE a.username=? AND a.role='guardian'
    ON CONFLICT(guardian_account_id,student_id) DO UPDATE SET verified_by=excluded.verified_by`,
    p.studentId,actor.id,p.guardianUsername));
  }
  result.push({student_no:p.studentNo,student_account:p.old?'updated':'created',
   guardian_account:p.guardianUsername?(p.guardian?'updated':'created_or_linked'):'none'});
 }
 statements.push(statement(env.DB,`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
   VALUES(?,'portal_accounts_bulk_upsert','portal_accounts',?)`,actor.id,String(plans.length)));
 await env.DB.batch(statements);
 return respond({ok:true,imported:result.length,items:result},200);
}
