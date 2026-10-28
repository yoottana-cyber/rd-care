// Immutable term reference data for school administrators.
// Existing timetable IDs and attendance/transfer history are never modified.
import {bangkokToday} from './core.js';
import {getSchoolSettings} from './school-settings.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const json=data=>new Response(JSON.stringify(data),{headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store'
}});
const number=(v,min,max)=>{const n=Number(v);return Number.isSafeInteger(n)&&n>=min&&n<=max&&String(v)===String(n)?n:null};
const label=(year,semester)=>`${year}/${semester}`;
export function selectedTerm(params,defaults){
 const year=params.has('year')?number(params.get('year'),2500,2700):Number(defaults.academic_year);
 const semester=params.has('semester')?number(params.get('semester'),1,2):Number(defaults.semester);
 if(!year||!semester)fail(400,'กรุณาเลือกปีการศึกษาและภาคเรียนที่ถูกต้อง');
 return {year,semester};
}
async function overview(env,term,settings,roomId=0){
 const {year,semester}=term;
 const record=await env.DB.prepare(`SELECT s.academic_year,s.semester,s.snapshot_date,s.semester_start_date,
   s.semester_end_date,s.captured_at,u.display_name AS captured_by
   FROM school_term_snapshots s JOIN users u ON u.id=s.captured_by
   WHERE s.academic_year=? AND s.semester=?`).bind(year,semester).first();
 if(!record&&(year!==Number(settings.academic_year)||semester!==Number(settings.semester)))
  fail(404,'ยังไม่เคยบันทึกชุดข้อมูลอ้างอิงสำหรับภาคเรียนนี้');
 const preview=!record,date=bangkokToday();
 const roomQuery=preview?
  `SELECT c.id,c.grade,c.room,c.label,
   (SELECT COUNT(*) FROM student_enrollments h JOIN students s ON s.id=h.student_id
     WHERE h.classroom_id=c.id AND s.active=1 AND h.start_date<=?
      AND (h.end_date IS NULL OR h.end_date>?)) AS students,
   (SELECT COUNT(*) FROM timetable t WHERE t.classroom_id=c.id AND t.active=1) AS lessons
   FROM classrooms c ORDER BY c.grade,c.room`:
  `SELECT c.id,c.grade,c.room,c.label,
    (SELECT COUNT(*) FROM school_term_roster r WHERE r.academic_year=? AND r.semester=?
       AND r.classroom_id=c.id) AS students,
    (SELECT COUNT(*) FROM school_term_lessons t WHERE t.academic_year=? AND t.semester=?
       AND t.classroom_id=c.id) AS lessons
   FROM classrooms c ORDER BY c.grade,c.room`;
 const params=preview?[date,date]:[year,semester,year,semester];
 const {results:rooms}=await env.DB.prepare(roomQuery).bind(...params).all();
 let students=[],lessons=[];
 if(roomId){
  if(!(rooms||[]).some(r=>r.id===roomId))fail(404,'ไม่พบห้องเรียน');
  const studentQuery=preview?
   `SELECT h.student_id,h.roll_no,s.student_no,s.full_name
    FROM student_enrollments h JOIN students s ON s.id=h.student_id
    WHERE h.classroom_id=? AND s.active=1 AND h.start_date<=?
     AND (h.end_date IS NULL OR h.end_date>?)
    ORDER BY h.roll_no LIMIT 120`:
   `SELECT r.student_id,r.roll_no,s.student_no,s.full_name
    FROM school_term_roster r JOIN students s ON s.id=r.student_id
    WHERE r.academic_year=? AND r.semester=? AND r.classroom_id=?
    ORDER BY r.roll_no LIMIT 120`;
  const lessonQuery=preview?
   `SELECT t.id AS original_timetable_id,t.day_of_week,t.period,
    COALESCE(t.end_period,t.period) AS end_period,t.subject,t.subject_code,
    u.display_name AS teacher_name
    FROM timetable t JOIN users u ON u.id=t.teacher_user_id
    WHERE t.classroom_id=? AND t.active=1 ORDER BY t.day_of_week,t.period`:
   `SELECT t.original_timetable_id,t.day_of_week,t.period,t.end_period,t.subject,
    t.subject_code,u.display_name AS teacher_name
    FROM school_term_lessons t JOIN users u ON u.id=t.teacher_user_id
    WHERE t.academic_year=? AND t.semester=? AND t.classroom_id=?
    ORDER BY t.day_of_week,t.period`;
  const studentArgs=preview?[roomId,date,date]:[year,semester,roomId];
  const lessonArgs=preview?[roomId]:[year,semester,roomId];
  const rows=await env.DB.batch([
   env.DB.prepare(studentQuery).bind(...studentArgs),env.DB.prepare(lessonQuery).bind(...lessonArgs)
  ]);
  students=rows[0].results||[];lessons=rows[1].results||[];
 }
 return {year,semester,preview,record:record||null,rooms:rooms||[],students,lessons,
  source_date:record?.snapshot_date||date};
}
export async function schoolTermRoutes(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบโรงเรียน');
 if(path!=='/api/admin/term-snapshots')fail(404,'ไม่พบ API ข้อมูลภาคเรียน');
 const settings=await getSchoolSettings(env);
 if(req.method==='GET'){
  const q=new URL(req.url).searchParams;
  const term=selectedTerm(q,settings);
  const roomRaw=q.get('classroom_id');
  const roomId=roomRaw===null?0:number(roomRaw,1,99999);
  if(roomRaw!==null&&!roomId)fail(400,'กรุณาเลือกห้องเรียนที่ถูกต้อง');
  const {results:snapshots}=await env.DB.prepare(`SELECT s.academic_year,s.semester,s.snapshot_date,
   s.captured_at,u.display_name AS captured_by,
   (SELECT COUNT(*) FROM school_term_roster r WHERE r.academic_year=s.academic_year
      AND r.semester=s.semester) AS students,
   (SELECT COUNT(*) FROM school_term_lessons t WHERE t.academic_year=s.academic_year
      AND t.semester=s.semester) AS lessons
   FROM school_term_snapshots s JOIN users u ON u.id=s.captured_by
   ORDER BY s.academic_year DESC,s.semester DESC LIMIT 40`).all();
  return json({current:{academic_year:settings.academic_year,semester:settings.semester},
   snapshots:snapshots||[],view:await overview(env,term,settings,roomId)});
 }
 if(req.method!=='POST')fail(405,'ไม่รองรับคำขอนี้');
 const raw=await req.text();
 if(raw.length>1000)fail(413,'ข้อมูลคำขอใหญ่เกินไป');
 let body;try{body=JSON.parse(raw)}catch{fail(400,'รูปแบบคำขอไม่ถูกต้อง')}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['academic_year','semester','confirm'].includes(k))||
  body.confirm!==true)fail(400,'กรุณายืนยันการบันทึกชุดข้อมูลอ้างอิง');
 const year=number(body.academic_year,2500,2700),semester=number(body.semester,1,2);
 if(!year||!semester||year!==Number(settings.academic_year)||semester!==Number(settings.semester))
  fail(409,'ภาคเรียนปัจจุบันเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
 const exists=await env.DB.prepare('SELECT 1 FROM school_term_snapshots WHERE academic_year=? AND semester=?')
  .bind(year,semester).first();
 if(exists)fail(409,'ภาคเรียนนี้บันทึกชุดข้อมูลอ้างอิงไว้แล้ว ไม่อนุญาตให้เขียนทับประวัติ');
 const day=bangkokToday();
 // Four statements run atomically; each INSERT SELECT scales to full school roster
 // without sending individual student IDs or >100 D1 bind parameters.
 try{
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO school_term_snapshots
    (academic_year,semester,snapshot_date,semester_start_date,semester_end_date,captured_by)
    VALUES(?,?,?,?,?,?)`).bind(year,semester,day,settings.semester_start_date,settings.semester_end_date,user.id),
   env.DB.prepare(`INSERT INTO school_term_roster
    (academic_year,semester,student_id,classroom_id,roll_no)
    SELECT ?,?,h.student_id,h.classroom_id,h.roll_no
    FROM student_enrollments h JOIN students s ON s.id=h.student_id
    WHERE s.active=1 AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)`)
    .bind(year,semester,day,day),
   env.DB.prepare(`INSERT INTO school_term_lessons
    (academic_year,semester,original_timetable_id,classroom_id,teacher_user_id,day_of_week,
     period,end_period,subject_code,subject)
    SELECT ?,?,t.id,t.classroom_id,t.teacher_user_id,t.day_of_week,t.period,
     COALESCE(t.end_period,t.period),COALESCE(t.subject_code,''),t.subject
    FROM timetable t WHERE t.active=1`).bind(year,semester),
   env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
    VALUES(?,'school_term_snapshot_created','school_term_snapshots',?)`)
    .bind(user.id,label(year,semester))
  ]);
 }catch(e){
  if(/UNIQUE constraint/i.test(String(e?.message||'')))
   fail(409,'ภาคเรียนนี้บันทึกข้อมูลไว้แล้ว กรุณาโหลดข้อมูลใหม่');
  throw e;
 }
 return json({ok:true,view:await overview(env,{year,semester},settings)});
}
