// Administrative oversight only. Teachers remain able to add lessons without approval.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=data=>new Response(JSON.stringify(data),{headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store'
}});
export function timetableClashes(rows){
 const overlaps=[],byDay=new Map();
 for(const row of rows){
  if(Number(row.active)!==1)continue;
  const key=Number(row.day_of_week);
  const previous=byDay.get(key)||[];
  for(const old of previous){
   if(Number(old.period)>Number(row.end_period)||
      Number(row.period)>Number(old.end_period))continue;
   const reasons=[];
   if(Number(old.classroom_id)===Number(row.classroom_id))reasons.push('room');
   if(Number(old.teacher_user_id)===Number(row.teacher_user_id))reasons.push('teacher');
   if(reasons.length)overlaps.push({first_id:old.id,second_id:row.id,reasons,
    day_of_week:key,period:Math.max(old.period,row.period)});
  }
  previous.push(row);byDay.set(key,previous);
 }
 return overlaps;
}
export async function adminTimetableAudit(req,env,user){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบโรงเรียน');
 if(req.method!=='GET')fail(405,'หน้านี้ใช้ตรวจสอบเท่านั้น');
 const {results}=await env.DB.prepare(`SELECT t.id,t.classroom_id,t.teacher_user_id,t.day_of_week,t.period,
  COALESCE(t.end_period,t.period) AS end_period,t.subject_code,t.subject,t.active,t.approval_status,
  c.label AS classroom_label,u.display_name AS teacher_name
  FROM timetable t JOIN classrooms c ON c.id=t.classroom_id
  JOIN users u ON u.id=t.teacher_user_id
  ORDER BY t.day_of_week,t.period,c.grade,c.room,t.id LIMIT 3000`).all();
 const items=results||[];
 return reply({items,clashes:timetableClashes(items),truncated:items.length>=3000,
  approval_required:false});
}
