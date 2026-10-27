// Auto-approved late QR attendance for authenticated students, reversible
// by school staff without overwriting a subsequent teacher's daily edit.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
export async function autoApproveLateQr(env,{studentId,day,arrival,reason}){
 const system=await env.DB.prepare(`SELECT id FROM users
  WHERE username='rd-care-late-system' AND active=0 LIMIT 1`).first();
 if(!system)fail(503,'ยังไม่ติดตั้งระบบลงชื่อมาสายอัตโนมัติในฐานข้อมูล');
 // All writes are ordered within one D1 transaction. The uniqueness constraint
 // in late_self_requests prevents two simultaneous phone submissions.
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO late_self_requests
    (student_id,school_date,arrived_at,reason,state,verified_by,reviewed_at)
    VALUES(?,?,?,?,'verified',?,CURRENT_TIMESTAMP)`)
   .bind(studentId,day,arrival,reason,system.id),
  env.DB.prepare(`INSERT INTO late_static_qr_submissions(request_id,student_id,school_date)
    SELECT id,?,? FROM late_self_requests WHERE student_id=? AND school_date=?`)
   .bind(studentId,day,studentId,day),
  env.DB.prepare(`INSERT INTO late_qr_auto_events
    (request_id,student_id,school_date,previous_daily_status,previous_daily_recorded_by)
    SELECT r.id,r.student_id,r.school_date,d.status,d.recorded_by
    FROM late_self_requests r
    LEFT JOIN attendance_daily d ON d.student_id=r.student_id AND d.school_date=r.school_date
    WHERE r.student_id=? AND r.school_date=?`).bind(studentId,day),
  env.DB.prepare(`INSERT INTO late_records
    (student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
    VALUES(?,?,?,?,'verified',?,?)`).bind(studentId,day,arrival,reason,system.id,system.id),
  env.DB.prepare(`INSERT INTO attendance_daily(student_id,school_date,status,recorded_by)
    VALUES(?,?,'late',?) ON CONFLICT(student_id,school_date)
    DO UPDATE SET status='late',recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
   .bind(studentId,day,system.id),
  env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
    VALUES(NULL,'late_qr_auto_approved','students',?)`).bind(String(studentId)+':'+day)
 ]);
 return {ok:true,date:day,arrivedAt:arrival,state:'verified',dailyStatus:'late',
  message:'ลงชื่อมาสายสำเร็จ ระบบยืนยันอัตโนมัติและบันทึกเช็กชื่อรายวันเป็น สาย แล้ว'};
}
export async function revokeAutoLateQr(env,actor,id){
 if(!['teacher','staff','admin'].includes(actor?.role))fail(403,'ไม่มีสิทธิ์ลบรายการ');
 if(!Number.isSafeInteger(id)||id<1)fail(400,'รายการไม่ถูกต้อง');
 const event=await env.DB.prepare(`SELECT e.id,e.request_id,e.student_id,
   e.school_date,e.previous_daily_status,e.previous_daily_recorded_by,e.active,
   c.advisor_user_id
  FROM late_qr_auto_events e
  JOIN student_enrollments h ON h.student_id=e.student_id
   AND h.start_date<=e.school_date AND (h.end_date IS NULL OR h.end_date>e.school_date)
  JOIN classrooms c ON c.id=h.classroom_id WHERE e.id=?`).bind(id).first();
 if(!event)fail(404,'ไม่พบรายการมาสายอัตโนมัติ');
 if(actor.role==='teacher'&&event.advisor_user_id!==actor.id)
  fail(403,'เฉพาะครูที่ปรึกษาของนักเรียนหรือฝ่ายกิจการนักเรียนเท่านั้นที่ลบรายการได้');
 if(!event.active)fail(409,'รายการนี้ถูกลบไปแล้ว');
 const system=await env.DB.prepare(`SELECT id FROM users
  WHERE username='rd-care-late-system' AND active=0`).first();
 if(!system)fail(503,'ไม่พบบัญชีระบบมาสายอัตโนมัติ');
 const stmts=[
  env.DB.prepare(`UPDATE late_qr_auto_events SET active=0,deleted_by=?,deleted_at=CURRENT_TIMESTAMP
   WHERE id=? AND active=1`).bind(actor.id,id),
  env.DB.prepare(`UPDATE late_self_requests
    SET state='rejected',verified_by=?,reviewed_at=CURRENT_TIMESTAMP
    WHERE id=? AND state='verified'`).bind(actor.id,event.request_id),
  env.DB.prepare(`DELETE FROM late_records
    WHERE student_id=? AND school_date=? AND recorded_by=?`)
   .bind(event.student_id,event.school_date,system.id)
 ];
 // Restore daily record only if it is still the QR system's own entry.
 // Never silently undo a later human teacher correction.
 if(event.previous_daily_status===null){
  stmts.push(env.DB.prepare(`DELETE FROM attendance_daily
   WHERE student_id=? AND school_date=? AND status='late' AND recorded_by=?`)
  .bind(event.student_id,event.school_date,system.id));
 }else{
  stmts.push(env.DB.prepare(`UPDATE attendance_daily
    SET status=?,recorded_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE student_id=? AND school_date=? AND status='late' AND recorded_by=?`)
   .bind(event.previous_daily_status,event.previous_daily_recorded_by,
    event.student_id,event.school_date,system.id));
 }
 stmts.push(env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
   VALUES(?,'late_qr_auto_deleted','late_qr_auto_events',?)`).bind(actor.id,String(id)));
 const results=await env.DB.batch(stmts);
 if(!results[0]?.meta?.changes)fail(409,'รายการนี้ถูกลบไปแล้ว');
 return {ok:true,deleted:true,restoredDaily:!!results[3]?.meta?.changes,
  message:'ลบรายการมาสายอัตโนมัติแล้ว พร้อมคืนสถานะเช็กชื่อเดิมเมื่อไม่มีการแก้ไขใหม่'};
}
