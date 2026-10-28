
import {validateStudentInput} from './admin-validation.js';
import {bangkokToday} from './core.js';

// Administrative, resumable file import; staging contains only roster fields.
const reply=(v,code=200)=>Response.json(v,{status:code,headers:{'cache-control':'no-store'}});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const sql=(...parts)=>parts.join(' ');
const safe=v=>typeof v==='string'?v.trim().slice(0,160):'';
const uuid=/^[0-9a-f-]{36}$/i;

async function jobById(env,id,actor){
 const result=await env.DB.prepare('SELECT * FROM student_file_import_jobs WHERE id=? AND actor_id=?').bind(id,actor).first();
 if(!result)fail(404,'ไม่พบงานนำเข้าของผู้ดูแลระบบ');
 return result;
}
function summary(j){return {job_id:j.id,status:j.status,total:j.total,uploaded:j.uploaded,
 processed:j.processed,added:j.added,updated:j.updated,skipped:j.skipped}}
async function countRow(env,j,r,state,message=''){
 await env.DB.batch([
  env.DB.prepare("UPDATE student_file_import_rows SET state=?,message=? WHERE job_id=? AND source_row=? AND state='pending'")
   .bind(state,message,j.id,r.source_row),
  env.DB.prepare("UPDATE student_file_import_jobs SET processed=processed+1,added=added+?,updated=updated+?,skipped=skipped+?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(state==='added'?1:0,state==='updated'?1:0,state==='skipped'?1:0,j.id)
 ]);
}
function validation(r){
 if(!r.student_no||r.student_no.length>40||/[\u0000-\u001f\u007f]/.test(r.student_no))return 'รหัสนักเรียนไม่ถูกต้อง';
 if(!r.full_name||r.full_name.length>120||/[\u0000-\u001f\u007f]/.test(r.full_name))return 'ชื่อ–สกุลไม่ถูกต้อง';
 if(!r.classroom||r.classroom.length>40)return 'ห้องเรียนไม่ถูกต้อง';
 if(!Number.isInteger(r.roll_no)||r.roll_no<1||r.roll_no>100)return 'เลขที่ไม่ถูกต้อง (1–100)';
 return '';
}
async function oneRow(env,j,r){
 let reason=validation(r);
 if(reason){await countRow(env,j,r,'skipped',reason);return}
 const previous=await env.DB.prepare("SELECT 1 FROM student_file_import_rows WHERE job_id=? AND lower(student_no)=lower(?) AND source_row<? LIMIT 1")
  .bind(j.id,r.student_no,r.source_row).first();
 if(previous){await countRow(env,j,r,'skipped','รหัสนักเรียนซ้ำภายในไฟล์');return}
 const room=await env.DB.prepare('SELECT id FROM classrooms WHERE label=?').bind(r.classroom).first();
 if(!room){await countRow(env,j,r,'skipped','ไม่พบห้องเรียนในระบบ');return}
 let student;
 try{student=validateStudentInput({...r,classroom_id:room.id,active:1})}
 catch(e){await countRow(env,j,r,'skipped',e.message);return}
 const current=await env.DB.prepare('SELECT id,classroom_id,roll_no,active,deleted_at FROM students WHERE lower(student_no)=lower(?)')
  .bind(student.student_no).first();
 const occupant=await env.DB.prepare('SELECT id FROM students WHERE classroom_id=? AND roll_no=?')
  .bind(room.id,student.roll_no).first();
 const occupied=await env.DB.prepare("SELECT student_id FROM student_enrollments WHERE classroom_id=? AND roll_no=? AND end_date IS NULL")
  .bind(room.id,student.roll_no).first();
 if(current&&(current.deleted_at||current.active!==1))reason='นักเรียนถูกเก็บเป็นประวัติหรือไม่ได้ใช้งาน';
 else if(current&&Number(current.classroom_id)!==Number(room.id))reason='นักเรียนอยู่คนละห้อง ต้องใช้เมนูย้ายห้อง';
 else if(occupant&&Number(occupant.id)!==Number(current?.id))reason='เลขที่มีนักเรียนอื่นใช้อยู่แล้ว';
 else if(occupied&&Number(occupied.student_id)!==Number(current?.id))reason='เลขที่มีผู้ครอบครองในทะเบียนปัจจุบัน';
 const enrollment=current?await env.DB.prepare("SELECT classroom_id,roll_no FROM student_enrollments WHERE student_id=? AND end_date IS NULL")
  .bind(current.id).first():null;
 if(current&&(!enrollment||Number(enrollment.classroom_id)!==Number(room.id)||
  Number(enrollment.roll_no)!==Number(current.roll_no)))
  reason ||= 'ข้อมูลการสังกัดห้องเดิมไม่ตรงกัน';
 if(reason){await countRow(env,j,r,'skipped',reason);return}
 const kind=current?'updated':'added';
 const actions=[];
 if(current){
  actions.push(env.DB.prepare('UPDATE students SET full_name=?,roll_no=? WHERE id=? AND classroom_id=? AND active=1 AND deleted_at IS NULL')
   .bind(student.full_name,student.roll_no,current.id,room.id));
  actions.push(env.DB.prepare("UPDATE student_enrollments SET roll_no=? WHERE student_id=? AND classroom_id=? AND end_date IS NULL")
   .bind(student.roll_no,current.id,room.id));
 }else{
  actions.push(env.DB.prepare('INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,1)')
   .bind(student.student_no,room.id,student.roll_no,student.full_name));
  actions.push(env.DB.prepare(sql(
   'INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)',
   'SELECT id,?,?,?,? FROM students WHERE lower(student_no)=lower(?)'))
   .bind(room.id,student.roll_no,bangkokToday(),j.actor_id,student.student_no));
 }
 actions.push(env.DB.prepare("UPDATE student_file_import_rows SET state=?,message='' WHERE job_id=? AND source_row=? AND state='pending'")
  .bind(kind,j.id,r.source_row));
 actions.push(env.DB.prepare('UPDATE student_file_import_jobs SET processed=processed+1,added=added+?,updated=updated+?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
  .bind(kind==='added'?1:0,kind==='updated'?1:0,j.id));
 try{await env.DB.batch(actions)}
 catch(e){
  if(/UNIQUE|constraint|FOREIGN KEY/i.test(String(e?.message||'')))
   await countRow(env,j,r,'skipped','ข้อมูลซ้ำหรือเลขที่ชนกัน กรุณาตรวจสอบ');
  else throw e;
 }
}

export async function processStudentFileJob(env,j){
 const lock=await env.DB.prepare(sql(
  "UPDATE student_file_import_jobs SET lock_until=datetime('now','+90 seconds'),status='running'",
  "WHERE id=? AND status IN ('ready','running')",
  'AND (lock_until IS NULL OR lock_until<CURRENT_TIMESTAMP)')).bind(j.id).run();
 if(!lock.meta?.changes)return summary(await jobById(env,j.id,j.actor_id));
 try{
  const work=(await env.DB.prepare(sql(
   'SELECT source_row,student_no,classroom,roll_no,full_name FROM student_file_import_rows',
   "WHERE job_id=? AND state='pending' ORDER BY source_row LIMIT 6")).bind(j.id).all()).results;
  for(const r of work)await oneRow(env,j,r);
  await env.DB.prepare(sql(
   'UPDATE student_file_import_jobs SET lock_until=NULL,',
   "status=CASE WHEN NOT EXISTS (SELECT 1 FROM student_file_import_rows WHERE job_id=? AND state='pending')",
   "THEN 'completed' ELSE 'running' END,updated_at=CURRENT_TIMESTAMP WHERE id=?"))
   .bind(j.id,j.id).run();
 }catch(e){
  await env.DB.prepare('UPDATE student_file_import_jobs SET lock_until=NULL WHERE id=?')
   .bind(j.id).run().catch(()=>{});
  throw e;
 }
 return summary(await jobById(env,j.id,j.actor_id));
}
export async function studentFileJobRoutes(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบ');
 const prefix='/api/admin/student-file-jobs',rest=path.slice(prefix.length);
 if(rest===''&&req.method==='GET'){
  const jobs=(await env.DB.prepare('SELECT * FROM student_file_import_jobs WHERE actor_id=? ORDER BY created_at DESC LIMIT 8')
   .bind(user.id).all()).results;
  return reply({items:jobs.map(summary)});
 }
 if(rest===''&&req.method==='POST'){
  const body=await req.json().catch(()=>null);
  if(!Number.isSafeInteger(body?.total)||body.total<1||body.total>10000)fail(400,'ไฟล์ต้องมี 1–10,000 แถว');
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO student_file_import_jobs(id,actor_id,total) VALUES(?,?,?)')
   .bind(id,user.id,body.total).run();
  return reply({job_id:id,status:'uploading',total:body.total},201);
 }
 const matched=/^\/([0-9a-f-]{36})(?:\/(chunk|finish|run))?$/i.exec(rest);
 if(!matched||!uuid.test(matched[1]))fail(404,'ไม่พบงานนำเข้า');
 const [,id,action]=matched,j=await jobById(env,id,user.id);
 if(!action&&req.method==='GET'){
  const issues=(await env.DB.prepare("SELECT source_row,message FROM student_file_import_rows WHERE job_id=? AND state='skipped' ORDER BY source_row LIMIT 100")
   .bind(id).all()).results;
  return reply({...summary(j),issues});
 }
 if(action==='chunk'&&req.method==='POST'){
  if(j.status!=='uploading')fail(409,'งานนี้ปิดการรับข้อมูลแล้ว');
  const body=await req.json().catch(()=>null),rows=body?.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>20)fail(400,'อัปโหลดไม่เกิน 20 แถวต่อชุด');
  const seen=new Set(),statements=[];
  for(const r of rows){
   const line=Number(r?.source_row);
   if(!Number.isSafeInteger(line)||line<2||line>10001||seen.has(line))fail(400,'หมายเลขแถวผิดหรือซ้ำ');
   seen.add(line);
   // Drop all supplied usernames/passwords before staging.
   statements.push(env.DB.prepare(sql(
    'INSERT OR IGNORE INTO student_file_import_rows',
    '(job_id,source_row,student_no,classroom,roll_no,full_name) VALUES(?,?,?,?,?,?)'))
    .bind(id,line,safe(r.student_no),safe(r.classroom),
     Number.isInteger(Number(r.roll_no))?Number(r.roll_no):null,safe(r.full_name)));
  }
  statements.push(env.DB.prepare(sql(
   'UPDATE student_file_import_jobs SET uploaded=',
   '(SELECT COUNT(*) FROM student_file_import_rows WHERE job_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=?'))
   .bind(id,id));
  await env.DB.batch(statements);
  const updated=await jobById(env,id,user.id);
  return reply({job_id:id,uploaded:updated.uploaded,total:updated.total});
 }
 if(action==='finish'&&req.method==='POST'){
  await env.DB.prepare(sql(
   "UPDATE student_file_import_jobs SET status='ready'",
   "WHERE id=? AND actor_id=? AND status='uploading' AND uploaded=total"))
   .bind(id,user.id).run();
  const updated=await jobById(env,id,user.id);
  if(updated.status==='uploading')fail(409,'อัปโหลดไฟล์ยังไม่ครบ');
  return reply(summary(updated));
 }
 if(action==='run'&&req.method==='POST'){
  if(j.status==='uploading')fail(409,'อัปโหลดไฟล์ยังไม่ครบ');
  return reply(await processStudentFileJob(env,j));
 }
 fail(405,'Method not allowed');
}
