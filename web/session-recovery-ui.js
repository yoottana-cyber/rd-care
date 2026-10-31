// Pure, privacy-safe diagnostics for an existing saved staff session.
// Never includes token, username, raw server exception, query or student data.
const pathLabels=Object.freeze({
 '/api/auth/me':'การยืนยันเซสชัน',
 '/api/classrooms':'การโหลดข้อมูลห้องเรียน',
 '/api/dashboard':'การโหลดหน้าหลัก'
});
export function sessionRecoveryDetails(error,{online=true}={}){
 const route=String(error?.apiPath||'').split('?')[0];
 const where=pathLabels[route]||'การเปิดหน้าเว็บ';
 const status=Number(error?.httpStatus);
 const statusText=Number.isInteger(status)&&status>=400&&status<=599?
  'HTTP '+status:'';
 let issue='ไม่สามารถเปิดหน้าระบบได้ในขณะนี้';
 if(!online)issue='อุปกรณ์ไม่มีการเชื่อมต่ออินเทอร์เน็ต';
 else if(error?.reason==='timeout')issue='เซิร์ฟเวอร์ตอบกลับช้ากว่าปกติ';
 else if([502,503,504].includes(status))issue='เซิร์ฟเวอร์กำลังมีปัญหาชั่วคราว';
 else if(status>=500&&status<=599)issue='เซิร์ฟเวอร์ไม่สามารถประมวลผลคำขอได้';
 else if(status===404)issue='ไม่พบ API ที่เว็บกำลังเรียก อาจมีไฟล์หรือเวอร์ชันไม่ตรงกัน';
 else if(status===403)issue='ระบบปฏิเสธการเข้าถึงข้อมูลบางส่วน';
 else if(error?.reason==='invalid_response')issue='เซิร์ฟเวอร์ตอบข้อมูลไม่ครบตามที่หน้าเว็บต้องการ';
 else if(error?.reason==='network')issue='เบราว์เซอร์เชื่อมต่อ API ไม่สำเร็จ';
 const safeCode=String(error?.errorCode||'');
 const code=/^[a-z0-9_\-]{1,64}$/i.test(safeCode)?safeCode:'';
 return {issue,where,statusText,code};
}
