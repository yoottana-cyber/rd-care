// Admin-only recovery for anonymized student rows that reserve classroom roll numbers.
// Refuse to remove any archived identity referenced by school records or other tables.
const bad=(code,message)=>{throw Object.assign(new Error(message),{code})};
const isSafeName=x=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(x);
export async function releaseUnusedArchivedStudent(req,env,actor,id){
 if(actor?.role!=='admin')bad(403,'เฉพาะผู้ดูแลระบบ');
 if(req.method!=='POST')bad(405,'Method not allowed');
 if(!Number.isSafeInteger(Number(id))||Number(id)<1)bad(400,'รหัสรายการไม่ถูกต้อง');
 const number=Number(id),identifier='archived-student-'+number;
 const input=await req.json().catch(()=>null);
 if(!input||input.confirm!==identifier)bad(400,'กรุณาพิมพ์ '+identifier+' เพื่อยืนยัน');
 const old=await env.DB.prepare(
  'SELECT id,student_no,full_name,active,deleted_at,classroom_id,roll_no FROM students WHERE id=?'
 ).bind(number).first();
 if(!old||!old.deleted_at||Number(old.active)!==0||old.student_no!==identifier)
  bad(409,'รายการนี้ไม่ใช่ข้อมูลนักเรียนที่ถอนออกแล้ว จึงไม่สามารถปลดเลขที่');
 // Discover ALL current student_id references from the live schema. Future tables
 // automatically participate in the safety check; no field names or PII are logged.
 const schema=(await env.DB.prepare(
  "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
 ).all()).results||[];
 const candidates=[];
 for(const entry of schema){
  if(!isSafeName(entry.name))bad(503,'ไม่สามารถยืนยันความปลอดภัยของโครงสร้างฐานข้อมูล');
  if(entry.name==='students'||entry.name==='student_enrollments')continue;
  const definition=String(entry.sql||'');
  if(/\bREFERENCES\s+[\x22\x60]?students\b/i.test(definition)&&!/\bstudent_id\b/i.test(definition))
   bad(503,'มีตารางอ้างอิงนักเรียนที่ยังไม่รองรับการตรวจสอบ');
  if(/\bstudent_id\b/i.test(definition))candidates.push(entry.name);
 }
 if(candidates.length>40)bad(503,'จำนวนตารางอ้างอิงเกินขีดจำกัดการตรวจสอบ');
 const enrollment=await env.DB.prepare(
  'SELECT id,start_date,end_date FROM student_enrollments WHERE student_id=? LIMIT 2'
 ).bind(number).all();
 if((enrollment.results||[]).length>1||(enrollment.results||[]).some(x=>x.end_date!==null))
  bad(409,'รายการนี้มีประวัติการสังกัดห้อง จึงไม่อนุญาตให้ลบอัตลักษณ์นักเรียน');
 // D1.batch uses one database transaction for the deletes below. If any
 // references were added concurrently, FK protection rejects the entire batch.
 if(candidates.length){
  const reads=await env.DB.batch(candidates.map(name=>
   env.DB.prepare('SELECT 1 AS linked FROM "'+name+'" WHERE student_id=? LIMIT 1').bind(number)
  ));
  const linked=candidates.filter((_,i)=>(reads[i]?.results||[]).length>0);
  if(linked.length)bad(409,'รายการนี้มีข้อมูลประวัติหรือความสัมพันธ์ที่ต้องเก็บรักษา ('+
   linked.slice(0,3).join(', ')+') จึงไม่ปลดเลขที่');
 }
 try{
  await env.DB.batch([
   env.DB.prepare('DELETE FROM student_enrollments WHERE student_id=?').bind(number),
   env.DB.prepare('DELETE FROM students WHERE id=? AND active=0 AND deleted_at IS NOT NULL AND student_no=?')
    .bind(number,identifier),
   env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .bind(actor.id,'unused_archived_student_released','students',String(number))
  ]);
 }catch(e){
  // Never surface SQL values, internal error objects, or student data.
  bad(409,'ไม่สามารถปลดเลขที่ได้ เนื่องจากข้อมูลยังมีความสัมพันธ์หรือมีการเปลี่ยนแปลง กรุณาตรวจสอบประวัติ');
 }
 return Response.json({ok:true,message:'ปลดเลขที่จากรายการที่ถอนออกและไม่มีประวัติสำเร็จ',
  classroom_id:Number(old.classroom_id),roll_no:Number(old.roll_no)},{
   headers:{'cache-control':'no-store'}
  });
}
