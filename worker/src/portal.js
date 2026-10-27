import {passwordHash} from './password.js';
import {validUsername,validDate,bangkokToday} from './core.js';
import {studentUsername} from './student-username.js';
import {guardianPushRoutes,guardianTruancyItems} from './truancy-push.js';
import {submitStudentLateQr} from './late-qr.js';
import {deliverLateQrPush} from './late-qr-push.js';
import {pushTarget} from './push-target.js';
import {scoreColumns,scoreSummary,caseTypeSql} from './score-ledger.js';

const encoder=new TextEncoder();
const unixNow=()=>Math.floor(Date.now()/1000);
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const randomHex=count=>hex(crypto.getRandomValues(new Uint8Array(count)));
const digest=async v=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(v)));
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const positiveInt=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null};
const secureEqual=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
};
async function bodyJson(req){
 const text=await req.text();
 if(text.length>12000)fail(413,'คำขอมีขนาดใหญ่เกินไป');
 try{const value=JSON.parse(text);if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value}
 catch{fail(400,'รูปแบบ JSON ไม่ถูกต้อง')}
}
function securePassword(value){
 if(typeof value!=='string'||value.length<4||value.length>128||/^\d{13}$/.test(value)||/[\u0000-\u001f\u007f]/.test(value))
  fail(400,'รหัสผ่านใหม่ต้องมีความยาว 4–128 ตัวอักษร');
 return value;
}
function checkedRole(role){if(!['student','guardian'].includes(role))fail(400,'ประเภทบัญชีไม่ถูกต้อง');return role}
const publicAccount=a=>({id:a.id,username:a.username,display_name:a.display_name,role:a.role,must_change_password:!!a.must_change_password});
async function signedIn(req,env){
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer [0-9a-f]{64}$/.test(bearer))fail(401,'กรุณาเข้าสู่ระบบนักเรียนหรือผู้ปกครอง');
 const tokenHash=await digest(bearer.slice(7));
 const a=await env.DB.prepare(`SELECT a.id,a.username,a.display_name,a.role,a.student_id,a.active,a.must_change_password
  FROM portal_sessions p JOIN portal_accounts a ON a.id=p.account_id
  WHERE p.token_hash=? AND p.expires_at>?`).bind(tokenHash,unixNow()).first();
 if(!a?.active)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
 return a;
}
async function login(req,env){
 const b=await bodyJson(req),role=checkedRole(b.role);
 const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
 const pass=typeof b.password==='string'?b.password:'';
 if(!validUsername(username)||pass.length>512)fail(400,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
 const failureKey='portal:'+username;
 const attempts=await env.DB.prepare('SELECT failures,locked_until FROM portal_login_attempts WHERE username=?').bind(failureKey).first();
 if(attempts?.locked_until>unixNow())fail(429,'เข้าสู่ระบบผิดหลายครั้ง กรุณาลองใหม่ภายหลัง');
 const a=await env.DB.prepare('SELECT * FROM portal_accounts WHERE username=? AND active=1').bind(username).first();
 const hash=await passwordHash(pass,a?.password_salt||'not-a-real-portal-user');
 if(!a||a.role!==role||!secureEqual(hash,a.password_hash)){
  const failures=(attempts?.failures||0)+1;
  await env.DB.prepare(`INSERT INTO portal_login_attempts(username,failures,locked_until) VALUES(?,?,?)
    ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until`)
   .bind(failureKey,failures>=5?0:failures,failures>=5?unixNow()+900:0).run();
  fail(401,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
 }
 await env.DB.prepare('DELETE FROM portal_login_attempts WHERE username=?').bind(failureKey).run();
 // Student/guardian accounts are remembered only after choosing the option and
 // never while a first-login password change is required.
 const sessionSeconds=b.remember===true&&!a.must_change_password?30*86400:8*3600;
 const token=randomHex(32);
 await env.DB.prepare('INSERT INTO portal_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)')
  .bind(await digest(token),a.id,unixNow()+sessionSeconds).run();
 return reply({token,account:publicAccount(a),expires_in:sessionSeconds});
}
async function changePassword(req,env,a){
 const b=await bodyJson(req);
 const oldPass=typeof b.current_password==='string'?b.current_password:'';
 const next=securePassword(b.new_password);
 const stored=await env.DB.prepare('SELECT password_salt,password_hash FROM portal_accounts WHERE id=?').bind(a.id).first();
 if(!stored||!secureEqual(await passwordHash(oldPass,stored.password_salt),stored.password_hash))
  fail(403,'รหัสผ่านปัจจุบันไม่ถูกต้อง');
 if(oldPass===next)fail(400,'รหัสผ่านใหม่ต้องต่างจากรหัสเดิม');
 const salt=randomHex(16),hash=await passwordHash(next,salt);
 await env.DB.batch([
  env.DB.prepare('UPDATE portal_accounts SET password_salt=?,password_hash=?,must_change_password=0 WHERE id=?')
   .bind(salt,hash,a.id),
  env.DB.prepare('DELETE FROM portal_sessions WHERE account_id=?').bind(a.id)
 ]);
 return reply({ok:true,message:'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่'});
}
async function children(env,a){
 if(a.role==='student'){
  const {results}=await env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,c.label AS classroom_label
    FROM students s JOIN classrooms c ON c.id=s.classroom_id
    WHERE s.id=? AND s.active=1`).bind(a.student_id).all();
  return results;
 }
 const {results}=await env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,c.label AS classroom_label
  FROM guardian_student_links link
  JOIN students s ON s.id=link.student_id AND s.active=1
  JOIN classrooms c ON c.id=s.classroom_id
  WHERE link.guardian_account_id=? ORDER BY s.full_name LIMIT 20`).bind(a.id).all();
 return results;
}
async function records(req,env,a){
 const q=new URL(req.url).searchParams,id=positiveInt(q.get('student_id'));
 if(!id)fail(400,'กรุณาเลือกนักเรียน');
 const from=q.get('from'),to=q.get('to');
 if(!validDate(from)||!validDate(to)||from>to||
  Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>89*86400000)
  fail(400,'ช่วงวันที่ไม่ถูกต้อง (สูงสุด 90 วัน)');
 const linked=await env.DB.prepare(`SELECT s.id,s.full_name,s.student_no,c.label AS classroom_label
  FROM students s JOIN classrooms c ON c.id=s.classroom_id
  WHERE s.id=? AND s.active=1 AND (
    (?='student' AND s.id=?)
    OR (?='guardian' AND EXISTS(SELECT 1 FROM guardian_student_links g WHERE g.guardian_account_id=? AND g.student_id=s.id))
  )`).bind(id,a.role,a.student_id||0,a.role,a.id).first();
 if(!linked)fail(403,'ไม่มีสิทธิ์ดูข้อมูลนักเรียนคนนี้');
 // Every child query is bound to the authorized student id: never expose class rosters.
 const [daily,period,late,behavior,total]=await env.DB.batch([
  env.DB.prepare(`SELECT school_date,status FROM attendance_daily
   WHERE student_id=? AND school_date BETWEEN ? AND ? ORDER BY school_date DESC LIMIT 90`).bind(id,from,to),
  env.DB.prepare(`SELECT p.school_date,
     CASE WHEN tr.student_id IS NOT NULL AND p.status='absent' THEN 'truancy' ELSE p.status END AS status,
     t.period,t.subject FROM attendance_period p
    JOIN timetable t ON t.id=p.timetable_id
    LEFT JOIN period_truancy tr ON tr.student_id=p.student_id
     AND tr.timetable_id=p.timetable_id AND tr.school_date=p.school_date
    WHERE p.student_id=? AND p.school_date BETWEEN ? AND ?
    ORDER BY p.school_date DESC,t.period LIMIT 500`).bind(id,from,to),
  env.DB.prepare(`SELECT school_date,arrived_at,state FROM late_records
    WHERE student_id=? AND school_date BETWEEN ? AND ?
    ORDER BY school_date DESC LIMIT 90`).bind(id,from,to),
  env.DB.prepare(`SELECT substr(b.created_at,1,10) AS record_date,b.points,b.reason,
    b.affairs_category,${caseTypeSql('b')} AS score_type FROM behavior_records b
    WHERE b.student_id=? AND substr(b.created_at,1,10) BETWEEN ? AND ?
    ORDER BY b.id DESC LIMIT 100`).bind(id,from,to),
  env.DB.prepare(`SELECT ${scoreColumns('b')} FROM behavior_records b
    WHERE b.student_id=? AND substr(b.created_at,1,10) BETWEEN ? AND ?`).bind(id,from,to)
 ]);
 const rows=behavior.results||[],scores=scoreSummary(total.results?.[0]);
 return reply({student:linked,from,to,daily:daily.results||[],period:period.results||[],
  late:late.results||[],behavior:rows.filter(x=>x.score_type!=='good'),
  good:rows.filter(x=>x.score_type==='good'),
  behavior_total:-scores.behavior_remaining,...scores,
  note:'คะแนนความดีแยกจากคะแนนพฤติกรรม • ลดคะแนนพฤติกรรมได้เฉพาะเกณฑ์ปรับพฤติกรรม'});
}
export async function portalRoutes(req,env,path,ctx){
 if(req.method==='POST'&&path==='/api/portal/auth/login')return login(req,env);
 const a=await signedIn(req,env);
 if(req.method==='POST'&&path==='/api/portal/auth/logout'){
  const tokenHash=await digest((req.headers.get('authorization')||'').slice(7));
  await env.DB.prepare('DELETE FROM portal_sessions WHERE token_hash=?').bind(tokenHash).run();
  return reply({ok:true});
 }
 if(req.method==='GET'&&path==='/api/portal/auth/me')return reply({account:publicAccount(a)});
 if(req.method==='POST'&&path==='/api/portal/auth/change-password')return changePassword(req,env,a);
 if(a.must_change_password)fail(403,'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนดูข้อมูลนักเรียน');
 if(req.method==='POST'&&path==='/api/portal/late/qr'){
  const result=await submitStudentLateQr(req,env,a);
  // Send only after a committed successful record; do not block the student's receipt.
  if(result.ok&&ctx?.waitUntil)
   ctx.waitUntil(deliverLateQrPush(env).catch(err=>console.warn('RD QR Push',err?.name||'failure')));
  return result;
 }
 if(req.method==='GET'&&path==='/api/portal/push/target')return pushTarget(req,env,a,'guardian');
 if(path.startsWith('/api/portal/push/'))return guardianPushRoutes(req,env,a,path);
 if(req.method==='GET'&&path==='/api/portal/truancy'){
   const q=new URL(req.url).searchParams,from=q.get('from'),to=q.get('to');
   let range=null;
   if(from!==null||to!==null){
    if(!validDate(from)||!validDate(to)||from>to||
      Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>89*86400000)
     fail(400,'ช่วงวันที่ไม่ถูกต้อง (สูงสุด 90 วัน)');
    range={from,to};
   }
   return reply({items:await guardianTruancyItems(env,a,range)});
  }
 if(req.method==='GET'&&path==='/api/portal/children')return reply({items:await children(env,a)});
 if(req.method==='GET'&&path==='/api/portal/records')return records(req,env,a);
 fail(404,'ไม่พบ API');
}
async function audit(db,actor,action,id){
 await db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
 .bind(actor,action,'portal_accounts',String(id)).run();
}
export async function portalAdminRoutes(req,env,actor,path){
 if(actor.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบ');
 if(req.method==='GET'&&path==='/api/admin/portal/accounts'){
  const {results}=await env.DB.prepare(`SELECT a.id,a.username,a.display_name,a.role,a.student_id,a.active,a.must_change_password,
  s.student_no FROM portal_accounts a LEFT JOIN students s ON s.id=a.student_id
  ORDER BY a.role,a.id DESC LIMIT 3000`).all();
  return reply({items:results});
 }
 if(req.method==='GET'&&path==='/api/admin/portal/links'){
  const {results}=await env.DB.prepare(`SELECT l.guardian_account_id,l.student_id,
    a.display_name AS guardian_name,s.student_no,s.full_name
    FROM guardian_student_links l
    JOIN portal_accounts a ON a.id=l.guardian_account_id JOIN students s ON s.id=l.student_id
    ORDER BY l.guardian_account_id,l.student_id LIMIT 4000`).all();
  return reply({items:results});
 }
 if(req.method==='POST'&&path==='/api/admin/portal/accounts'){
  const b=await bodyJson(req),role=checkedRole(b.role);
  let username='',studentId=null,displayName;
  if(role==='student'){
   studentId=positiveInt(b.student_id);
   if(!studentId)fail(400,'กรุณาเลือกนักเรียน');
   const st=await env.DB.prepare('SELECT id,student_no,full_name FROM students WHERE id=? AND active=1').bind(studentId).first();
   if(!st)fail(404,'ไม่พบนักเรียนที่ใช้งานอยู่');
   // Student number remains the default; Admin may choose another login ID.
   username=b.username===undefined||!String(b.username).trim()
     ?studentUsername(st):String(b.username).trim().toLowerCase();
   if(!validUsername(username))fail(400,'Username ต้องมี 3–40 ตัวอักษร ภาษาอังกฤษ ตัวเลข จุด หรือขีด');
   displayName=st.full_name;
  }else{
   username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
   if(!validUsername(username))fail(400,'Username ต้องมี 3–40 ตัวอักษร');
   displayName=typeof b.display_name==='string'?b.display_name.trim():'';
   if(!displayName||displayName.length>100||/[\u0000-\u001f\u007f]/.test(displayName))
    fail(400,'กรุณากรอกชื่อผู้ปกครองไม่เกิน 100 ตัวอักษร');
  }
  const chosen=b.password!==undefined;
  const password=chosen?String(b.password):randomHex(16);
  if(password.length<4||password.length>128)
   fail(400,'รหัสผ่านต้องมีความยาว 4–128 ตัวอักษร');
  if(/^\d{13}$/.test(password))fail(400,'ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน');
  const salt=randomHex(16),hash=await passwordHash(password,salt);
  const result=await env.DB.prepare(`INSERT INTO portal_accounts
   (username,display_name,role,student_id,password_salt,password_hash,created_by)
   VALUES(?,?,?,?,?,?,?)`).bind(username,displayName,role,studentId,salt,hash,actor.id).run();
  await audit(env.DB,actor.id,'portal_account_created',result.meta.last_row_id);
  return reply({ok:true,id:result.meta.last_row_id,username,role,temporary_password:chosen?null:password,
    message:'รหัสผ่านชั่วคราวแสดงเพียงครั้งเดียว โปรดแจ้งเจ้าของบัญชีที่ยืนยันตัวตนแล้วเป็นการส่วนตัว'},201);
 }
 if(req.method==='POST'&&path==='/api/admin/portal/links'){
  const b=await bodyJson(req),guardian=positiveInt(b.guardian_account_id),student=positiveInt(b.student_id);
  if(!guardian||!student||b.identity_verified!==true)
   fail(400,'ต้องตรวจสอบตัวตนและความสัมพันธ์ก่อนผูกบัญชีผู้ปกครอง');
  const account=await env.DB.prepare(`SELECT id FROM portal_accounts
   WHERE id=? AND role='guardian' AND active=1`).bind(guardian).first();
  const st=await env.DB.prepare('SELECT id FROM students WHERE id=? AND active=1').bind(student).first();
  if(!account||!st)fail(404,'ไม่พบบัญชีผู้ปกครองหรือนักเรียนที่ใช้งานอยู่');
  await env.DB.batch([
   env.DB.prepare('INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)').bind(guardian,student,actor.id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(actor.id,'guardian_student_linked','students',String(student))
  ]);
  return reply({ok:true,message:'ผูกบัญชีผู้ปกครองกับนักเรียนสำเร็จ'},201);
 }
 const unlink=/^\/api\/admin\/portal\/links\/(\d+)\/(\d+)\/revoke$/.exec(path);
 if(req.method==='POST'&&unlink){
  const guardian=positiveInt(unlink[1]),student=positiveInt(unlink[2]);
  const result=await env.DB.prepare('DELETE FROM guardian_student_links WHERE guardian_account_id=? AND student_id=?')
   .bind(guardian,student).run();
  if(result.meta.changes!==1)fail(404,'ไม่พบความสัมพันธ์นี้');
  await audit(env.DB,actor.id,'guardian_link_revoked',guardian);
  return reply({ok:true});
 }
 const accountAction=/^\/api\/admin\/portal\/accounts\/(\d+)\/(reset|status)$/.exec(path);
 if(req.method==='POST'&&accountAction){
  const id=positiveInt(accountAction[1]),action=accountAction[2];
  const account=await env.DB.prepare('SELECT id,role,active FROM portal_accounts WHERE id=?').bind(id).first();
  if(!account)fail(404,'ไม่พบบัญชี');
  if(action==='status'){
   const b=await bodyJson(req);
   if(b.active!==0&&b.active!==1)fail(400,'สถานะไม่ถูกต้อง');
   await env.DB.batch([
    env.DB.prepare('UPDATE portal_accounts SET active=? WHERE id=?').bind(b.active,id),
    env.DB.prepare('DELETE FROM portal_sessions WHERE account_id=?').bind(id),
    env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
     .bind(actor.id,'portal_status_changed','portal_accounts',String(id))
   ]);
   return reply({ok:true});
  }
  const password=randomHex(16),salt=randomHex(16),hash=await passwordHash(password,salt);
  await env.DB.batch([
   env.DB.prepare('UPDATE portal_accounts SET password_salt=?,password_hash=?,must_change_password=1 WHERE id=?')
    .bind(salt,hash,id),
   env.DB.prepare('DELETE FROM portal_sessions WHERE account_id=?').bind(id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(actor.id,'portal_password_reset','portal_accounts',String(id))
  ]);
  return reply({ok:true,temporary_password:password,
   message:'รหัสผ่านใหม่แสดงเพียงครั้งเดียวและต้องเปลี่ยนเมื่อเข้าสู่ระบบ'});
 }
 fail(404,'ไม่พบ API');
}
