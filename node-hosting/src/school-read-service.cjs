'use strict';
// RD CONNECT batch 1 — authenticated READ-ONLY school workflows.
// Ported from D1 roster/attendance/portal semantics where schemas match.
// This module is NOT imported by Passenger (http-handler.cjs).
// All room/student access derived from token-backed staff/portal sessions.
const {me}=require('./staging-auth-service.cjs');
const fail=(status,code)=>{const e=Error(code);e.status=status;throw e};
const asId=n=>Number.isSafeInteger(Number(n))&&Number(n)>0&&String(n).trim()!==''?Number(n):null;
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function validDate(v){
 if(typeof v!=='string'||!DATE.test(v))return false;
 const d=new Date(v+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function dateRange(from,to){
 if(!validDate(from)||!validDate(to)||from>to)fail(400,'invalid_date');
 const days=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(days>89)fail(400,'date_range_too_large');
 return {from,to};
}
function ensureAccount(user,roles){
 if(!user||!roles.includes(user.role))fail(403,'forbidden');
 return user;
}
async function trustedSession(conn,kind,authorization){
 if(!['staff','portal'].includes(kind))fail(401,'authentication_required');
 const result=await me(conn,{kind,authorization});
 const user=kind==='staff'?result.user:result.account;
 ensureAccount(user,kind==='staff'?['admin','staff','teacher']:['student','guardian']);
 return {kind,...user};
}
async function assertRoom(conn,user,roomId,mode='view'){
 if(user.kind!=='staff')fail(403,'forbidden');
 const id=asId(roomId);if(!id)fail(400,'invalid_room');
 const [rows]=await conn.execute(
  'SELECT id,advisor_user_id,advisor2_user_id FROM classrooms WHERE id=? LIMIT 1',[id]);
 const room=rows[0];if(!room)fail(404,'not_found');
 if(user.role==='admin'||(mode==='view'&&user.role==='staff'))return room;
 if(Number(room.advisor_user_id)===user.id||Number(room.advisor2_user_id)===user.id)
  return room;
 if(mode==='view'){
  const [slots]=await conn.execute(
   'SELECT 1 AS allowed FROM timetable WHERE classroom_id=? AND teacher_user_id=? AND active=1 LIMIT 1',
   [id,user.id]);
  if(slots.length)return room;
 }
 fail(403,'forbidden');
}
async function listRooms(conn,user){
 if(user.kind!=='staff')fail(403,'forbidden');
 if(user.role==='admin'||user.role==='staff'){
  const [rows]=await conn.execute(
   'SELECT id,grade,room,label,advisor_user_id,advisor2_user_id FROM classrooms ORDER BY grade,room');
  return {items:rows};
 }
 const [rows]=await conn.execute(
  `SELECT DISTINCT c.id,c.grade,c.room,c.label,c.advisor_user_id,c.advisor2_user_id
   FROM classrooms c LEFT JOIN timetable t
    ON t.classroom_id=c.id AND t.teacher_user_id=? AND t.active=1
   WHERE c.advisor_user_id=? OR c.advisor2_user_id=? OR t.id IS NOT NULL
   ORDER BY c.grade,c.room`,[user.id,user.id,user.id]);
 return {items:rows};
}
async function roster(conn,user,roomId,date){
 if(!validDate(date))fail(400,'invalid_date');
 const room=await assertRoom(conn,user,roomId);
 const [rows]=await conn.execute(
  `SELECT s.id,s.student_no,h.roll_no,s.full_name
   FROM students s JOIN student_enrollments h ON h.student_id=s.id
   WHERE s.active=1 AND h.classroom_id=?
    AND h.start_date<=? AND (h.end_date IS NULL OR h.end_date>?)
   ORDER BY h.roll_no,s.student_no LIMIT 120`,
  [room.id,date,date]);
 return {items:rows};
}
async function dailyAttendance(conn,user,roomId,date){
 if(!validDate(date))fail(400,'invalid_date');
 const room=await assertRoom(conn,user,roomId,'daily');
 const [rows]=await conn.execute(
  `SELECT s.id AS student_id,s.student_no,s.full_name,h.roll_no,
      d.status,d.recorded_by,d.updated_at
   FROM student_enrollments h
   JOIN students s ON s.id=h.student_id AND s.active=1
   LEFT JOIN attendance_daily d ON d.student_id=s.id AND d.school_date=?
   WHERE h.classroom_id=? AND h.start_date<=?
     AND (h.end_date IS NULL OR h.end_date>?)
   ORDER BY h.roll_no,s.student_no LIMIT 120`,
  [date,room.id,date,date]);
 return {school_date:date,items:rows};
}
async function savedDailyAttendance(conn,user,roomId,date){
 if(!validDate(date))fail(400,'invalid_date');
 const room=await assertRoom(conn,user,roomId,'daily');
 const [items]=await conn.execute(
  `SELECT a.student_id,a.status FROM attendance_daily a
   JOIN student_enrollments h ON h.student_id=a.student_id
   WHERE h.classroom_id=? AND a.school_date=?
     AND h.start_date<=a.school_date
     AND (h.end_date IS NULL OR h.end_date>a.school_date)`,
  [room.id,date]);
 // Missing rows stay missing. Frontend distinguishes not yet recorded.
 return {items};
}
async function periodAttendance(conn,user,roomId,date,timetableId){
 if(!validDate(date))fail(400,'invalid_date');
 // Reading period attendance does not grant access to another teacher's
 // lesson just because the actor advises the same classroom.
 const room=await assertRoom(conn,user,roomId,'view');
 const id=asId(timetableId);
 if(!id)fail(400,'invalid_timetable');
 const [slots]=await conn.execute(
  'SELECT id,classroom_id,teacher_user_id,day_of_week FROM timetable WHERE id=? AND active=1 LIMIT 1',[id]);
 const slot=slots[0];
 const weekday=((new Date(date+'T00:00:00Z').getUTCDay()+6)%7)+1;
 if(!slot||Number(slot.classroom_id)!==Number(room.id)||
  Number(slot.day_of_week)!==weekday)fail(400,'invalid_timetable');
 if(user.role!=='admin'&&Number(slot.teacher_user_id)!==Number(user.id))
  fail(403,'forbidden');
 const [items]=await conn.execute(
  `SELECT p.student_id,
    CASE WHEN tr.student_id IS NOT NULL AND p.status='absent'
       THEN 'truancy' ELSE p.status END AS status
   FROM attendance_period p
   LEFT JOIN period_truancy tr ON tr.student_id=p.student_id
     AND tr.timetable_id=p.timetable_id AND tr.school_date=p.school_date
   JOIN student_enrollments h ON h.student_id=p.student_id
   WHERE p.timetable_id=? AND p.school_date=? AND h.classroom_id=?
     AND h.start_date<=p.school_date
     AND (h.end_date IS NULL OR h.end_date>p.school_date)`,
  [id,date,room.id]);
 const [daily]=await conn.execute(
  `SELECT d.student_id,d.status FROM attendance_daily d
   JOIN student_enrollments h ON h.student_id=d.student_id
   WHERE h.classroom_id=? AND d.school_date=? AND h.start_date<=d.school_date
     AND (h.end_date IS NULL OR h.end_date>d.school_date)`,
  [room.id,date]);
 const [notes]=await conn.execute(
  'SELECT note,updated_at FROM period_teaching_logs WHERE timetable_id=? AND school_date=? LIMIT 1',
  [id,date]);
 return {items,daily_items:daily,daily_date:date,daily_read_only:true,
  teaching_note:notes[0]?.note||'',
  teaching_note_updated_at:notes[0]?.updated_at||null};
}
async function teacherTimetable(conn,user){
 if(user.kind!=='staff')fail(403,'forbidden');
 // staff in student affairs is also a teacher when assigned subject slots;
 // no school-wide mutation privileges follow from read rights.
 const [rows]=await conn.execute(
  `SELECT t.id,t.classroom_id,t.day_of_week,t.period,
    COALESCE(t.end_period,t.period) AS end_period,t.subject_code,
    t.subject,t.active,t.approval_status,c.label AS classroom_label
   FROM timetable t JOIN classrooms c ON c.id=t.classroom_id
   WHERE t.teacher_user_id=? AND t.approval_status<>'archived'
   ORDER BY t.day_of_week,t.period,c.grade,c.room`,[user.id]);
 return {items:rows};
}
async function portalStudentId(conn,user,studentId){
 if(user.kind!=='portal')fail(403,'forbidden');
 const id=asId(studentId);if(!id)fail(400,'invalid_student');
 let ok=false;
 if(user.role==='student'){
  const [accounts]=await conn.execute(
   "SELECT student_id FROM portal_accounts WHERE id=? AND role='student' AND active=1",
   [user.id]);
  ok=accounts.length===1&&Number(accounts[0].student_id)===id;
 }else{
  const [links]=await conn.execute(
   "SELECT 1 AS allowed FROM guardian_student_links g JOIN portal_accounts a ON a.id=g.guardian_account_id AND a.role='guardian' AND a.active=1 WHERE g.guardian_account_id=? AND g.student_id=? LIMIT 1",
   [user.id,id]);
  ok=links.length===1;
 }
 if(!ok)fail(403,'forbidden');
 const [exists]=await conn.execute('SELECT id FROM students WHERE id=? AND active=1',[id]);
 if(!exists.length)fail(404,'not_found');
 return id;
}
async function portalChildren(conn,user){
 if(user.kind!=='portal')fail(403,'forbidden');
 if(user.role==='student'){
  const [items]=await conn.execute(
   `SELECT s.id,s.student_no,s.full_name,c.label AS classroom_label
    FROM portal_accounts a JOIN students s ON s.id=a.student_id AND s.active=1
    JOIN classrooms c ON c.id=s.classroom_id WHERE a.id=? AND a.role='student' AND a.active=1`,
   [user.id]);
  return {items};
 }
 const [items]=await conn.execute(
  `SELECT s.id,s.student_no,s.full_name,c.label AS classroom_label
   FROM guardian_student_links l JOIN portal_accounts a ON a.id=l.guardian_account_id
   JOIN students s ON s.id=l.student_id AND s.active=1
   JOIN classrooms c ON c.id=s.classroom_id
   WHERE a.id=? AND a.role='guardian' AND a.active=1
   ORDER BY s.full_name LIMIT 20`,[user.id]);
 return {items};
}
async function portalAttendance(conn,user,studentId,from,to){
 const id=await portalStudentId(conn,user,studentId);
 dateRange(from,to);
 const [daily]=await conn.execute(
  'SELECT school_date,status FROM attendance_daily WHERE student_id=? AND school_date BETWEEN ? AND ? ORDER BY school_date DESC LIMIT 90',
  [id,from,to]);
 const [period]=await conn.execute(
  `SELECT p.school_date,
     CASE WHEN tr.student_id IS NOT NULL AND p.status='absent'
       THEN 'truancy' ELSE p.status END AS status,
      t.period,t.end_period,t.subject
   FROM attendance_period p JOIN timetable t ON t.id=p.timetable_id
   LEFT JOIN period_truancy tr ON tr.student_id=p.student_id
     AND tr.timetable_id=p.timetable_id AND tr.school_date=p.school_date
   WHERE p.student_id=? AND p.school_date BETWEEN ? AND ?
   ORDER BY p.school_date DESC,t.period LIMIT 1500`,[id,from,to]);
 const [late]=await conn.execute(
  'SELECT school_date,arrived_at,state FROM late_records WHERE student_id=? AND school_date BETWEEN ? AND ? ORDER BY school_date DESC LIMIT 90',
  [id,from,to]);
 return {student_id:id,daily,period,late};
}
async function portalBehavior(conn,user,studentId,from,to){
 const id=await portalStudentId(conn,user,studentId);
 dateRange(from,to);
 // Return raw un-offset behavior and goodness entries: the original UI
 // applies separate ledgers; this query must not combine them as a net score.
 const [entries]=await conn.execute(
  `SELECT id,points,reason,affairs_category,created_at
   FROM behavior_records WHERE student_id=?
    AND deleted_at IS NULL AND created_at>=? AND created_at<?
   ORDER BY created_at DESC,id DESC LIMIT 1000`,
  [id,from+' 00:00:00',new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)+' 00:00:00']);
 return {student_id:id,items:entries};
}
// Stage 13 — exact Worker /api/portal/records response contract, private only.
// Keep attendance/late/conduct/merit independent. All data reads require a
// VERIFIED student login or guardian link and an at-most-90-day range.
// Mirror worker/src/portal.js records(), worker/src/score-ledger.js,
// without exposing this route through Passenger.
function portalScoreSummary(value){
 const good_total=Math.max(0,Number(value?.good_total)||0);
 const behavior_deducted=Math.max(0,Number(value?.behavior_deducted)||0);
 const behavior_adjusted=Math.max(0,Number(value?.behavior_adjusted)||0);
 return {good_total,behavior_deducted,behavior_adjusted,
  behavior_remaining:Math.max(0,behavior_deducted-behavior_adjusted)};
}
async function portalRecords(conn,user,studentId,from,to){
 const id=asId(studentId);
 if(!id)fail(400,'invalid_student');
 dateRange(from,to);
 await portalStudentId(conn,user,id);
 const [students]=await conn.execute(
  `SELECT s.id,s.full_name,s.student_no,c.label AS classroom_label
   FROM students s JOIN classrooms c ON c.id=s.classroom_id
   WHERE s.id=? AND s.active=1 LIMIT 1`,[id]);
 const student=students[0];
 if(!student)fail(404,'not_found');
 const [daily]=await conn.execute(
  'SELECT school_date,status FROM attendance_daily WHERE student_id=? AND school_date BETWEEN ? AND ? ORDER BY school_date DESC LIMIT 90',
  [id,from,to]);
 const [period]=await conn.execute(
  `SELECT p.school_date,
   CASE WHEN tr.student_id IS NOT NULL AND p.status='absent'
        THEN 'truancy' ELSE p.status END AS status,
   t.period,t.subject
   FROM attendance_period p
   JOIN timetable t ON t.id=p.timetable_id
   LEFT JOIN period_truancy tr ON tr.student_id=p.student_id
    AND tr.timetable_id=p.timetable_id AND tr.school_date=p.school_date
   WHERE p.student_id=? AND p.school_date BETWEEN ? AND ?
   ORDER BY p.school_date DESC,t.period LIMIT 1500`,[id,from,to]);
 const [late]=await conn.execute(
  `SELECT school_date,arrived_at,state FROM late_records
   WHERE student_id=? AND school_date BETWEEN ? AND ?
   ORDER BY school_date DESC LIMIT 90`,[id,from,to]);
 const [rows]=await conn.execute(
  `SELECT record_date,points,reason,affairs_category,score_type,warning_no FROM (
     SELECT SUBSTR(b.created_at,1,10) AS record_date,
       b.points,b.reason,b.affairs_category,
       CASE
        WHEN b.deleted_at IS NULL AND b.points>0 AND
         (b.affairs_category IS NULL OR b.affairs_category='good')
        THEN 'good'
        WHEN b.deleted_at IS NULL AND b.points>0 AND
         b.affairs_category='adjustment'
        THEN 'adjustment'
        ELSE 'behavior'
       END AS score_type,
       0 AS warning_no,b.id AS entry_id
     FROM behavior_records b
     WHERE b.student_id=? AND b.deleted_at IS NULL
      AND SUBSTR(b.created_at,1,10) BETWEEN ? AND ?
     UNION ALL
     SELECT SUBSTR(i.created_at,1,10) AS record_date,
      0 AS points,i.reason,i.affairs_category,'behavior' AS score_type,
      i.warning_no,i.id AS entry_id
     FROM behavior_incidents i
     WHERE i.student_id=? AND i.deleted_at IS NULL
      AND i.points_applied=0 AND i.warning_no>0
      AND SUBSTR(i.created_at,1,10) BETWEEN ? AND ?
    ) AS dated_entries
    ORDER BY record_date DESC,entry_id DESC LIMIT 100`,
  [id,from,to,id,from,to]);
 const [totals]=await conn.execute(
  `SELECT
   COALESCE(SUM(CASE WHEN b.deleted_at IS NULL AND b.points>0
      AND (b.affairs_category IS NULL OR b.affairs_category='good')
      THEN b.points ELSE 0 END),0) AS good_total,
   COALESCE(SUM(CASE WHEN b.deleted_at IS NULL AND b.points<0
      THEN -b.points ELSE 0 END),0) AS behavior_deducted,
   COALESCE(SUM(CASE WHEN b.deleted_at IS NULL AND b.points>0
      AND b.affairs_category='adjustment'
      THEN b.points ELSE 0 END),0) AS behavior_adjusted
   FROM behavior_records b
   WHERE b.student_id=? AND SUBSTR(b.created_at,1,10) BETWEEN ? AND ?`,
  [id,from,to]);
 const scores=portalScoreSummary(totals[0]);
 return {student,from,to,daily,period,late,
  truancy:period.filter(row=>row.status==='truancy'),
  behavior:rows.filter(row=>row.score_type!=='good'),
  good:rows.filter(row=>row.score_type==='good'),
  behavior_total:-scores.behavior_remaining,...scores,
  note:'คะแนนความดีแยกจากคะแนนพฤติกรรม • ลดคะแนนพฤติกรรมได้เฉพาะเกณฑ์ปรับพฤติกรรม'};
}
module.exports={asId,validDate,dateRange,trustedSession,assertRoom,listRooms,roster,
 dailyAttendance,savedDailyAttendance,periodAttendance,teacherTimetable,portalStudentId,portalChildren,portalAttendance,portalBehavior,portalScoreSummary,portalRecords};
