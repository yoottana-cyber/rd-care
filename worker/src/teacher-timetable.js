// Teacher-owned, term-scoped timetable: immediate activation without admin approval.
// This does not grant daily (homeroom) attendance rights; the timetable grants only period attendance.
// The database approval_status='approved' is retained as a legacy active-state marker, not an approval workflow.
// Keep actor ownership checks, classroom/teacher period conflicts, and attendance-history protections.
import {getSchoolSettings} from './school-settings.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const int=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null};
export const periodLabel=(start,end=start)=>start===end?String(start):start+'-'+end;
export function validateLesson(input){
 const classroom_id=int(input.classroom_id);
 const day_of_week=int(input.day_of_week);
 const period=int(input.period),end_period=int(input.end_period??input.period);
 const subject_code=typeof input.subject_code==='string'?input.subject_code.trim():'';
 const subject=typeof input.subject==='string'?input.subject.trim():'';
 if(!classroom_id||!day_of_week||day_of_week>7||!period||period>10||
    !end_period||end_period>10||end_period<period||end_period-period>1)
  fail(400,'เลือกวันและคาบเรียนให้ถูกต้อง (1 ถึง 10 หรือคาบคู่ที่ต่อเนื่อง เช่น 1-2)');
 if(!subject||subject.length>120||!subject_code||subject_code.length>30||
    /[\u0000-\u001f\u007f<>]/.test(subject_code+subject))
  fail(400,'กรุณากรอกรหัสวิชา (ไม่เกิน 30 ตัว) และชื่อวิชา (ไม่เกิน 120 ตัว)');
 return {classroom_id,day_of_week,period,end_period,subject_code,subject};
}
export function lessonOverlaps(a,b){
 return (a.academic_year===undefined||b.academic_year===undefined||a.academic_year===b.academic_year) &&
  (a.semester===undefined||b.semester===undefined||a.semester===b.semester) &&
  a.day_of_week===b.day_of_week &&
  a.period <= (b.end_period??b.period) && (a.end_period??a.period)>=b.period &&
  (a.classroom_id===b.classroom_id||a.teacher_user_id===b.teacher_user_id);
}
async function body(req){
 const raw=await req.text();
 if(raw.length>12000)fail(413,'ข้อมูลตารางสอนใหญ่เกินไป');
 try{const b=JSON.parse(raw);if(!b||Array.isArray(b)||typeof b!=='object')throw Error();return b}
 catch{fail(400,'ข้อมูลตารางสอนไม่ถูกต้อง')}
}
async function verifyRoom(env,id){
 const r=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(id).first();
 if(!r)fail(404,'ไม่พบห้องเรียน');
}
async function noConflict(env,lesson,teacherId,term,skipId=0){
 const rows=await env.DB.prepare(`SELECT t.id,t.period,COALESCE(t.end_period,t.period) AS end_period,
   c.label AS room_label,u.display_name AS teacher_name
  FROM timetable t JOIN classrooms c ON c.id=t.classroom_id
  JOIN users u ON u.id=t.teacher_user_id
  WHERE t.active=1 AND t.academic_year=? AND t.semester=?
    AND t.day_of_week=? AND t.id<>?
    AND (t.classroom_id=? OR t.teacher_user_id=?)
    AND t.period<=? AND COALESCE(t.end_period,t.period)>=? LIMIT 1`)
  .bind(term.academic_year,term.semester,lesson.day_of_week,skipId,lesson.classroom_id,teacherId,lesson.end_period,lesson.period).first();
 if(rows)fail(409,'ตารางสอนซ้อน: '+rows.room_label+' คาบ '+periodLabel(rows.period,rows.end_period)+' ครู '+rows.teacher_name);
}
async function myTimetable(env,user,req){
 const term=await getSchoolSettings(env);
 const q=new URL(req.url).searchParams;
 const year=q.has('year')?Number(q.get('year')):Number(term.academic_year);
 const semester=q.has('semester')?Number(q.get('semester')):Number(term.semester);
 if(!Number.isInteger(year)||year<2500||year>2700||![1,2].includes(semester))
  fail(400,'ปีการศึกษาหรือภาคเรียนไม่ถูกต้อง');
 const {results}=await env.DB.prepare(`SELECT t.id,t.classroom_id,t.day_of_week,t.period,
   COALESCE(t.end_period,t.period) AS end_period,t.subject_code,t.subject,t.active,t.approval_status,
   t.academic_year,t.semester,c.label AS classroom_label
   FROM timetable t JOIN classrooms c ON c.id=t.classroom_id
   WHERE t.teacher_user_id=? AND t.academic_year=? AND t.semester=?
    AND t.approval_status<>'archived' ORDER BY t.day_of_week,t.period,c.grade,c.room`)
   .bind(user.id,year,semester).all();
 const {results:terms}=await env.DB.prepare(`SELECT DISTINCT academic_year,semester FROM timetable
    WHERE teacher_user_id=? ORDER BY academic_year DESC,semester DESC LIMIT 24`).bind(user.id).all();
 return response({items:results,term:{academic_year:year,semester},
  current:{academic_year:term.academic_year,semester:term.semester},
  editable:year===Number(term.academic_year)&&semester===Number(term.semester),terms:terms||[]});
}
async function saveLesson(req,env,user,id){
 const lesson=validateLesson(await body(req));
 const term=await getSchoolSettings(env);
 await verifyRoom(env,lesson.classroom_id);
 if(id){
  const old=await env.DB.prepare("SELECT id,teacher_user_id,academic_year,semester FROM timetable WHERE id=? AND approval_status<>'archived'").bind(id).first();
  if(!old)fail(404,'ไม่พบตารางสอนนี้');
  if(old.teacher_user_id!==user.id)fail(403,'แก้ไขได้เฉพาะตารางสอนของตนเอง');
  if(old.academic_year!==Number(term.academic_year)||old.semester!==Number(term.semester))
   fail(409,'แก้ไขได้เฉพาะตารางสอนภาคเรียนปัจจุบัน รายการเดิมเปิดดูได้ย้อนหลัง');
  const exists=await env.DB.prepare('SELECT 1 FROM attendance_period WHERE timetable_id=? LIMIT 1').bind(id).first();
  if(exists)fail(409,'คาบนี้มีประวัติเช็กชื่อแล้ว ไม่สามารถเปลี่ยนตารางสอนได้');
 }
 await noConflict(env,lesson,user.id,term,id||0);
 let changedId=id;
 if(id){
  const result=await env.DB.prepare(`UPDATE timetable SET classroom_id=?,day_of_week=?,period=?,
   end_period=?,subject_code=?,subject=?,active=1,approval_status='approved',reviewed_by=NULL,reviewed_at=NULL WHERE id=? AND teacher_user_id=? AND academic_year=? AND semester=? AND approval_status<>'archived'
   AND NOT EXISTS (SELECT 1 FROM attendance_period WHERE timetable_id=?)`)
   .bind(lesson.classroom_id,lesson.day_of_week,lesson.period,lesson.end_period,
    lesson.subject_code,lesson.subject,id,user.id,term.academic_year,term.semester,id).run();
  if(!result.meta.changes)fail(409,'ตารางสอนถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่');
 }else{
  const result=await env.DB.prepare(`INSERT INTO timetable
   (classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject,active,approval_status,academic_year,semester)
   VALUES(?,?,?,?,?,?,?,1,'approved',?,?)`).bind(lesson.classroom_id,user.id,lesson.day_of_week,lesson.period,
      lesson.end_period,lesson.subject_code,lesson.subject,term.academic_year,term.semester).run();
  changedId=result.meta.last_row_id;
 }
 await env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
  .bind(user.id,id?'teacher_timetable_updated':'teacher_timetable_created','timetable',String(changedId)).run();
 return response({ok:true,id:changedId,approval_status:'approved',message:'บันทึกตารางสอนสำเร็จ พร้อมเช็กชื่อรายคาบได้ทันที'},id?200:201);
}
async function archiveLesson(env,user,id){
 const term=await getSchoolSettings(env);
 const lesson=await env.DB.prepare("SELECT id,teacher_user_id,academic_year,semester FROM timetable WHERE id=? AND approval_status<>'archived'").bind(id).first();
 if(!lesson)fail(404,'ไม่พบตารางสอนนี้');
 if(lesson.teacher_user_id!==user.id)fail(403,'ลบได้เฉพาะตารางสอนของตนเอง');
 if(lesson.academic_year!==Number(term.academic_year)||lesson.semester!==Number(term.semester))
  fail(409,'ไม่สามารถลบตารางสอนของภาคเรียนย้อนหลัง');
 const exists=await env.DB.prepare('SELECT 1 FROM attendance_period WHERE timetable_id=? LIMIT 1').bind(id).first();
 if(exists)fail(409,'มีประวัติเช็กชื่อแล้ว ไม่สามารถลบคาบเรียนได้');
 const result=await env.DB.prepare(`UPDATE timetable SET active=0,approval_status='archived' WHERE id=? AND teacher_user_id=? AND academic_year=? AND semester=?
  AND approval_status<>'archived' AND NOT EXISTS(SELECT 1 FROM attendance_period WHERE timetable_id=?)`)
  .bind(id,user.id,term.academic_year,term.semester,id).run();
 if(!result.meta.changes)fail(409,'ไม่สามารถลบตารางสอนที่เปลี่ยนแปลงไปแล้ว');
 await env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
  .bind(user.id,'teacher_timetable_archived','timetable',String(id)).run();
 return response({ok:true});
}
export async function teacherTimetableRoutes(req,env,user,path){
 if(user.role!=='teacher')fail(403,'เฉพาะบัญชีครูผู้สอนเท่านั้น');
 if(path==='/api/my-timetable'&&req.method==='GET')return myTimetable(env,user,req);
 if(path==='/api/my-timetable'&&req.method==='POST')return saveLesson(req,env,user,null);
 const edit=/^\/api\/my-timetable\/(\d+)\/(update|archive)$/.exec(path);
 if(edit&&req.method==='POST'){
  const id=int(edit[1]);if(!id)fail(400,'รหัสคาบเรียนไม่ถูกต้อง');
  return edit[2]==='archive'?archiveLesson(env,user,id):saveLesson(req,env,user,id);
 }
 fail(404,'ไม่พบ API ตารางสอน');
}
