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
  let student=null,message='',status='ready';
  try{
   student=validateStudentInput({...raw,classroom_id:roomId,active:1});
   const key=student.student_no.toLowerCase();
   if(ids.has(key))message='รหัสนักเรียนซ้ำภายในไฟล์';
   else if(rolls.has(student.roll_no))message='เลขที่ซ้ำภายในไฟล์';
   else if(occupiedIds.has(key))message='รหัสนักเรียนนี้มีอยู่แล้วในระบบ';
   else if(occupiedRolls.has(student.roll_no))message='เลขที่นี้มีอยู่แล้วในห้องเรียน';
   ids.add(key);rolls.add(student.roll_no);
  }catch(error){message=error.message}
  if(message)status='error';
  return {source_row:line,status,message,
   student:student||{student_no:String(raw?.student_no??'').slice(0,40),
    full_name:String(raw?.full_name??'').slice(0,120),roll_no:raw?.roll_no}};
 });
 return {ready:items.every(x=>x.status==='ready'),valid:items.filter(x=>x.status==='ready').length,
  errors:items.filter(x=>x.status==='error').length,items};
}
