// Notification details are resolved only after login and strict audience scoping.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
export async function pushTarget(req,env,actor,audience){
 if(req.method!=='GET')fail(405,'ไม่รองรับวิธีเรียกนี้');
 if(audience==='guardian'){
  if(actor?.role!=='guardian'||!actor.active||actor.must_change_password)fail(403,'ไม่มีสิทธิ์');
 }else if(audience==='advisor'){
  if(!['teacher','staff','admin'].includes(actor?.role))fail(403,'ไม่มีสิทธิ์');
 }else fail(403,'ไม่มีสิทธิ์');
 const q=new URL(req.url).searchParams,kind=q.get('kind'),raw=q.get('id');
 if(!['truancy','late','attendance_review'].includes(kind)||!/^\d{1,15}$/.test(raw||''))fail(400,'เลขอ้างอิงไม่ถูกต้อง');
 const id=Number(raw);
 if(!Number.isSafeInteger(id)||id<1)fail(400,'เลขอ้างอิงไม่ถูกต้อง');
 if(kind==='attendance_review'&&audience==='guardian')fail(403,'ไม่มีสิทธิ์');
 const scope=audience==='guardian'
  ?'EXISTS(SELECT 1 FROM guardian_student_links g WHERE g.guardian_account_id=? AND g.student_id=e.student_id)'
  :"(? IN ('staff','admin') OR c.advisor_user_id=?)";
 const sql=kind==='truancy'?`SELECT e.id,e.school_date,e.student_id,s.full_name,
   c.id AS classroom_id,c.label AS classroom_label,t.period,t.subject,
   NULL AS arrived_at,NULL AS reason
   FROM truancy_events e
   JOIN period_truancy tr ON tr.student_id=e.student_id AND tr.timetable_id=e.timetable_id AND tr.school_date=e.school_date
   JOIN attendance_period p ON p.student_id=e.student_id AND p.timetable_id=e.timetable_id
     AND p.school_date=e.school_date AND p.status='absent'
   JOIN timetable t ON t.id=e.timetable_id
   JOIN classrooms c ON c.id=t.classroom_id
   JOIN students s ON s.id=e.student_id AND s.active=1
   WHERE e.id=? AND e.active=1 AND ${scope}`:
  kind==='attendance_review'?`SELECT e.id,e.school_date,e.student_id,s.full_name,
   c.id AS classroom_id,c.label AS classroom_label,t.period,t.subject,
   NULL AS arrived_at,NULL AS reason
   FROM attendance_alerts e
   JOIN timetable t ON t.id=e.timetable_id
   JOIN classrooms c ON c.id=t.classroom_id
   JOIN students s ON s.id=e.student_id AND s.active=1
   WHERE e.id=? AND e.state='pending_review' AND ${scope}`:
  `SELECT e.id,e.school_date,e.student_id,s.full_name,
   c.id AS classroom_id,c.label AS classroom_label,NULL AS period,NULL AS subject,
   r.arrived_at,r.reason
   FROM late_qr_auto_events e
   JOIN late_self_requests r ON r.id=e.request_id AND r.state='verified'
   JOIN students s ON s.id=e.student_id AND s.active=1
   JOIN student_enrollments h ON h.student_id=e.student_id
     AND h.start_date<=e.school_date AND (h.end_date IS NULL OR h.end_date>e.school_date)
   JOIN classrooms c ON c.id=h.classroom_id
   WHERE e.id=? AND e.active=1 AND ${scope}`;
 const args=audience==='guardian'?[id,actor.id]:[id,actor.role,actor.id];
 const item=await env.DB.prepare(sql).bind(...args).first();
 if(!item)fail(404,'รายการถูกแก้ไขหรือคุณไม่มีสิทธิ์ดูรายละเอียด');
 return new Response(JSON.stringify({kind,...item}),{headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
