import { validateStudentInput } from './admin-validation.js';
import {validUsername} from './core.js';
// Prepare an atomic import plan. Every issue is returned with its source-row
// number, and the whole import is blocked until all rows pass validation.
export function planStudentImport(students,roomId,existing=[],existingAccounts=[]){
 if(!Array.isArray(students)||students.length===0||students.length>60)throw Error('นำเข้าได้ครั้งละ 1–60 คน');
 const ids=new Set(),rolls=new Set(),loginNames=new Set();
 const usedAccountNames=new Set(existingAccounts.map(a=>String(a.username).toLowerCase()));
 let credentials=0;
 const occupiedIds=new Map(existing.map(s=>[String(s.student_no).toLowerCase(),s]));
 const occupiedRolls=new Map(existing.filter(s=>s.classroom_id===roomId).map(s=>[s.roll_no,s]));
 const items=students.map((raw,index)=>{
  const line=Number.isSafeInteger(raw?.source_row)&&raw.source_row>0?raw.source_row:index+1;
  let student=null,message='',status='ready',login_username='',create_account=false;
  try{
   student=validateStudentInput({...raw,classroom_id:roomId,active:1});
   const key=student.student_no.toLowerCase();
   if(ids.has(key))message='รหัสนักเรียนซ้ำภายในไฟล์';
   else if(rolls.has(student.roll_no))message='เลขที่ซ้ำภายในไฟล์';
   else if(occupiedIds.has(key))message='รหัสนักเรียนนี้มีอยู่แล้วในระบบ';
   else if(occupiedRolls.has(student.roll_no))message='เลขที่นี้มีอยู่แล้วในห้องเรียน';
   ids.add(key);rolls.add(student.roll_no);
   const username=String(raw?.username??'').trim().toLowerCase();
   if(username||raw?.password){
    create_account=true;credentials++;
    login_username=username||key;
    if(!validUsername(login_username))message ||= 'Username ใช้ภาษาอังกฤษ ตัวเลข จุด หรือขีด 3–40 ตัว';
    if(typeof raw.password!=='string'||raw.password.length<4||raw.password.length>128)
     message ||= 'Password ต้องมีอย่างน้อย 4 ตัว และไม่เกิน 128 ตัว';
    else if(/^\d{13}$/.test(raw.password))
     message ||= 'ห้ามใช้เลขประจำตัวประชาชน 13 หลักเป็นรหัสผ่าน';
    if(loginNames.has(login_username))message ||= 'Username ซ้ำในไฟล์';
    else if(usedAccountNames.has(login_username))message ||= 'Username มีบัญชีอยู่แล้ว';
    loginNames.add(login_username);
   }
  }catch(error){message=error.message}
  if(message)status='error';
  return {source_row:line,status,message,login_username,create_account,
   student:student||{student_no:String(raw?.student_no??'').slice(0,40),
    full_name:String(raw?.full_name??'').slice(0,120),roll_no:raw?.roll_no}};
 });
 if(credentials>10)throw Error('รายการที่มีบัญชี Login นำเข้าได้ครั้งละไม่เกิน 10 คน');
 return {accounts:credentials,ready:items.every(x=>x.status==='ready'),valid:items.filter(x=>x.status==='ready').length,
  errors:items.filter(x=>x.status==='error').length,items};
}
