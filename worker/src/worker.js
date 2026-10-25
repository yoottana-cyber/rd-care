import { STATUS, isAdmin, isStaff, validDate, bangkokToday, weekday, schoolDateAllowed, validateEntries, cleanText, validUsername, httpErrorStatus } from './core.js';
import { passwordHash } from './password.js';
import { validateStudentInput, validatePersonnelInput } from './admin-validation.js';

const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const hex = (bytes) => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const randomHex = (count) => hex(crypto.getRandomValues(new Uint8Array(count)));
const digest = async (str) => hex(await crypto.subtle.digest('SHA-256',encoder.encode(str)));

function equalHash(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let mismatch=0;
 for(let i=0;i<a.length;i++) mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
 return mismatch===0;
}
function error(code,message){return Object.assign(new Error(message),{code});}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});}
async function payload(request){
 const length=Number(request.headers.get('content-length')||'0');
 if(length>200000)throw error(413,'คำขอมีขนาดใหญ่เกินไป');
 let text=await request.text();
 if(text.length>200000)throw error(413,'คำขอมีขนาดใหญ่เกินไป');
 try {const value=JSON.parse(text); if(!value || typeof value!=='object'||Array.isArray(value))throw Error(); return value;}
 catch {throw error(400,'รูปแบบ JSON ไม่ถูกต้อง');}
}
function positiveInt(v){const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function requireDate(date){if(!validDate(date))throw error(400,'รูปแบบวันที่ต้องเป็น YYYY-MM-DD');}
function requireWriteDate(date){if(!schoolDateAllowed(date))throw error(400,'บันทึกย้อนหลังได้ไม่เกิน 14 วัน และห้ามบันทึกล่วงหน้า');}
function requireRole(user,roles){if(!roles.includes(user.role))throw error(403,'ไม่มีสิทธิ์ดำเนินการ');}
function requiredText(value,max=120){const v=cleanText(value,max);if(!v)throw error(400,'กรุณากรอกข้อมูลให้ครบ');return v;}
async function log(db,actor,action,type,id){await db.prepare('INSERT INTO audit_logs (actor_id,action,entity_type,entity_id) VALUES (?,?,?,?)').bind(actor,action,type,String(id)).run();}
async function currentUser(req,env){
 const auth=req.headers.get('authorization')||'';
 if(!/^Bearer [0-9a-f]{64}$/.test(auth))throw error(401,'กรุณาเข้าสู่ระบบ');
 const tokenHash=await digest(auth.slice(7));
 const u=await env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.active FROM sessions s
 JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash,now()).first();
 if(!u?.active)throw error(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
 return u;
}
async function userRoomAccess(env,user,roomId,kind='view'){
 if(isStaff(user))return true;
 if(user.role!=='teacher')return false;
 const room=await env.DB.prepare('SELECT advisor_user_id FROM classrooms WHERE id=?').bind(roomId).first();
 if(!room)return false;
 if(kind==='daily')return room.advisor_user_id===user.id;
 if(kind==='view' && room.advisor_user_id===user.id)return true;
 const timetable=await env.DB.prepare('SELECT id FROM timetable WHERE classroom_id=? AND teacher_user_id=? AND active=1 LIMIT 1').bind(roomId,user.id).first();
 return !!timetable;
}
async function assertRoom(env,user,roomId,kind='view'){
 if(!roomId)throw error(400,'กรุณาเลือกห้องเรียน');
 if(!await userRoomAccess(env,user,roomId,kind))throw error(403,'ไม่สามารถเข้าถึงห้องเรียนนี้');
}
async function studentAccess(env,user,studentId){
 const st=await env.DB.prepare('SELECT id,classroom_id,full_name FROM students WHERE id=? AND active=1').bind(studentId).first();
 if(!st)throw error(404,'ไม่พบนักเรียน');
 await assertRoom(env,user,st.classroom_id);
 return st;
}
async function login(req,env){
 const b=await payload(req);
 const username=String(b.username||'').trim().toLowerCase();
 const password=String(b.password||'');
 if(!validUsername(username)||password.length>512)throw error(400,'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');
 const check=await env.DB.prepare('SELECT failures,locked_until FROM login_attempts WHERE username=?').bind(username).first();
 if(check?.locked_until>now())throw error(429,'ล็อกอินผิดหลายครั้ง กรุณาลองใหม่ภายหลัง');
 const user=await env.DB.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(username).first();
 const hash=user?await passwordHash(password,user.password_salt):await passwordHash(password,'not-a-real-user-salt');
 if(!user||!equalHash(user.password_hash,hash)){
  const failures=(check?.failures||0)+1;
  const lockUntil=failures>=5?now()+900:0;
  await env.DB.prepare(`INSERT INTO login_attempts(username,failures,locked_until) VALUES(?,?,?)
    ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until`)
   .bind(username,failures>=5?0:failures,lockUntil).run();
  throw error(401,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
 }
 await env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
 const token=randomHex(32);
 await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
  .bind(await digest(token),user.id,now()+8*3600).run();
 return json({token,user:{id:user.id,username:user.username,display_name:user.display_name,role:user.role},expires_in:8*3600});
}
async function setup(req,env){
 if(!env.SETUP_TOKEN||env.SETUP_TOKEN==='REPLACE_WITH_A_LONG_RANDOM_ONE_TIME_SECRET')throw error(503,'ยังไม่ได้ตั้งค่า SETUP_TOKEN');
 const supplied=req.headers.get('x-setup-token')||'';
 if(!equalHash(supplied,env.SETUP_TOKEN))throw error(403,'รหัสตั้งค่าระบบไม่ถูกต้อง');
 const exists=await env.DB.prepare('SELECT id FROM users LIMIT 1').first();
 if(exists)throw error(409,'ระบบมีบัญชีผู้ใช้งานแล้ว ไม่สามารถตั้งค่าเริ่มต้นซ้ำ');
 const b=await payload(req);
 const username=String(b.username||'').trim().toLowerCase(), pass=String(b.password||'');
 if(!validUsername(username)||pass.length<12||pass.length>128)throw error(400,'ชื่อผู้ใช้ 3–40 ตัว และรหัสผ่าน 12–128 ตัว');
 const salt=randomHex(16),hash=await passwordHash(pass,salt);
 const result=await env.DB.prepare('INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?)')
  .bind(username,requiredText(b.display_name,100),'admin',salt,hash).run();
 await log(env.DB,result.meta.last_row_id,'initial_setup','users',result.meta.last_row_id);
 return json({ok:true,message:'สร้างผู้ดูแลระบบสำเร็จ'},201);
}
async function classrooms(env,user){
 const q=isStaff(user)?'SELECT * FROM classrooms ORDER BY grade,room':
  `SELECT DISTINCT c.* FROM classrooms c LEFT JOIN timetable t ON t.classroom_id=c.id AND t.teacher_user_id=? AND t.active=1
   WHERE c.advisor_user_id=? OR t.id IS NOT NULL ORDER BY c.grade,c.room`;
 const stmt=env.DB.prepare(q);
 const {results}=await (isStaff(user)?stmt:stmt.bind(user.id,user.id)).all();
 return json({items:results});
}
async function getStudents(req,env,user){
 const roomId=positiveInt(new URL(req.url).searchParams.get('classroom_id'));
 await assertRoom(env,user,roomId);
 const {results}=await env.DB.prepare('SELECT id,student_no,roll_no,full_name FROM students WHERE classroom_id=? AND active=1 ORDER BY roll_no').bind(roomId).all();
 return json({items:results});
}
async function getTimetable(req,env,user){
 const url=new URL(req.url);
 const date=url.searchParams.get('date')||bangkokToday(); requireDate(date);
 const day=weekday(date);
 const roomId=positiveInt(url.searchParams.get('classroom_id'));
 let query=`SELECT t.id,t.classroom_id,t.teacher_user_id,t.day_of_week,t.period,t.subject,c.label AS classroom_label,u.display_name AS teacher_name
  FROM timetable t JOIN classrooms c ON c.id=t.classroom_id JOIN users u ON u.id=t.teacher_user_id
  WHERE t.active=1 AND t.day_of_week=?`;
 const args=[day];
 if(roomId){await assertRoom(env,user,roomId);query+=' AND t.classroom_id=?';args.push(roomId);}
 if(!isStaff(user)){
  query+=` AND (t.teacher_user_id=? OR c.advisor_user_id=?)`;
  args.push(user.id,user.id);
 }
 query+=' ORDER BY t.period,c.grade,c.room';
 const {results}=await env.DB.prepare(query).bind(...args).all();
 return json({items:results});
}
async function getAttendance(req,env,user){
 const q=new URL(req.url).searchParams;
 const roomId=positiveInt(q.get('classroom_id'));
 const kind=q.get('kind');const date=q.get('date')||bangkokToday();
 requireDate(date);await assertRoom(env,user,roomId);
 if(kind==='daily'){
  const {results}=await env.DB.prepare(`SELECT a.student_id,a.status FROM attendance_daily a JOIN students s ON s.id=a.student_id WHERE s.classroom_id=? AND a.school_date=?`).bind(roomId,date).all();
  return json({items:results});
 }
 if(kind==='period'){
  const timetableId=positiveInt(q.get('timetable_id'));
  const slot=await env.DB.prepare('SELECT id,classroom_id FROM timetable WHERE id=? AND active=1').bind(timetableId).first();
  if(!slot||slot.classroom_id!==roomId)throw error(400,'คาบเรียนไม่สัมพันธ์กับห้อง');
  const {results}=await env.DB.prepare('SELECT student_id,status FROM attendance_period WHERE timetable_id=? AND school_date=?').bind(timetableId,date).all();
  return json({items:results});
 }
 throw error(400,'ประเภทการเช็กชื่อไม่ถูกต้อง');
}
async function writeAttendance(req,env,user){
 const b=await payload(req),roomId=positiveInt(b.classroom_id);
 const kind=b.kind,date=b.date;
 requireWriteDate(date);
 if(!['daily','period'].includes(kind))throw error(400,'กรุณาเลือกประเภทการเช็กชื่อ');
 await assertRoom(env,user,roomId,kind==='daily'?'daily':'view');
 const {results:students}=await env.DB.prepare('SELECT id FROM students WHERE classroom_id=? AND active=1 ORDER BY roll_no').bind(roomId).all();
 if(!students.length)throw error(400,'ห้องเรียนยังไม่มีนักเรียน');
 const ids=new Set(students.map(x=>x.id));
 if(!validateEntries(b.entries,ids))throw error(400,'รายการต้องมีนักเรียนทุกคนในห้อง สถานะถูกต้อง และไม่ซ้ำกัน');
 const stmts=[];
 let slot;
 if(kind==='period'){
  const tId=positiveInt(b.timetable_id);
  slot=await env.DB.prepare('SELECT id,classroom_id,teacher_user_id,day_of_week FROM timetable WHERE id=? AND active=1').bind(tId).first();
  if(!slot||slot.classroom_id!==roomId||slot.day_of_week!==weekday(date))throw error(400,'คาบเรียนหรือวันเรียนไม่ตรงกับตารางสอน');
  if(!isStaff(user)&&slot.teacher_user_id!==user.id)throw error(403,'ครูไม่มีสิทธิ์บันทึกคาบเรียนนี้');
 }
 for(const e of b.entries){
  if(kind==='daily'){
   stmts.push(env.DB.prepare(`INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,?,?)
     ON CONFLICT(student_id,school_date) DO UPDATE SET status=excluded.status,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(e.student_id,date,e.status,user.id));
  }else{
   stmts.push(env.DB.prepare(`INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(?,?,?,?,?)
     ON CONFLICT(student_id,timetable_id,school_date) DO UPDATE SET status=excluded.status,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(e.student_id,slot.id,date,e.status,user.id));
   if(e.status==='absent'){
    stmts.push(env.DB.prepare(`INSERT INTO attendance_alerts(student_id,timetable_id,school_date,state)
      VALUES(?,?,?,'pending_review') ON CONFLICT(student_id,timetable_id,school_date) DO UPDATE SET
      state=CASE WHEN attendance_alerts.state='resolved' THEN 'pending_review' ELSE attendance_alerts.state END`)
     .bind(e.student_id,slot.id,date));
    // Record an internal review request for the class advisor, not a Push send.
    stmts.push(env.DB.prepare(`INSERT INTO notification_outbox(alert_id,event_type,audience,state)
      SELECT id,'attendance_review_requested','advisor','pending'
      FROM attendance_alerts
      WHERE student_id=? AND timetable_id=? AND school_date=? AND state='pending_review'
      ON CONFLICT(alert_id,event_type,audience) DO UPDATE SET
      state=CASE WHEN notification_outbox.state='cancelled' THEN 'pending' ELSE notification_outbox.state END,
      updated_at=CURRENT_TIMESTAMP`).bind(e.student_id,slot.id,date));
   }else{
    stmts.push(env.DB.prepare(`UPDATE attendance_alerts SET state='resolved',reviewed_by=? ,reviewed_at=CURRENT_TIMESTAMP
      WHERE student_id=? AND timetable_id=? AND school_date=? AND state!='resolved'`).bind(user.id,e.student_id,slot.id,date));
    // If the student is actually present/late/on leave, cancel pending events.
    // Delivered events remain in the audit trail for future retraction handling.
    stmts.push(env.DB.prepare(`UPDATE notification_outbox SET state='cancelled',updated_at=CURRENT_TIMESTAMP
      WHERE state='pending' AND alert_id IN (
      SELECT id FROM attendance_alerts
      WHERE student_id=? AND timetable_id=? AND school_date=?)`).bind(e.student_id,slot.id,date));
   }
  }
 }
 stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
  .bind(user.id,'attendance_saved',kind,`${date}:${roomId}:${slot?.id||0}`));
 await env.DB.batch(stmts);
 return json({ok:true,saved:b.entries.length,message:'บันทึกสำเร็จ (กรณีขาดรายคาบจะรอการตรวจสอบก่อนแจ้งผู้ปกครอง)'});
}
async function addLate(req,env,user){
 const b=await payload(req),stId=positiveInt(b.student_id);
 const st=await studentAccess(env,user,stId);
 const date=b.date||bangkokToday(); requireWriteDate(date);
 const arrivedAt=String(b.arrived_at||'');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivedAt))throw error(400,'เวลาไม่ถูกต้อง');
 const state=isStaff(user)?'verified':'pending';
 const result=await env.DB.prepare(`INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
 VALUES(?,?,?,?,?,?,?)`).bind(st.id,date,arrivedAt,cleanText(b.reason,300),state,user.id,isStaff(user)?user.id:null).run();
 await log(env.DB,user.id,'late_created','late_records',result.meta.last_row_id);
 return json({ok:true,id:result.meta.last_row_id,state},201);
}
async function listLate(req,env,user){
 const q=new URL(req.url).searchParams,roomId=positiveInt(q.get('classroom_id'));
 await assertRoom(env,user,roomId);
 const date=q.get('date')||bangkokToday();requireDate(date);
 const {results}=await env.DB.prepare(`SELECT l.id,s.roll_no,s.full_name,l.arrived_at,l.reason,l.state FROM late_records l JOIN students s ON s.id=l.student_id
 WHERE s.classroom_id=? AND l.school_date=? ORDER BY l.arrived_at DESC`).bind(roomId,date).all();
 return json({items:results});
}
async function addBehavior(req,env,user){
 const b=await payload(req),stId=positiveInt(b.student_id);
 await studentAccess(env,user,stId);
 if(!Number.isSafeInteger(b.points)||b.points===0||Math.abs(b.points)>50)throw error(400,'คะแนนต้องเป็นจำนวนเต็ม -50 ถึง 50 และไม่เท่ากับศูนย์');
 const reason=requiredText(b.reason,300);
 const result=await env.DB.prepare('INSERT INTO behavior_records(student_id,points,reason,recorded_by) VALUES(?,?,?,?)')
  .bind(stId,b.points,reason,user.id).run();
 await log(env.DB,user.id,'behavior_created','behavior_records',result.meta.last_row_id);
 return json({ok:true,id:result.meta.last_row_id},201);
}
async function listBehavior(req,env,user){
 const stId=positiveInt(new URL(req.url).searchParams.get('student_id'));
 await studentAccess(env,user,stId);
 const {results}=await env.DB.prepare(`SELECT b.id,b.points,b.reason,b.created_at,u.display_name AS teacher_name FROM behavior_records b
 JOIN users u ON u.id=b.recorded_by WHERE b.student_id=? ORDER BY b.id DESC LIMIT 40`).bind(stId).all();
 const summary=await env.DB.prepare('SELECT COALESCE(SUM(points),0) total FROM behavior_records WHERE student_id=?').bind(stId).first();
 return json({items:results,total:summary.total});
}
async function listAlerts(req,env,user){
 const q=new URL(req.url).searchParams;
 const roomId=positiveInt(q.get('classroom_id'));
 await assertRoom(env,user,roomId,'view');
 if(!isStaff(user)){
  const room=await env.DB.prepare('SELECT advisor_user_id FROM classrooms WHERE id=?').bind(roomId).first();
  if(room?.advisor_user_id!==user.id)throw error(403,'เฉพาะครูที่ปรึกษาของห้องนี้เท่านั้น');
 }
 const {results}=await env.DB.prepare(`SELECT a.id,a.school_date,a.state,s.roll_no,s.full_name,t.period,t.subject
  FROM attendance_alerts a JOIN students s ON s.id=a.student_id JOIN timetable t ON t.id=a.timetable_id
  WHERE s.classroom_id=? AND a.state='pending_review' ORDER BY a.school_date DESC,t.period DESC LIMIT 50`).bind(roomId).all();
 return json({items:results});
}
async function reviewAlert(req,env,user,id){
 const b=await payload(req);
 if(!['confirmed','resolved'].includes(b.state))throw error(400,'สถานะไม่ถูกต้อง');
 const record=await env.DB.prepare(`SELECT a.id,a.student_id,a.school_date,a.timetable_id,a.state,s.classroom_id
 FROM attendance_alerts a JOIN students s ON s.id=a.student_id WHERE a.id=?`).bind(id).first();
 if(!record)throw error(404,'ไม่พบรายการ');
 await assertRoom(env,user,record.classroom_id);
 if(!isStaff(user)){
  const room=await env.DB.prepare('SELECT advisor_user_id FROM classrooms WHERE id=?').bind(record.classroom_id).first();
  if(room?.advisor_user_id!==user.id)throw error(403,'เฉพาะครูที่ปรึกษา');
 }
 if(record.state!=='pending_review')throw error(409,'รายการนี้ได้รับการตรวจสอบแล้ว');
 if(b.state==='confirmed'){
  const att=await env.DB.prepare(`SELECT status FROM attendance_period WHERE student_id=? AND timetable_id=? AND school_date=?`)
   .bind(record.student_id,record.timetable_id,record.school_date).first();
  if(att?.status!=='absent')throw error(409,'สถานะการเช็กชื่อเปลี่ยนไปแล้ว');
 }
 const stmts=[
  env.DB.prepare(`UPDATE attendance_alerts SET state=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP
    WHERE id=? AND state='pending_review'`).bind(b.state,user.id,id)
 ];
 if(b.state==='confirmed'){
  // A guardian-facing event can only be queued after advisor confirmation.
  stmts.push(env.DB.prepare(`INSERT INTO notification_outbox(alert_id,event_type,audience,state)
    SELECT id,'absence_confirmed','guardian','pending' FROM attendance_alerts
    WHERE id=? AND state='confirmed'
    ON CONFLICT(alert_id,event_type,audience) DO UPDATE SET
    state=CASE WHEN notification_outbox.state='cancelled' THEN 'pending' ELSE notification_outbox.state END,
    updated_at=CURRENT_TIMESTAMP`).bind(id));
 }else{
  stmts.push(env.DB.prepare(`UPDATE notification_outbox SET state='cancelled',updated_at=CURRENT_TIMESTAMP
    WHERE alert_id=? AND state='pending'`).bind(id));
 }
 stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
   .bind(user.id,'attendance_reviewed','attendance_alerts',String(id)));
 await env.DB.batch(stmts);
 return json({ok:true,notification:'บันทึกเหตุการณ์ลงคิวภายในแล้ว แต่ยังไม่ได้ส่ง Push หรือข้อความถึงผู้ปกครอง'});
}
async function dashboard(req,env,user){
 const date=new URL(req.url).searchParams.get('date')||bangkokToday();requireDate(date);
 const scope=isStaff(user)?{query:'',args:[]}:await env.DB.prepare(`SELECT id FROM classrooms WHERE advisor_user_id=? OR id IN
 (SELECT classroom_id FROM timetable WHERE teacher_user_id=? AND active=1)`).bind(user.id,user.id).all();
 const ids=isStaff(user)?null:scope.results.map(x=>x.id);
 if(ids?.length===0)return json({rooms:0,students:0,daily:0,period:0,absent_period:0,alerts:0,late:0});
 const filter=ids?` AND c.id IN (${ids.map(()=>'?').join(',')})`:'';
 const a=ids||[];
 const results=await env.DB.batch([
  env.DB.prepare('SELECT COUNT(*) total FROM classrooms c WHERE 1=1'+filter).bind(...a),
  env.DB.prepare('SELECT COUNT(*) total FROM students s JOIN classrooms c ON c.id=s.classroom_id WHERE s.active=1'+filter).bind(...a),
  env.DB.prepare('SELECT COUNT(*) total FROM attendance_daily d JOIN students s ON s.id=d.student_id JOIN classrooms c ON c.id=s.classroom_id WHERE d.school_date=?'+filter).bind(date,...a),
  env.DB.prepare('SELECT COUNT(*) total FROM attendance_period p JOIN students s ON s.id=p.student_id JOIN classrooms c ON c.id=s.classroom_id WHERE p.school_date=?'+filter).bind(date,...a),
  env.DB.prepare("SELECT COUNT(*) total FROM attendance_period p JOIN students s ON s.id=p.student_id JOIN classrooms c ON c.id=s.classroom_id WHERE p.school_date=? AND p.status='absent'"+filter).bind(date,...a),
  env.DB.prepare("SELECT COUNT(*) total FROM attendance_alerts al JOIN students s ON s.id=al.student_id JOIN classrooms c ON c.id=s.classroom_id WHERE al.school_date=? AND al.state='pending_review'"+filter).bind(date,...a),
  env.DB.prepare('SELECT COUNT(*) total FROM late_records l JOIN students s ON s.id=l.student_id JOIN classrooms c ON c.id=s.classroom_id WHERE l.school_date=?'+filter).bind(date,...a)
 ]);
 const values=results.map(r=>r.results[0]?.total||0);
 return json(Object.fromEntries(['rooms','students','daily','period','absent_period','alerts','late'].map((n,i)=>[n,values[i]])));
}
async function adminRoutes(req,env,user,path){
 requireRole(user,['admin']);
 if(req.method==='GET'&&path==='/api/admin/users'){
  const {results}=await env.DB.prepare("SELECT id,username,display_name,role,active FROM users ORDER BY display_name").all();
  return json({items:results});
 }
 if(req.method==='POST'&&path==='/api/admin/users'){
  const b=await payload(req),username=String(b.username||'').trim().toLowerCase(), pass=String(b.password||'');
  if(!validUsername(username)||pass.length<12||pass.length>128||!['teacher','staff','admin'].includes(b.role))throw error(400,'ชื่อผู้ใช้หรือรหัสผ่าน (12–128 ตัว) ไม่ถูกต้อง');
  const salt=randomHex(16),hash=await passwordHash(pass,salt);
  const res=await env.DB.prepare('INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?)')
   .bind(username,requiredText(b.display_name,100),b.role,salt,hash).run();
  await log(env.DB,user.id,'user_created','users',res.meta.last_row_id);
  return json({ok:true,id:res.meta.last_row_id},201);
 }
 if(req.method==='POST'&&path==='/api/admin/advisor'){
  const b=await payload(req),roomId=positiveInt(b.classroom_id),teacherId=positiveInt(b.teacher_user_id);
  const t=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND active=1").bind(teacherId).first();
  if(!roomId||!t)throw error(400,'เลือกครูและห้องเรียนให้ถูกต้อง');
  const res=await env.DB.prepare('UPDATE classrooms SET advisor_user_id=? WHERE id=?').bind(teacherId,roomId).run();
  if(!res.meta.changes)throw error(404,'ไม่พบห้องเรียน');
  await log(env.DB,user.id,'advisor_assigned','classrooms',roomId);
  return json({ok:true});
 }
 if(req.method==='POST'&&path==='/api/admin/timetable'){
  const b=await payload(req),roomId=positiveInt(b.classroom_id),teacherId=positiveInt(b.teacher_user_id);
  const day=Number(b.day_of_week),period=Number(b.period);
  if(!roomId||!teacherId||!Number.isInteger(day)||day<1||day>7||!Number.isInteger(period)||period<1||period>12)throw error(400,'ข้อมูลคาบเรียนไม่ถูกต้อง');
  const t=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND active=1").bind(teacherId).first();
  const c=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(roomId).first();
  if(!t||!c)throw error(400,'ไม่พบครูหรือห้องเรียน');
  const res=await env.DB.prepare('INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,subject) VALUES(?,?,?,?,?)')
   .bind(roomId,teacherId,day,period,requiredText(b.subject,120)).run();
  await log(env.DB,user.id,'timetable_created','timetable',res.meta.last_row_id);
  return json({ok:true,id:res.meta.last_row_id},201);
 }
 if(req.method==='POST'&&path==='/api/admin/import-students'){
  const b=await payload(req),roomId=positiveInt(b.classroom_id);
  const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(roomId).first();
  if(!room||!Array.isArray(b.students)||b.students.length<1||b.students.length>60)throw error(400,'กรุณาเลือกห้องและส่งนักเรียนครั้งละไม่เกิน 60 คน');
  const seenIds=new Set(),seenRolls=new Set();
  const stmts=[];
  for(const student of b.students){
   const roll=Number(student.roll_no),no=cleanText(student.student_no,40),name=cleanText(student.full_name,120);
   if(!Number.isInteger(roll)||roll<1||roll>100||!no||!name||seenIds.has(no)||seenRolls.has(roll))throw error(400,'เลขที่ ชื่อ และรหัสนักเรียนต้องถูกต้องและไม่ซ้ำกัน');
   seenIds.add(no);seenRolls.add(roll);
   stmts.push(env.DB.prepare('INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES(?,?,?,?)').bind(no,roomId,roll,name));
  }
  stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)').bind(user.id,'students_imported','classrooms',roomId));
  await env.DB.batch(stmts);
  return json({ok:true,imported:b.students.length},201);
 }
 if(req.method==='GET'&&path==='/api/admin/students'){
  const roomId=positiveInt(new URL(req.url).searchParams.get('classroom_id'));
  if(!roomId)throw error(400,'กรุณาเลือกห้องเรียน');
  const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(roomId).first();
  if(!room)throw error(404,'ไม่พบห้องเรียน');
  const {results}=await env.DB.prepare('SELECT id,student_no,classroom_id,roll_no,full_name,active FROM students WHERE classroom_id=? ORDER BY active DESC,roll_no,id').bind(roomId).all();
  return json({items:results});
 }
 if(req.method==='POST'&&path==='/api/admin/students'){
  const b=await payload(req);let student;
  try{student=validateStudentInput(b)}catch(e){throw error(400,e.message)}
  const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(student.classroom_id).first();
  if(!room)throw error(404,'ไม่พบห้องเรียน');
  const res=await env.DB.prepare('INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,?)')
   .bind(student.student_no,student.classroom_id,student.roll_no,student.full_name,student.active).run();
  await log(env.DB,user.id,'student_created','students',res.meta.last_row_id);
  return json({ok:true,id:res.meta.last_row_id},201);
 }
 const studentEdit = /^\/api\/admin\/students\/(\d+)$/.exec(path);
 if(req.method==='POST'&&studentEdit){
  const id=positiveInt(studentEdit[1]),b=await payload(req);let student;
  try{student=validateStudentInput(b)}catch(e){throw error(400,e.message)}
  const old=await env.DB.prepare('SELECT id,classroom_id FROM students WHERE id=?').bind(id).first();
  if(!old)throw error(404,'ไม่พบนักเรียน');
  const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(student.classroom_id).first();
  if(!room)throw error(404,'ไม่พบห้องเรียน');
  if(old.classroom_id!==student.classroom_id){
   const history=await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM attendance_daily WHERE student_id=?)
     +(SELECT COUNT(*) FROM attendance_period WHERE student_id=?)
     +(SELECT COUNT(*) FROM late_records WHERE student_id=?)
     +(SELECT COUNT(*) FROM behavior_records WHERE student_id=?)
     +(SELECT COUNT(*) FROM attendance_alerts WHERE student_id=?) AS total`)
     .bind(id,id,id,id,id).first();
   if(history.total>0)throw error(409,'มีประวัติการเช็กชื่อหรือพฤติกรรมแล้ว ไม่สามารถย้ายห้องจนกว่าจะรองรับประวัติการย้ายห้อง');
  }
  await env.DB.batch([
   env.DB.prepare('UPDATE students SET student_no=?,classroom_id=?,roll_no=?,full_name=?,active=? WHERE id=?')
    .bind(student.student_no,student.classroom_id,student.roll_no,student.full_name,student.active,id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(user.id,'student_updated','students',String(id))
  ]);
  return json({ok:true,id});
 }
 const userEdit = /^\/api\/admin\/users\/(\d+)$/.exec(path);
 if(req.method==='POST'&&userEdit){
  const id=positiveInt(userEdit[1]),b=await payload(req);
  const old=await env.DB.prepare('SELECT id,role FROM users WHERE id=?').bind(id).first();
  if(!old)throw error(404,'ไม่พบบัญชี');
  if(!['teacher','staff'].includes(old.role))throw error(403,'ไม่อนุญาตให้แก้ไขบัญชีผู้ดูแลระบบผ่านหน้านี้');
  let update;
  try{update=validatePersonnelInput(b)}catch(e){throw error(400,e.message)}
  await env.DB.batch([
   env.DB.prepare('UPDATE users SET display_name=?,active=? WHERE id=?').bind(update.display_name,update.active,id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(user.id,'personnel_updated','users',String(id))
  ]);
  if(!update.active)await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
  return json({ok:true,id});
 }
 throw error(404,'ไม่พบ API');
}
async function route(req,env){
 const url=new URL(req.url),path=url.pathname;
 if(req.method==='GET'&&path==='/api/health')return json({ok:true,service:'RD Care API',time:bangkokToday()});
 if(req.method==='POST'&&path==='/api/setup')return setup(req,env);
 if(req.method==='POST'&&path==='/api/auth/login')return login(req,env);
 const user=await currentUser(req,env);
 if(req.method==='POST'&&path==='/api/auth/logout'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest((req.headers.get('authorization')||'').slice(7))).run();
  return json({ok:true});
 }
 if(req.method==='GET'&&path==='/api/auth/me')return json({user});
 if(req.method==='GET'&&path==='/api/classrooms')return classrooms(env,user);
 if(req.method==='GET'&&path==='/api/students')return getStudents(req,env,user);
 if(req.method==='GET'&&path==='/api/timetable')return getTimetable(req,env,user);
 if(req.method==='GET'&&path==='/api/attendance')return getAttendance(req,env,user);
 if(req.method==='POST'&&path==='/api/attendance')return writeAttendance(req,env,user);
 if(req.method==='GET'&&path==='/api/dashboard')return dashboard(req,env,user);
 if(req.method==='GET'&&path==='/api/late')return listLate(req,env,user);
 if(req.method==='POST'&&path==='/api/late')return addLate(req,env,user);
 if(req.method==='GET'&&path==='/api/behavior')return listBehavior(req,env,user);
 if(req.method==='POST'&&path==='/api/behavior')return addBehavior(req,env,user);
 if(req.method==='GET'&&path==='/api/alerts')return listAlerts(req,env,user);
 const m=/^\/api\/alerts\/(\d+)\/review$/.exec(path);
 if(req.method==='POST'&&m)return reviewAlert(req,env,user,Number(m[1]));
 if(path.startsWith('/api/admin/'))return adminRoutes(req,env,user,path);
 throw error(404,'ไม่พบ API');
}
export default {
 async fetch(req,env){
  const origin=req.headers.get('origin');
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(origin&&!allowed.includes(origin))return json({error:'origin_not_allowed'},403);
  const cors={
   ...(origin?{'access-control-allow-origin':origin}:{}),
   'vary':'Origin',
   'access-control-allow-methods':'GET,POST,OPTIONS',
   'access-control-allow-headers':'Authorization,Content-Type,X-Setup-Token',
   'access-control-max-age':'600',
   'cache-control':'no-store',
   'x-content-type-options':'nosniff',
   'referrer-policy':'no-referrer'
  };
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  let response;
  try{response=await route(req,env);}
  catch(e){
   const code=/UNIQUE constraint failed/.test(e?.message||'')?409:httpErrorStatus(e);
   if(code===500)console.error('RD Care API:',e);
   response=json({error:code===500?'ระบบขัดข้อง กรุณาลองใหม่':e.message},code);
  }
  const headers=new Headers(response.headers);
  for(const [k,v] of Object.entries(cors))headers.set(k,v);
  return new Response(response.body,{status:response.status,headers});
 }
};
