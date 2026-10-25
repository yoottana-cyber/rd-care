// Preview roster account issuance in the browser; authoritative validation
// and uniqueness checks remain on the Worker.
export function planStudentAccounts(students,accounts,limit=10){
 const issued=new Set(accounts.filter(a=>a.role==='student').map(a=>Number(a.student_id)));
 const used=new Set(accounts.map(a=>String(a.username).toLowerCase()));
 const items=students.filter(s=>s.active).map(s=>{
  const username=String(s.student_no??'').trim().toLowerCase();
  const valid=/^[a-z0-9._-]{3,40}$/i.test(username);
  const reason=!valid?'รหัสนักเรียนไม่รองรับเป็น Username':
   issued.has(Number(s.id))?'มีบัญชีแล้ว':used.has(username)?'Username ถูกใช้แล้ว':'';
  return {student_id:s.id,student_no:s.student_no,full_name:s.full_name,username,
   status:reason?'skip':'ready',reason};
 });
 return {items,ready:items.filter(x=>x.status==='ready').slice(0,limit),
  skipped:items.filter(x=>x.status==='skip')};
}
