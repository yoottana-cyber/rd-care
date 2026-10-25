import {validUsername} from './core.js';

// The school student number is a stable login identifier, not a secret.
// Preserve leading zeros by handling it as a string from import to login.
export function studentUsername(student){
 const value=typeof student?.student_no==='string'?student.student_no.trim().toLowerCase():'';
 if(!validUsername(value))throw Object.assign(
  new Error('รหัสนักเรียนต้องเป็นตัวอักษรอังกฤษ/ตัวเลข/จุด/ขีด 3–40 ตัว และห้ามมีช่องว่าง'),{code:400});
 return value;
}
export function planStudentPortalAccounts(students,accounts,limit=10){
 if(!Array.isArray(students)||!Array.isArray(accounts))throw Error('ข้อมูลไม่ถูกต้อง');
 const byStudent=new Set(accounts.filter(a=>a.role==='student').map(a=>a.student_id));
 const byUsername=new Set(accounts.map(a=>String(a.username).toLowerCase()));
 const items=students.filter(s=>!!s.active).map(student=>{
  let username='',reason='';
  try{username=studentUsername(student)}catch(e){reason=e.message}
  if(!reason&&byStudent.has(student.id))reason='มีบัญชีอยู่แล้ว';
  else if(!reason&&byUsername.has(username))reason='Username ซ้ำกับบัญชีที่มีอยู่';
  return {student_id:student.id,student_no:student.student_no,full_name:student.full_name,
   username,status:reason?'skip':'ready',reason};
 });
 return {items,ready:items.filter(x=>x.status==='ready').slice(0,limit),skipped:items.filter(x=>x.status==='skip')};
}
