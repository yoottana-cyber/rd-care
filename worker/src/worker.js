import { STATUS, PERIOD_STATUS, isAdmin, isStaff, validDate, bangkokToday, weekday, schoolDateAllowed, validateEntries, cleanText, validUsername, httpErrorStatus } from './core.js';
import { passwordHash } from './password.js';
import { validateStudentInput, validatePersonnelInput } from './admin-validation.js';
import { planStudentImport } from './student-import.js';
import { validateLateSelfReport,validateLateReviewState,bangkokArrivalTime } from './late-self.js';
import {portalRoutes,portalAdminRoutes} from './portal.js';
import {searchStudents} from './student-search.js';
import {advisorImportEndpoint} from './advisor-import.js';
import {validateUserPassword,userPasswordMinimum} from './user-password-policy.js';
import {unifiedRosterEndpoint} from './unified-roster.js';
import {teacherTimetableRoutes,validateLesson} from './teacher-timetable.js';
import {periodWeekStatus,periodCourseReport} from './period-reports.js';
import {staffPushRoutes,deliverAdvisorPush} from './staff-push.js';
import {lateGateStaffRoutes} from './late-qr.js';
import {deliverLateQrPush} from './late-qr-push.js';
import {deliverTruancyPush,advisorTruancyItems,truancyPushReadiness} from './truancy-push.js';
import {pushTarget} from './push-target.js';
import {studentAffairsRoutes,sendScheduledAttendanceReminders} from './student-affairs.js';

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
 // "Remember me" is an explicit per-device choice; never extend a normal session.
 const sessionSeconds=b.remember===true?30*86400:8*3600;
 const token=randomHex(32);
 await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
  .bind(await digest(token),user.id,now()+sessionSeconds).run();
 return json({token,user:{id:user.id,username:user.username,display_name:user.display_name,role:user.role},expires_in:sessionSeconds});
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
 const q=new URL(req.url).searchParams,roomId=positiveInt(q.get('classroom_id'));
 const date=q.get('date')||bangkokToday();requireDate(date);
 await assertRoom(env,user,roomId);
 const {results}=await env.DB.prepare(`SELECT s.id,s.student_no,h.roll_no,s.full_name FROM students s
 JOIN student_enrollments h ON h.student_id=s.id
 WHERE h.classroom_id=? AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)
 AND s.active=1 ORDER BY h.roll_no`).bind(roomId,date,date).all();
 return json({items:results});
}
async function getTimetable(req,env,user){
 const url=new URL(req.url);
 const date=url.searchParams.get('date')||bangkokToday(); requireDate(date);
 const day=weekday(date);
 const roomId=positiveInt(url.searchParams.get('classroom_id'));
 let query=`SELECT t.id,t.classroom_id,t.teacher_user_id,t.day_of_week,t.period,COALESCE(t.end_period,t.period) AS end_period,t.subject_code,t.subject,c.label AS classroom_label,u.display_name AS teacher_name
  FROM timetable t JOIN classrooms c ON c.id=t.classroom_id JOIN users u ON u.id=t.teacher_user_id
  WHERE t.active=1 AND t.day_of_week=?`;
 const args=[day];
 if(roomId){await assertRoom(env,user,roomId);query+=' AND t.classroom_id=?';args.push(roomId);}
 if(!isStaff(user)){
  if(url.searchParams.get('scope')==='mine'){
   query+=' AND t.teacher_user_id=?';args.push(user.id);
  }else{
   query+=` AND (t.teacher_user_id=? OR c.advisor_user_id=?)`;
   args.push(user.id,user.id);
  }
 }
 query+=' ORDER BY t.period,c.grade,c.room';
 const {results}=await env.DB.prepare(query).bind(...args).all();
 return json({items:results});
}
async function getAttendance(req,env,user){
 const q=new URL(req.url).searchParams;
 const roomId=positiveInt(q.get('classroom_id'));
 const kind=q.get('kind');const date=q.get('date')||bangkokToday();
 requireDate(date);await assertRoom(env,user,roomId,kind==='daily'?'daily':'view');
 if(kind==='daily'){
  const {results}=await env.DB.prepare(`SELECT a.student_id,a.status FROM attendance_daily a
 JOIN student_enrollments h ON h.student_id=a.student_id
 WHERE h.classroom_id=? AND a.school_date=? AND h.start_date<=a.school_date
 AND (h.end_date IS NULL OR h.end_date>a.school_date)`).bind(roomId,date).all();
  return json({items:results});
 }
 if(kind==='period'){
  const timetableId=positiveInt(q.get('timetable_id'));
  const slot=await env.DB.prepare('SELECT id,classroom_id,teacher_user_id,day_of_week FROM timetable WHERE id=? AND active=1').bind(timetableId).first();
  if(!slot||slot.classroom_id!==roomId||slot.day_of_week!==weekday(date))throw error(400,'คาบเรียนไม่สัมพันธ์กับห้องหรือวันที่');
  if(user.role==='teacher'&&slot.teacher_user_id!==user.id)throw error(403,'ดูเช็กชื่อรายคาบได้เฉพาะวิชาของตนเอง');
  const {results}=await env.DB.prepare(`SELECT p.student_id,
    CASE WHEN tr.student_id IS NOT NULL AND p.status='absent' THEN 'truancy' ELSE p.status END AS status
 FROM attendance_period p
 LEFT JOIN period_truancy tr ON tr.student_id=p.student_id AND tr.timetable_id=p.timetable_id
   AND tr.school_date=p.school_date
 JOIN student_enrollments h ON h.student_id=p.student_id
 WHERE p.timetable_id=? AND p.school_date=? AND h.classroom_id=?
 AND h.start_date<=p.school_date AND (h.end_date IS NULL OR h.end_date>p.school_date)`)
 .bind(timetableId,date,roomId).all();
  // A class teacher's DAILY check-in is reference information only. Return only
  // records for students enrolled in this lesson's room on the selected date,
  // after the timetable/teacher authorization above has succeeded.
  // Missing rows mean "not recorded", NEVER "present".
  const {results:dailyItems}=await env.DB.prepare(`SELECT d.student_id,d.status FROM attendance_daily d
   JOIN student_enrollments h ON h.student_id=d.student_id
   WHERE h.classroom_id=? AND d.school_date=?
     AND h.start_date<=d.school_date
     AND (h.end_date IS NULL OR h.end_date>d.school_date)`)
   .bind(roomId,date).all();
  const log=await env.DB.prepare('SELECT note,updated_at FROM period_teaching_logs WHERE timetable_id=? AND school_date=?')
   .bind(timetableId,date).first();
  return json({items:results,daily_items:dailyItems,daily_date:date,daily_read_only:true,
   teaching_note:log?.note||'',teaching_note_updated_at:log?.updated_at||null});
 }
 throw error(400,'ประเภทการเช็กชื่อไม่ถูกต้อง');
}
async function writeAttendance(req,env,user){
 const b=await payload(req),roomId=positiveInt(b.classroom_id);
 const kind=b.kind,date=b.date;
 requireWriteDate(date);
 if(!['daily','period'].includes(kind))throw error(400,'กรุณาเลือกประเภทการเช็กชื่อ');
 await assertRoom(env,user,roomId,kind==='daily'?'daily':'view');
 const {results:students}=await env.DB.prepare(`SELECT s.id FROM students s
 JOIN student_enrollments h ON h.student_id=s.id
 WHERE h.classroom_id=? AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)
 AND s.active=1 ORDER BY h.roll_no`).bind(roomId,date,date).all();
 if(!students.length)throw error(400,'ห้องเรียนยังไม่มีนักเรียน');
 const ids=new Set(students.map(x=>x.id));
 if(!validateEntries(b.entries,ids,100,kind==='period'?PERIOD_STATUS:STATUS))
  throw error(400,'รายการต้องมีนักเรียนทุกคนในห้อง สถานะถูกต้อง และไม่ซ้ำกัน');
 const stmts=[];
 let slot;
 if(kind==='period'){
  if(Object.hasOwn(b,'teaching_note')&&(typeof b.teaching_note!=='string'||b.teaching_note.length>2000))
   throw error(400,'บันทึกการสอนต้องเป็นข้อความไม่เกิน 2,000 ตัวอักษร');
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
   if(e.status==='absent'){
    // The advisor has already recorded this student's absence for the day:
    // withdraw pending per-lesson review events regardless of save order.
    stmts.push(env.DB.prepare(`UPDATE notification_outbox SET state='cancelled',updated_at=CURRENT_TIMESTAMP
      WHERE state='pending' AND alert_id IN (
       SELECT id FROM attendance_alerts
       WHERE student_id=? AND school_date=? AND state='pending_review')`)
     .bind(e.student_id,date));
    stmts.push(env.DB.prepare(`UPDATE attendance_alerts SET state='resolved',
      reviewed_by=NULL,reviewed_at=NULL
      WHERE student_id=? AND school_date=? AND state='pending_review'`)
     .bind(e.student_id,date));
   }
  }else{
   stmts.push(env.DB.prepare(`INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(?,?,?,?,?)
     ON CONFLICT(student_id,timetable_id,school_date) DO UPDATE SET status=excluded.status,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(e.student_id,slot.id,date,e.status==='truancy'?'absent':e.status,user.id));
   if(e.status==='truancy'){
    // A separate classified event: no duplicate advisor-absence-review is needed.
    stmts.push(env.DB.prepare(`INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
     VALUES(?,?,?,?) ON CONFLICT(student_id,timetable_id,school_date)
     DO UPDATE SET recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
     .bind(e.student_id,slot.id,date,user.id));
    stmts.push(env.DB.prepare(`INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by)
      VALUES(?,?,?,?) ON CONFLICT(student_id,timetable_id,school_date)
      DO UPDATE SET active=1,recorded_by=excluded.recorded_by,
       generation=CASE WHEN truancy_events.active=0 THEN truancy_events.generation+1 ELSE truancy_events.generation END,
       updated_at=CURRENT_TIMESTAMP`).bind(e.student_id,slot.id,date,user.id));
   }else{
    stmts.push(env.DB.prepare(`DELETE FROM period_truancy
      WHERE student_id=? AND timetable_id=? AND school_date=?`).bind(e.student_id,slot.id,date));
    stmts.push(env.DB.prepare(`UPDATE truancy_events SET active=0,updated_at=CURRENT_TIMESTAMP
      WHERE student_id=? AND timetable_id=? AND school_date=? AND active=1`)
      .bind(e.student_id,slot.id,date));
   }
   if(e.status==='absent'){
    // A recorded DAILY absence already explains the period absence. Keep the
    // period attendance row, but never create/reopen advisor review work.
    stmts.push(env.DB.prepare(`INSERT INTO attendance_alerts(student_id,timetable_id,school_date,state)
      SELECT ?,?,?,'pending_review' WHERE NOT EXISTS (
       SELECT 1 FROM attendance_daily d WHERE d.student_id=? AND d.school_date=?
         AND d.status='absent')
      ON CONFLICT(student_id,timetable_id,school_date) DO UPDATE SET
      state=CASE WHEN attendance_alerts.state='resolved' THEN 'pending_review' ELSE attendance_alerts.state END`)
     .bind(e.student_id,slot.id,date,e.student_id,date));
    // Cancel an older pending event if the daily absence was recorded later,
    // without touching already-delivered or guardian-confirmed history.
    stmts.push(env.DB.prepare(`UPDATE notification_outbox SET state='cancelled',updated_at=CURRENT_TIMESTAMP
      WHERE state='pending' AND alert_id IN (
       SELECT a.id FROM attendance_alerts a
       JOIN attendance_daily d ON d.student_id=a.student_id AND d.school_date=a.school_date
       WHERE a.student_id=? AND a.timetable_id=? AND a.school_date=?
         AND a.state='pending_review' AND d.status='absent')`)
     .bind(e.student_id,slot.id,date));
    stmts.push(env.DB.prepare(`UPDATE attendance_alerts SET state='resolved',reviewed_by=NULL,reviewed_at=NULL
      WHERE student_id=? AND timetable_id=? AND school_date=? AND state='pending_review'
       AND EXISTS(SELECT 1 FROM attendance_daily d WHERE d.student_id=? AND d.school_date=?
          AND d.status='absent')`)
     .bind(e.student_id,slot.id,date,e.student_id,date));
    // Record an internal review request for the class advisor, not a Push send.
    stmts.push(env.DB.prepare(`INSERT INTO notification_outbox(alert_id,event_type,audience,state)
      SELECT id,'attendance_review_requested','advisor','pending'
      FROM attendance_alerts
      WHERE student_id=? AND timetable_id=? AND school_date=? AND state='pending_review'
        AND NOT EXISTS(SELECT 1 FROM attendance_daily d
          WHERE d.student_id=? AND d.school_date=? AND d.status='absent')
      ON CONFLICT(alert_id,event_type,audience) DO UPDATE SET
      state=CASE WHEN notification_outbox.state='cancelled' THEN 'pending' ELSE notification_outbox.state END,
      updated_at=CURRENT_TIMESTAMP`).bind(e.student_id,slot.id,date,e.student_id,date));
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
 // The note is optional; old clients that omit teaching_note leave stored notes unchanged.
 // Emptying the visible field deliberately removes a previous note.
 if(kind==='period'&&Object.hasOwn(b,'teaching_note')){
  const note=b.teaching_note.trim();
  if(note){
   stmts.push(env.DB.prepare(`INSERT INTO period_teaching_logs(timetable_id,school_date,note,recorded_by)
    VALUES(?,?,?,?) ON CONFLICT(timetable_id,school_date) DO UPDATE SET
    note=excluded.note,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(slot.id,date,note,user.id));
  }else{
   stmts.push(env.DB.prepare('DELETE FROM period_teaching_logs WHERE timetable_id=? AND school_date=?')
    .bind(slot.id,date));
  }
  stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
   .bind(user.id,note?'teaching_note_saved':'teaching_note_cleared','period_teaching_logs',`${slot.id}:${date}`));
 }
 stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
  .bind(user.id,'attendance_saved',kind,`${date}:${roomId}:${slot?.id||0}`));
 await env.DB.batch(stmts);
 // The caller needs to know when no target device is enrolled. Never mislead
 // teachers with a generic "saved" toast that implies a delivered Push.
 let push=null;
 if(kind==='period'){
  const marked=b.entries.filter(row=>row.status==='truancy').map(row=>row.student_id);
  if(marked.length){
   try{push=await truancyPushReadiness(env,roomId,marked)}
   catch(e){console.warn('RD CONNECT truancy readiness failed',e?.name||'database');
    push={events:marked.length,ready:false,reason:'readiness_unknown'};}
  }
 }
 return json({ok:true,saved:b.entries.length,push,
  message:'บันทึกเช็กชื่อสำเร็จ'});
}
async function addLate(req,env,user){
 const b=await payload(req),stId=positiveInt(b.student_id);
 const date=b.date||bangkokToday(); requireWriteDate(date);
 const st=await env.DB.prepare(`SELECT s.id,h.classroom_id FROM students s
  JOIN student_enrollments h ON h.student_id=s.id
  WHERE s.id=? AND s.active=1 AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)`)
  .bind(stId,date,date).first();
 if(!st)throw error(404,'ไม่พบนักเรียนที่สังกัดห้องในวันที่เลือก');
 await assertRoom(env,user,st.classroom_id);
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
 const {results}=await env.DB.prepare(`SELECT l.id,h.roll_no,s.full_name,l.arrived_at,l.reason,l.state FROM late_records l
 JOIN students s ON s.id=l.student_id
 JOIN student_enrollments h ON h.student_id=l.student_id
 WHERE h.classroom_id=? AND l.school_date=? AND h.start_date<=l.school_date
 AND (h.end_date IS NULL OR h.end_date>l.school_date) ORDER BY l.arrived_at DESC`).bind(roomId,date).all();
 return json({items:results});
}
// An authenticated staff member issues a short-lived credential to one
// student. It is shown once, never logged or stored in plaintext.
async function issueLateSelfCode(req,env,user){
 if(!isStaff(user))throw error(403,'เฉพาะครูเวรหรือผู้ดูแลระบบ');
 const b=await payload(req),studentId=positiveInt(b.student_id),date=bangkokToday();
 if(!studentId)throw error(400,'กรุณาเลือกนักเรียน');
 const student=await env.DB.prepare(`SELECT s.id FROM students s
  JOIN student_enrollments h ON h.student_id=s.id AND h.end_date IS NULL
  WHERE s.id=? AND s.active=1`).bind(studentId).first();
 if(!student)throw error(404,'ไม่พบนักเรียนที่ใช้งานอยู่');
 const prior=await env.DB.prepare(`SELECT
  (SELECT COUNT(*) FROM late_self_requests WHERE student_id=? AND school_date=?)
 +(SELECT COUNT(*) FROM late_records WHERE student_id=? AND school_date=?) AS total`)
  .bind(studentId,date,studentId,date).first();
 if(prior?.total>0)throw error(409,'นักเรียนมีรายการแจ้งมาสายวันนี้แล้ว');
 const code=randomHex(12),expires=now()+600;
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO late_self_passcodes(student_id,school_date,code_hash,expires_at,issued_by)
    VALUES(?,?,?,?,?)
    ON CONFLICT(student_id,school_date) DO UPDATE SET
    code_hash=excluded.code_hash,expires_at=excluded.expires_at,
    issued_by=excluded.issued_by,consumed_at=NULL`)
   .bind(studentId,date,await digest(code),expires,user.id),
  env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
   .bind(user.id,'late_self_code_issued','students',String(studentId))
 ]);
 return json({ok:true,code,expires_in:600,message:'แจ้งรหัสนี้ให้นักเรียนโดยตรง มีอายุ 10 นาทีและใช้ได้ครั้งเดียว'},201);
}
// Public submission: no bearer token, no student names or identity enumeration.
// A student code never creates or changes an approved attendance record.
async function submitLateSelf(req,env){
 let b;
 try{b=validateLateSelfReport(await payload(req))}catch(e){throw error(400,e.message)}
 const date=bangkokToday(),ts=now(),codeHash=await digest(b.code);
 const pass=await env.DB.prepare(`SELECT p.id,p.student_id FROM late_self_passcodes p
  JOIN students s ON s.id=p.student_id
  JOIN student_enrollments h ON h.student_id=s.id AND h.end_date IS NULL
  WHERE p.code_hash=? AND p.school_date=? AND p.expires_at>?
   AND p.consumed_at IS NULL AND s.student_no=? AND s.active=1`)
  .bind(codeHash,date,ts,b.student_no).first();
 if(!pass)throw error(400,'รหัสนักเรียนหรือรหัสยืนยันไม่ถูกต้อง หรือรหัสหมดอายุ');
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO late_self_requests(student_id,school_date,arrived_at,reason)
   SELECT p.student_id,p.school_date,?,? FROM late_self_passcodes p
   WHERE p.id=? AND p.code_hash=? AND p.consumed_at IS NULL AND p.expires_at>?
   AND NOT EXISTS(SELECT 1 FROM late_records l WHERE l.student_id=p.student_id AND l.school_date=p.school_date)`)
   .bind(bangkokArrivalTime(),b.reason,pass.id,codeHash,ts),
  env.DB.prepare(`UPDATE late_self_passcodes SET consumed_at=? WHERE id=? AND code_hash=? AND consumed_at IS NULL AND expires_at>?`)
   .bind(ts,pass.id,codeHash,ts)
 ]);
 if(results[0].meta.changes!==1||results[1].meta.changes!==1)
  throw error(409,'รหัสนี้ถูกใช้แล้ว หรือมีการลงทะเบียนมาสายวันนี้แล้ว');
 return json({ok:true,state:'pending',message:'ส่งคำขอมาสายสำเร็จ รอครูเวรตรวจสอบก่อนบันทึกผล'},201);
}
async function listLateSelf(req,env,user){
 if(!isStaff(user))throw error(403,'เฉพาะครูเวรหรือผู้ดูแลระบบ');
 const q=new URL(req.url).searchParams,roomId=positiveInt(q.get('classroom_id'));
 const date=q.get('date')||bangkokToday();requireDate(date);
 if(!roomId)throw error(400,'กรุณาเลือกห้องเรียน');
 const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(roomId).first();
 if(!room)throw error(404,'ไม่พบห้องเรียน');
 const {results}=await env.DB.prepare(`SELECT r.id,r.school_date,r.arrived_at,r.reason,r.state,
   s.full_name,s.student_no,h.roll_no
   FROM late_self_requests r JOIN students s ON s.id=r.student_id
   JOIN student_enrollments h ON h.student_id=s.id
   WHERE h.classroom_id=? AND r.school_date=?
    AND h.start_date<=r.school_date AND (h.end_date IS NULL OR h.end_date>r.school_date)
   ORDER BY CASE WHEN r.state='pending' THEN 0 ELSE 1 END,r.id DESC LIMIT 100`)
  .bind(roomId,date).all();
 return json({items:results});
}
async function reviewLateSelf(req,env,user,id){
 if(!isStaff(user))throw error(403,'เฉพาะครูเวรหรือผู้ดูแลระบบ');
 let state;
 try{state=validateLateReviewState((await payload(req)).state)}catch(e){throw error(400,e.message)}
 const item=await env.DB.prepare('SELECT id,state,student_id,school_date FROM late_self_requests WHERE id=?').bind(id).first();
 if(!item)throw error(404,'ไม่พบคำขอ');
 if(item.state!=='pending')throw error(409,'คำขอนี้ถูกตรวจสอบแล้ว');
 if(state==='verified'){
  const duplicate=await env.DB.prepare('SELECT id FROM late_records WHERE student_id=? AND school_date=?')
   .bind(item.student_id,item.school_date).first();
  if(duplicate)throw error(409,'มีบันทึกมาสายที่ยืนยันแล้วในวันนี้');
  const results=await env.DB.batch([
   env.DB.prepare(`INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
     SELECT student_id,school_date,arrived_at,reason,'verified',?,? FROM late_self_requests
     WHERE id=? AND state='pending'`).bind(user.id,user.id,id),
   env.DB.prepare(`UPDATE late_self_requests SET state='verified',verified_by=?,reviewed_at=CURRENT_TIMESTAMP
     WHERE id=? AND state='pending'`).bind(user.id,id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(user.id,'student_late_verified','late_self_requests',String(id))
  ]);
  if(results[0].meta.changes!==1||results[1].meta.changes!==1)
   throw error(409,'คำขอนี้ถูกตรวจสอบแล้ว');
 }else{
  const change=await env.DB.prepare(`UPDATE late_self_requests SET state='rejected',verified_by=?,reviewed_at=CURRENT_TIMESTAMP
   WHERE id=? AND state='pending'`).bind(user.id,id).run();
  if(change.meta.changes!==1)throw error(409,'คำขอนี้ถูกตรวจสอบแล้ว');
  await log(env.DB,user.id,'student_late_rejected','late_self_requests',id);
 }
 return json({ok:true,state,message:state==='verified'?'ยืนยันมาสายและบันทึกแล้ว':'ปฏิเสธคำขอแล้ว'});
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
 const {results}=await env.DB.prepare(`SELECT a.id,a.school_date,a.state,h.roll_no,s.full_name,t.period,t.subject
  FROM attendance_alerts a JOIN students s ON s.id=a.student_id JOIN timetable t ON t.id=a.timetable_id
  JOIN student_enrollments h ON h.student_id=s.id AND h.classroom_id=t.classroom_id
  WHERE t.classroom_id=? AND h.start_date<=a.school_date AND (h.end_date IS NULL OR h.end_date>a.school_date)
  AND a.state='pending_review'
  AND NOT EXISTS(SELECT 1 FROM attendance_daily d
    WHERE d.student_id=a.student_id AND d.school_date=a.school_date AND d.status='absent')
  ORDER BY a.school_date DESC,t.period DESC LIMIT 50`).bind(roomId).all();
 return json({items:results});
}
async function reviewAlert(req,env,user,id){
 const b=await payload(req);
 if(!['confirmed','resolved'].includes(b.state))throw error(400,'สถานะไม่ถูกต้อง');
 const record=await env.DB.prepare(`SELECT a.id,a.student_id,a.school_date,a.timetable_id,a.state,t.classroom_id
 FROM attendance_alerts a JOIN timetable t ON t.id=a.timetable_id WHERE a.id=?`).bind(id).first();
 if(!record)throw error(404,'ไม่พบรายการ');
 await assertRoom(env,user,record.classroom_id);
 if(!isStaff(user)){
  const room=await env.DB.prepare('SELECT advisor_user_id FROM classrooms WHERE id=?').bind(record.classroom_id).first();
  if(room?.advisor_user_id!==user.id)throw error(403,'เฉพาะครูที่ปรึกษา');
 }
 if(record.state!=='pending_review')throw error(409,'รายการนี้ได้รับการตรวจสอบแล้ว');
 // Reject a stale confirmation even if the daily register changed after the
 // user opened the advisor screen; a daily absence supersedes the review task.
 const daily=await env.DB.prepare(`SELECT status FROM attendance_daily
  WHERE student_id=? AND school_date=?`).bind(record.student_id,record.school_date).first();
 if(daily?.status==='absent')throw error(409,'นักเรียนขาดเรียนรายวันแล้ว ไม่ต้องยืนยันขาดรายคาบซ้ำ');
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
 if(ids?.length===0)return json({rooms:0,students:0,daily:0,period:0,absent_period:0,alerts:0,late:0,daily_statuses:{present:0,absent:0,late:0,leave:0},daily_trend:[]});
 const filter=ids?` AND c.id IN (${ids.map(()=>'?').join(',')})`:'';
 const a=ids||[];
 const results=await env.DB.batch([
  env.DB.prepare('SELECT COUNT(*) total FROM classrooms c WHERE 1=1'+filter).bind(...a),
  env.DB.prepare('SELECT COUNT(*) total FROM students s JOIN student_enrollments h ON h.student_id=s.id JOIN classrooms c ON c.id=h.classroom_id WHERE s.active=1 AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)'+filter).bind(date,date,...a),
  env.DB.prepare('SELECT COUNT(*) total FROM attendance_daily d JOIN student_enrollments h ON h.student_id=d.student_id AND h.start_date<=d.school_date AND (h.end_date IS NULL OR h.end_date>d.school_date) JOIN classrooms c ON c.id=h.classroom_id WHERE d.school_date=?'+filter).bind(date,...a),
  env.DB.prepare('SELECT COUNT(*) total FROM attendance_period p JOIN student_enrollments h ON h.student_id=p.student_id AND h.start_date<=p.school_date AND (h.end_date IS NULL OR h.end_date>p.school_date) JOIN classrooms c ON c.id=h.classroom_id WHERE p.school_date=?'+filter).bind(date,...a),
  env.DB.prepare("SELECT COUNT(*) total FROM attendance_period p JOIN student_enrollments h ON h.student_id=p.student_id AND h.start_date<=p.school_date AND (h.end_date IS NULL OR h.end_date>p.school_date) JOIN classrooms c ON c.id=h.classroom_id WHERE p.school_date=? AND p.status='absent'"+filter).bind(date,...a),
  env.DB.prepare("SELECT COUNT(*) total FROM attendance_alerts al JOIN student_enrollments h ON h.student_id=al.student_id AND h.start_date<=al.school_date AND (h.end_date IS NULL OR h.end_date>al.school_date) JOIN classrooms c ON c.id=h.classroom_id WHERE al.school_date=? AND al.state='pending_review' AND NOT EXISTS(SELECT 1 FROM attendance_daily d WHERE d.student_id=al.student_id AND d.school_date=al.school_date AND d.status='absent')"+filter+(isStaff(user)?'':" AND c.advisor_user_id=?")).bind(date,...a,...(isStaff(user)?[]:[user.id])),
  env.DB.prepare('SELECT COUNT(*) total FROM late_records l JOIN student_enrollments h ON h.student_id=l.student_id AND h.start_date<=l.school_date AND (h.end_date IS NULL OR h.end_date>l.school_date) JOIN classrooms c ON c.id=h.classroom_id WHERE l.school_date=?'+filter).bind(date,...a),
  env.DB.prepare("SELECT d.school_date day,d.status,COUNT(*) total FROM attendance_daily d"+
    " JOIN student_enrollments h ON h.student_id=d.student_id AND h.start_date<=d.school_date"+
    " AND (h.end_date IS NULL OR h.end_date>d.school_date)"+
    " JOIN classrooms c ON c.id=h.classroom_id WHERE d.school_date BETWEEN date(?,'-6 days') AND ?"+
    filter+" GROUP BY d.school_date,d.status ORDER BY d.school_date").bind(date,date,...a)
 ]);
 const values=results.slice(0,7).map(r=>r.results[0]?.total||0);
 const dateUTC=new Date(date+'T12:00:00Z').getTime();
 const daily_trend=Array.from({length:7},(_,i)=>({
  date:new Date(dateUTC-(6-i)*86400000).toISOString().slice(0,10),
  present:0,absent:0,late:0,leave:0
 }));
 const byDate=new Map(daily_trend.map(row=>[row.date,row]));
 for(const row of results[7]?.results||[]){
  const destination=byDate.get(row.day);
  if(destination&&['present','absent','late','leave'].includes(row.status))
   destination[row.status]=Number(row.total)||0;
 }
 const {present,absent,late,leave}=daily_trend[6];
 return json({...Object.fromEntries(['rooms','students','daily','period','absent_period','alerts','late'].map((n,i)=>[n,values[i]])),
  daily_statuses:{present,absent,late,leave},daily_trend});
}
async function adminRoutes(req,env,user,path){
 requireRole(user,['admin']);
 if(req.method==='GET'&&path==='/api/admin/student-search')return searchStudents(req,env,user);
 if(path==='/api/admin/advisors/preview'||path==='/api/admin/advisors/commit')return advisorImportEndpoint(req,env,user,path);
 if(path.startsWith('/api/admin/portal/'))return portalAdminRoutes(req,env,user,path);
 if(path==='/api/admin/unified-import/preview'||path==='/api/admin/unified-import/commit')
  return unifiedRosterEndpoint(req,env,user,path);
 if(req.method==='GET'&&path==='/api/admin/users'){
  const {results}=await env.DB.prepare("SELECT id,username,display_name,role,active FROM users ORDER BY display_name").all();
  return json({items:results});
 }
 if(req.method==='POST'&&path==='/api/admin/users'){
  const b=await payload(req),username=String(b.username||'').trim().toLowerCase(), pass=String(b.password||'');
  if(!validUsername(username)||!['teacher','staff','admin'].includes(b.role)||!validateUserPassword(pass,b.role))
   throw error(400,'ชื่อผู้ใช้ไม่ถูกต้อง หรือรหัสผ่านต้องมี '+userPasswordMinimum(b.role)+'–128 ตัว และไม่ใช้เลขประจำตัวประชาชน');
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
  const b=await payload(req),lesson=validateLesson({...b,subject_code:b.subject_code||'ไม่ระบุ'});
  const teacherId=positiveInt(b.teacher_user_id);
  const t=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND active=1").bind(teacherId).first();
  const c=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(lesson.classroom_id).first();
  if(!t||!c)throw error(400,'ไม่พบครูหรือห้องเรียน');
  const clash=await env.DB.prepare(`SELECT id FROM timetable WHERE active=1 AND day_of_week=?
   AND (classroom_id=? OR teacher_user_id=?)
   AND period<=? AND COALESCE(end_period,period)>=? LIMIT 1`)
   .bind(lesson.day_of_week,lesson.classroom_id,teacherId,lesson.end_period,lesson.period).first();
  if(clash)throw error(409,'ตารางสอนซ้อนกับคาบเดิมของครูหรือห้องเรียน');
  const res=await env.DB.prepare(`INSERT INTO timetable
   (classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject)
   VALUES(?,?,?,?,?,?,?)`)
   .bind(lesson.classroom_id,teacherId,lesson.day_of_week,lesson.period,lesson.end_period,lesson.subject_code,lesson.subject).run();
  await log(env.DB,user.id,'timetable_created','timetable',res.meta.last_row_id);
  return json({ok:true,id:res.meta.last_row_id},201);
 }
 if(req.method==='POST'&&(path==='/api/admin/import-students/preview'||path==='/api/admin/import-students')){
  const b=await payload(req),roomId=positiveInt(b.classroom_id);
  if(!roomId||!Array.isArray(b.students)||b.students.length<1||b.students.length>60)
   throw error(400,'กรุณาเลือกห้องและส่งนักเรียนครั้งละ 1–60 คน');
  const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(roomId).first();
  if(!room)throw error(404,'ไม่พบห้องเรียน');
  // One batched lookup compares IDs across the school and roll numbers within the destination room.
  const ids=[...new Set(b.students.map(x=>String(x?.student_no??'').trim().toLowerCase()).filter(x=>x&&x.length<=40))];
  const rolls=[...new Set(b.students.map(x=>Number(x?.roll_no)).filter(x=>Number.isInteger(x)&&x>0&&x<=100))];
  let existing=[];
  if(ids.length||rolls.length){
   const conditions=[],bind=[];
   if(ids.length){conditions.push(`lower(student_no) IN (${ids.map(()=>'?').join(',')})`);bind.push(...ids)}
   if(rolls.length){conditions.push(`(classroom_id=? AND roll_no IN (${rolls.map(()=>'?').join(',')}))`);bind.push(roomId,...rolls)}
   const lookup=await env.DB.prepare('SELECT id,student_no,roll_no,classroom_id FROM students WHERE '+conditions.join(' OR ')).bind(...bind).all();
   existing=lookup.results;
  }
  const credentials=b.students.filter(x=>String(x?.username??'').trim()||x?.password);
  const names=[...new Set(credentials.map(x=>String(x.username||x.student_no||'').trim().toLowerCase())
   .filter(x=>x&&x.length<=40))];
  let registered=[];
  if(names.length){
   const accounts=await env.DB.prepare('SELECT username FROM portal_accounts WHERE lower(username) IN ('+
     names.map(()=>'?').join(',')+')').bind(...names).all();
   registered=accounts.results;
  }
  const plan=planStudentImport(b.students,roomId,existing,registered);
  if(path.endsWith('/preview'))return json(plan);
  if(!plan.ready) return json({error:'พบข้อมูลซ้ำหรือไม่ถูกต้อง กรุณาตรวจรายการก่อนนำเข้า',...plan},409);
  const stmts=plan.items.map(({student})=>env.DB.prepare(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES(?,?,?,?)'
   ).bind(student.student_no,roomId,student.roll_no,student.full_name));
  for(const {student} of plan.items){
   stmts.push(env.DB.prepare(`INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)
    SELECT id,?,?,?,? FROM students WHERE student_no=?`)
     .bind(roomId,student.roll_no,bangkokToday(),user.id,student.student_no));
  }
  // Hash each supplied initial password before one atomic D1 batch.
  for(let i=0;i<plan.items.length;i++){
   const row=plan.items[i],raw=b.students[i];
   if(!row.create_account)continue;
   const salt=randomHex(16);
   const hash=await passwordHash(raw.password,salt);
   stmts.push(env.DB.prepare(`INSERT INTO portal_accounts
    (username,display_name,role,student_id,password_salt,password_hash,created_by)
    SELECT ?,full_name,'student',id,?,?,? FROM students WHERE student_no=?`)
    .bind(row.login_username,salt,hash,user.id,row.student.student_no));
  }
  stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
   .bind(user.id,'students_imported','classrooms',String(roomId)));
  await env.DB.batch(stmts); // atomic; any late duplicate rolls back all rows
  return json({ok:true,ready:true,valid:plan.items.length,errors:0,imported:plan.items.length,accounts:plan.accounts,items:plan.items.map(x=>({...x,status:'imported',message:'นำเข้าสำเร็จ'}))},201);
 }
 if(req.method==='GET'&&path==='/api/admin/transfer-plans'){
  const studentId=positiveInt(new URL(req.url).searchParams.get('student_id'));
  if(!studentId)throw error(400,'กรุณาเลือกนักเรียน');
  const student=await env.DB.prepare('SELECT id FROM students WHERE id=?').bind(studentId).first();
  if(!student)throw error(404,'ไม่พบนักเรียน');
  const {results}=await env.DB.prepare(`SELECT p.id,p.school_year,p.term,CASE WHEN application.id IS NOT NULL THEN 'applied' ELSE p.state END AS state,
   application.effective_date,p.to_classroom_id,p.from_classroom_id,
   source.label AS from_room,dest.label AS to_room
   FROM student_transfer_plans p
   LEFT JOIN student_transfer_applications application ON application.plan_id=p.id
   JOIN classrooms source ON source.id=p.from_classroom_id
   JOIN classrooms dest ON dest.id=p.to_classroom_id
   WHERE p.student_id=? ORDER BY p.school_year DESC,p.term DESC`).bind(studentId).all();
  return json({items:results});
 }
 if(req.method==='POST'&&path==='/api/admin/transfer-plans'){
  const b=await payload(req),studentId=positiveInt(b.student_id),dest=positiveInt(b.to_classroom_id);
  const year=Number(b.school_year),term=Number(b.term),state=b.state||'planned';
  if(!studentId||!dest||!Number.isSafeInteger(year)||year<2500||year>2700||
   ![1,2].includes(term)||!['planned','cancelled'].includes(state))
   throw error(400,'ข้อมูลแผนย้ายห้องไม่ถูกต้อง');
  const student=await env.DB.prepare('SELECT id,classroom_id FROM students WHERE id=? AND active=1').bind(studentId).first();
  const target=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(dest).first();
  if(!student||!target)throw error(404,'ไม่พบนักเรียนหรือห้องปลายทาง');
  if(student.classroom_id===dest)throw error(400,'ห้องปลายทางต้องไม่ใช่ห้องเรียนปัจจุบัน');
  const applied=await env.DB.prepare(`SELECT a.id FROM student_transfer_applications a
   JOIN student_transfer_plans p ON p.id=a.plan_id WHERE p.student_id=? AND p.school_year=? AND p.term=?`)
   .bind(studentId,year,term).first();
  if(applied)throw error(409,'แผนนี้ถูกดำเนินการแล้ว ไม่สามารถแก้ไขย้อนหลัง');
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO student_transfer_plans(student_id,from_classroom_id,to_classroom_id,school_year,term,state,created_by)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(student_id,school_year,term) DO UPDATE SET
      from_classroom_id=excluded.from_classroom_id,to_classroom_id=excluded.to_classroom_id,
      state=excluded.state,created_by=excluded.created_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(studentId,student.classroom_id,dest,year,term,state,user.id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(user.id,'student_transfer_plan_saved','students',String(studentId))
  ]);
  return json({ok:true,message:'บันทึกแผนย้ายห้องแล้ว ยังไม่เปลี่ยนห้องเรียนปัจจุบัน'});
 }
 if(req.method==='GET'&&path==='/api/admin/enrollments'){
  const studentId=positiveInt(new URL(req.url).searchParams.get('student_id'));
  if(!studentId)throw error(400,'กรุณาเลือกนักเรียน');
  const {results}=await env.DB.prepare(`SELECT h.classroom_id,c.label AS classroom_label,h.roll_no,h.start_date,h.end_date
   FROM student_enrollments h JOIN classrooms c ON c.id=h.classroom_id
   WHERE h.student_id=? ORDER BY h.start_date DESC`).bind(studentId).all();
  return json({items:results});
 }
 const transferExecute=/^\/api\/admin\/transfer-plans\/(\d+)\/execute$/.exec(path);
 if(req.method==='POST'&&transferExecute){
  const planId=positiveInt(transferExecute[1]);
  const plan=await env.DB.prepare(`SELECT p.*,s.classroom_id AS current_room,s.roll_no AS current_roll,s.active
   FROM student_transfer_plans p JOIN students s ON s.id=p.student_id WHERE p.id=?`).bind(planId).first();
  if(!plan)throw error(404,'ไม่พบแผนย้ายห้อง');
  if(plan.state!=='planned'||!plan.active)throw error(409,'แผนถูกยกเลิกหรือนักเรียนไม่ได้ใช้งาน');
  if(plan.current_room!==plan.from_classroom_id)throw error(409,'ห้องปัจจุบันไม่ตรงกับแผน กรุณาจัดทำแผนใหม่');
  const already=await env.DB.prepare('SELECT id FROM student_transfer_applications WHERE plan_id=?').bind(planId).first();
  if(already)throw error(409,'ดำเนินการตามแผนนี้แล้ว');
  const today=bangkokToday();
  const active=await env.DB.prepare(`SELECT id,start_date FROM student_enrollments
   WHERE student_id=? AND classroom_id=? AND end_date IS NULL`).bind(plan.student_id,plan.current_room).first();
  if(!active||active.start_date>=today)throw error(409,'ไม่สามารถย้ายห้องซ้ำในวันเดียวกัน หรือข้อมูลการสังกัดห้องไม่ถูกต้อง');
  const hasToday=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM attendance_daily WHERE student_id=? AND school_date=?)
   +(SELECT COUNT(*) FROM attendance_period WHERE student_id=? AND school_date=?)
   +(SELECT COUNT(*) FROM late_records WHERE student_id=? AND school_date=?)
   +(SELECT COUNT(*) FROM attendance_alerts WHERE student_id=? AND school_date=?) AS total`)
   .bind(plan.student_id,today,plan.student_id,today,plan.student_id,today,plan.student_id,today).first();
  if(hasToday.total>0)throw error(409,'มีการเช็กชื่อหรือบันทึกมาสายในวันนี้แล้ว ให้ดำเนินการย้ายก่อนเริ่มเช็กชื่อในวันใหม่');
  const occupied=await env.DB.prepare(`SELECT roll_no FROM student_enrollments
   WHERE classroom_id=? AND end_date IS NULL`).bind(plan.to_classroom_id).all();
  const used=new Set(occupied.results.map(x=>x.roll_no));
  let roll=1;
  while(used.has(roll)&&roll<=100)roll++;
  if(roll>100)throw error(409,'ห้องปลายทางมีเลขที่เต็ม 100 คน');
  await env.DB.batch([
   env.DB.prepare(`UPDATE student_enrollments SET end_date=? WHERE id=? AND end_date IS NULL`).bind(today,active.id),
   env.DB.prepare(`INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)
    VALUES(?,?,?,?,?)`).bind(plan.student_id,plan.to_classroom_id,roll,today,user.id),
   env.DB.prepare(`UPDATE students SET classroom_id=?,roll_no=? WHERE id=? AND classroom_id=?`)
    .bind(plan.to_classroom_id,roll,plan.student_id,plan.from_classroom_id),
   env.DB.prepare(`INSERT INTO student_transfer_applications
    (plan_id,student_id,from_classroom_id,to_classroom_id,old_roll_no,new_roll_no,effective_date,executed_by)
    VALUES(?,?,?,?,?,?,?,?)`)
    .bind(planId,plan.student_id,plan.from_classroom_id,plan.to_classroom_id,plan.current_roll,roll,today,user.id),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(user.id,'student_transferred','students',String(plan.student_id))
  ]);
  return json({ok:true,effective_date:today,roll_no:roll,message:'ย้ายห้องสำเร็จ ประวัติการสังกัดห้องเดิมยังคงอยู่'});
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
  // Student, enrollment and audit must be one transaction, not separate writes.
  const [insert]=await env.DB.batch([
   env.DB.prepare('INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,?)')
    .bind(student.student_no,student.classroom_id,student.roll_no,student.full_name,student.active),
   env.DB.prepare(`INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)
     SELECT id,?,?,?,? FROM students WHERE student_no=?`)
    .bind(student.classroom_id,student.roll_no,bangkokToday(),user.id,student.student_no),
   env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
      SELECT ?,'student_created','students',CAST(id AS TEXT) FROM students WHERE student_no=?`)
    .bind(user.id,student.student_no)
  ]);
  return json({ok:true,id:insert.meta.last_row_id},201);
 }
 const studentEdit = /^\/api\/admin\/students\/(\d+)$/.exec(path);
 if(req.method==='POST'&&studentEdit){
  const id=positiveInt(studentEdit[1]),b=await payload(req);let student;
  try{student=validateStudentInput(b)}catch(e){throw error(400,e.message)}
  const old=await env.DB.prepare('SELECT id,classroom_id FROM students WHERE id=?').bind(id).first();
  if(!old)throw error(404,'ไม่พบนักเรียน');
  const room=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(student.classroom_id).first();
  if(!room)throw error(404,'ไม่พบห้องเรียน');
  if(old.classroom_id!==student.classroom_id)
   throw error(409,'กรุณาใช้แผนย้ายห้องและปุ่มยืนยันย้ายห้อง เพื่อรักษาประวัติการเช็กชื่อ');
  await env.DB.batch([
   env.DB.prepare('UPDATE students SET student_no=?,classroom_id=?,roll_no=?,full_name=?,active=? WHERE id=?')
    .bind(student.student_no,student.classroom_id,student.roll_no,student.full_name,student.active,id),
   env.DB.prepare('UPDATE student_enrollments SET roll_no=? WHERE student_id=? AND end_date IS NULL')
    .bind(student.roll_no,id),
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
async function route(req,env,ctx){
 const url=new URL(req.url),path=url.pathname;
 // Keep the historical service identifier for existing uptime monitors. Expose the new public brand separately.
  if(req.method==='GET'&&path==='/api/health')return json({ok:true,service:'RD Care API',brand:'RD CONNECT',display_name:'RD CONNECT API',time:bangkokToday()});
 if(req.method==='POST'&&path==='/api/setup')return setup(req,env);
 if(req.method==='POST'&&path==='/api/auth/login')return login(req,env);
 if(path.startsWith('/api/portal/'))return portalRoutes(req,env,path,ctx);
 if(req.method==='POST'&&path==='/api/student/late/report')return submitLateSelf(req,env);
 const user=await currentUser(req,env);
 if(req.method==='POST'&&path==='/api/auth/logout'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest((req.headers.get('authorization')||'').slice(7))).run();
  return json({ok:true});
 }
 if(req.method==='GET'&&path==='/api/auth/me')return json({user});
 if(req.method==='GET'&&path==='/api/push/target')return pushTarget(req,env,user,'advisor');
 if(path.startsWith('/api/push/'))return staffPushRoutes(req,env,user,path);
 if(path.startsWith('/api/affairs/'))return studentAffairsRoutes(req,env,user,path);
 if(path.startsWith('/api/late/qr/'))return lateGateStaffRoutes(req,env,user,path);
 if(req.method==='GET'&&path==='/api/classrooms')return classrooms(env,user);
 if(req.method==='GET'&&path==='/api/classrooms/catalog'){
  const {results}=await env.DB.prepare('SELECT id,grade,room,label FROM classrooms ORDER BY grade,room').all();
  return json({items:results});
 }
 if(req.method==='GET'&&path==='/api/my-timetable/week-status')return periodWeekStatus(req,env,user);
 if(req.method==='GET'&&path==='/api/my-timetable/report')return periodCourseReport(req,env,user);
 if(path.startsWith('/api/my-timetable'))return teacherTimetableRoutes(req,env,user,path);
 if(req.method==='GET'&&path==='/api/students')return getStudents(req,env,user);
 if(req.method==='GET'&&path==='/api/timetable')return getTimetable(req,env,user);
 if(req.method==='GET'&&path==='/api/attendance')return getAttendance(req,env,user);
 if(req.method==='POST'&&path==='/api/attendance'){
  const result=await writeAttendance(req,env,user);
  // Only after the successful DB write; never delay or block the teacher's check-in.
  // Scheduled cron also retries the internal advisor outbox.
  if(result.ok&&ctx?.waitUntil)ctx.waitUntil(Promise.all([
   deliverAdvisorPush(env).catch(e=>console.warn('RD advisor push',e?.name)),
   deliverTruancyPush(env).catch(e=>console.warn('RD truancy push',e?.name))
  ]));
  return result;
 }
 if(req.method==='GET'&&path==='/api/truancy/advisor'){
  requireRole(user,['teacher','staff','admin']);
  return json({items:await advisorTruancyItems(env,user)});
 }
 if(req.method==='GET'&&path==='/api/dashboard')return dashboard(req,env,user);
 if(req.method==='POST'&&path==='/api/late/self/code')return issueLateSelfCode(req,env,user);
 if(req.method==='GET'&&path==='/api/late/self/requests')return listLateSelf(req,env,user);
 const lateReview=/^\/api\/late\/self\/requests\/(\d+)\/review$/.exec(path);
 if(req.method==='POST'&&lateReview)return reviewLateSelf(req,env,user,Number(lateReview[1]));
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
 async scheduled(event,env,ctx){
  ctx.waitUntil(Promise.all([
   deliverAdvisorPush(env).catch(e=>console.warn('RD scheduled staff push',e?.name)),
   deliverTruancyPush(env).catch(e=>console.warn('RD scheduled truancy push',e?.name)),
   sendScheduledAttendanceReminders(env).catch(e=>console.warn('RD scheduled daily attendance reminder',e?.name)),
    deliverLateQrPush(env).catch(e=>console.warn('RD scheduled late QR push',e?.name))
  ]));
 },
 async fetch(req,env,ctx){
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
  try{response=await route(req,env,ctx);}
  catch(e){
   const code=/UNIQUE constraint failed/.test(e?.message||'')?409:httpErrorStatus(e);
   if(code===500)console.error('RD CONNECT API:',e);
   response=json({error:code===500?'ระบบขัดข้อง กรุณาลองใหม่':e.message},code);
  }
  const headers=new Headers(response.headers);
  for(const [k,v] of Object.entries(cors))headers.set(k,v);
  return new Response(response.body,{status:response.status,headers});
 }
};
