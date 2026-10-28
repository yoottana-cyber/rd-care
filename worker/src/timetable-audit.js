import {getSchoolSettings} from './school-settings.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=data=>new Response(JSON.stringify(data),{headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store'
}});
const valid=(v,min,max)=>{const n=Number(v);return Number.isSafeInteger(n)&&n>=min&&n<=max&&String(v)===String(n)?n:null};
export function timetableClashes(rows){
 const issues=[],byDay=new Map();
 for(const row of rows){
  if(Number(row.active)!==1)continue;
  const key=String(row.day_of_week);
  const previous=byDay.get(key)||[];
  for(const other of previous){
   if(Number(row.period)>Number(other.end_period)||Number(other.period)>Number(row.end_period))continue;
   const reasons=[];
   if(Number(row.classroom_id)===Number(other.classroom_id))reasons.push('room');
   if(Number(row.teacher_user_id)===Number(other.teacher_user_id))reasons.push('teacher');
   if(reasons.length)issues.push({first_id:other.id,second_id:row.id,reasons,
    classroom:row.classroom_label,teacher:row.teacher_name,
    day_of_week:row.day_of_week,period:Math.max(row.period,other.period)});
  }
  previous.push(row);byDay.set(key,previous);
 }
 return issues;
}
export async function adminTimetableAudit(req,env,user){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบโรงเรียน');
 if(req.method!=='GET')fail(405,'ตรวจสอบได้อย่างเดียว');
 const cfg=await getSchoolSettings(env),q=new URL(req.url).searchParams;
 const academicYear=q.has('year')?valid(q.get('year'),2500,2700):Number(cfg.academic_year);
 const semester=q.has('semester')?valid(q.get('semester'),1,2):Number(cfg.semester);
 if(!academicYear||!semester)fail(400,'ปีการศึกษาหรือภาคเรียนไม่ถูกต้อง');
 const {results:terms}=await env.DB.prepare(`SELECT DISTINCT academic_year,semester FROM timetable
  ORDER BY academic_year DESC,semester DESC LIMIT 30`).all();
 const {results}=await env.DB.prepare(`SELECT t.id,t.academic_year,t.semester,t.classroom_id,
   t.teacher_user_id,t.day_of_week,t.period,COALESCE(t.end_period,t.period) AS end_period,
   t.subject_code,t.subject,t.active,t.approval_status,
   c.label AS classroom_label,u.display_name AS teacher_name
   FROM timetable t JOIN classrooms c ON c.id=t.classroom_id
   JOIN users u ON u.id=t.teacher_user_id
   WHERE t.academic_year=? AND t.semester=?
   ORDER BY t.day_of_week,t.period,c.grade,c.room,t.id LIMIT 3000`)
   .bind(academicYear,semester).all();
 const entries=results||[];
 return reply({current:{academic_year:cfg.academic_year,semester:cfg.semester},
  academic_year:academicYear,semester,terms:terms||[],
  items:entries,clashes:timetableClashes(entries),truncated:entries.length>=3000,
  no_approval:true});
}
