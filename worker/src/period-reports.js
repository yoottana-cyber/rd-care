// Staff-only reporting for the signed-in teacher's own activated timetable.
// Counts reflect saved period-attendance rows, not inferred absences.
import {validDate,bangkokToday,weekday} from './core.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const json=(value)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const asId=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};
const utcDate=x=>Date.parse(x+'T12:00:00Z');
function dateRange(q,maxDays=184){
 const from=q.get('from'),to=q.get('to');
 if(!validDate(from)||!validDate(to))fail(400,'กรุณาเลือกช่วงวันที่ที่ถูกต้อง');
 const days=(utcDate(to)-utcDate(from))/86400000;
 if(days<0||days>maxDays)fail(400,'ช่วงวันที่ต้องเรียงตามลำดับและไม่เกิน '+(maxDays+1)+' วัน');
 if(utcDate(to)>utcDate(bangkokToday()))fail(400,'ไม่สามารถแสดงรายงานของวันในอนาคต');
 return {from,to};
}
export function verifyWeekStart(value){
 if(!validDate(value)||weekday(value)!==1)fail(400,'กรุณาเลือกวันจันทร์เริ่มต้นสัปดาห์');
 return value;
}
export async function periodWeekStatus(req,env,user){
 if(user.role!=='teacher')fail(403,'เฉพาะครูผู้สอน');
 const monday=verifyWeekStart(new URL(req.url).searchParams.get('start'));
 const last=new Date(utcDate(monday)+6*86400000).toISOString().slice(0,10);
 const {results}=await env.DB.prepare(`SELECT a.timetable_id,a.school_date,COUNT(*) AS recorded,
  SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent,
  SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) AS late,
  SUM(CASE WHEN a.status='leave' THEN 1 ELSE 0 END) AS leave
  FROM attendance_period a JOIN timetable t ON t.id=a.timetable_id
  WHERE t.teacher_user_id=? AND t.active=1 AND a.school_date BETWEEN ? AND ?
  GROUP BY a.timetable_id,a.school_date`).bind(user.id,monday,last).all();
 return json({items:results,from:monday,to:last});
}
export async function periodCourseReport(req,env,user){
 if(user.role!=='teacher')fail(403,'เฉพาะครูผู้สอน');
 const q=new URL(req.url).searchParams;
 const {from,to}=dateRange(q);
 const selected=q.has('timetable_id')?asId(q.get('timetable_id')):null;
 if(q.has('timetable_id')&&!selected)fail(400,'กรุณาเลือกรายวิชา');
 if(selected){
  // Ownership and activation must be verified before any student event data is read.
  const own=await env.DB.prepare('SELECT id FROM timetable WHERE id=? AND teacher_user_id=? AND active=1')
   .bind(selected,user.id).first();
  if(!own)fail(404,'ไม่พบรายวิชาของครู');
  const {results}=await env.DB.prepare(`SELECT a.school_date,a.status,h.roll_no,
    s.full_name,s.student_no
    FROM attendance_period a
    JOIN timetable t ON t.id=a.timetable_id
    JOIN students s ON s.id=a.student_id
    JOIN student_enrollments h ON h.student_id=a.student_id
       AND h.classroom_id=t.classroom_id AND h.start_date<=a.school_date
       AND (h.end_date IS NULL OR h.end_date>a.school_date)
    WHERE t.id=? AND t.teacher_user_id=? AND a.school_date BETWEEN ? AND ?
      AND a.status!='present'
    ORDER BY a.school_date DESC,h.roll_no LIMIT 500`)
    .bind(selected,user.id,from,to).all();
  const {results:teachingLogs}=await env.DB.prepare(`SELECT school_date,note,updated_at
   FROM period_teaching_logs WHERE timetable_id=? AND school_date BETWEEN ? AND ?
   ORDER BY school_date DESC LIMIT 185`).bind(selected,from,to).all();
  return json({items:results,teaching_logs:teachingLogs,from,to,limited:results.length>=500});
 }
 const {results}=await env.DB.prepare(`SELECT t.id AS timetable_id,t.classroom_id,t.day_of_week,t.period,
  COALESCE(t.end_period,t.period) AS end_period,t.subject,t.subject_code,
  c.label AS classroom_label,
  COUNT(a.student_id) AS recorded,
  COUNT(DISTINCT a.school_date) AS dates_recorded,
  SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
  SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent,
  SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) AS late,
  SUM(CASE WHEN a.status='leave' THEN 1 ELSE 0 END) AS leave
  FROM timetable t JOIN classrooms c ON c.id=t.classroom_id
  LEFT JOIN attendance_period a ON a.timetable_id=t.id AND a.school_date BETWEEN ? AND ?
  WHERE t.teacher_user_id=? AND t.active=1
  GROUP BY t.id
  ORDER BY c.grade,c.room,t.day_of_week,t.period`)
  .bind(from,to,user.id).all();
 return json({items:results,from,to});
}
