// Data validation shared between API and regression tests.
export function validateLateSelfReport(body) {
 const student_no=typeof body?.student_no==='string'?body.student_no.trim():'';
 const code=typeof body?.code==='string'?body.code.trim().toLowerCase():'';
 const reason=typeof body?.reason==='string'?body.reason.trim():'';
 if(!student_no||student_no.length>40||/[\u0000-\u001f\u007f]/.test(student_no))
  throw Error('รหัสนักเรียนไม่ถูกต้อง');
 if(!/^[a-f0-9]{24}$/.test(code))throw Error('รหัสยืนยันไม่ถูกต้องหรือหมดอายุ');
 if(reason.length>300||/[\u0000-\u001f\u007f]/.test(reason))
  throw Error('เหตุผลต้องไม่เกิน 300 ตัวอักษร');
 return {student_no,code,reason};
}
export function validateLateReviewState(value) {
 if(value!=='verified'&&value!=='rejected')throw Error('สถานะตรวจสอบไม่ถูกต้อง');
 return value;
}
export function bangkokArrivalTime(now=new Date()){
 return new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).format(now);
}
