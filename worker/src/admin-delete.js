// Deleting school identities must not cascade away attendance or discipline records.
// Staff/student deletion is an anonymized archive; guardian portal-only identities
// can be physically deleted after removing their verified links and sessions.
// Admin-only entrypoint; require an exact typed identifier on every action.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const positiveId=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};
const reply=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const bind=(db,sql,...args)=>db.prepare(sql).bind(...args);
async function parse(req){
 let b;try{b=await req.json()}catch{fail(400,'กรุณายืนยันข้อมูลก่อนลบ')}
 if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.confirm!=='string')
  fail(400,'กรุณาระบุ Username หรือเลขประจำตัวนักเรียนเพื่อยืนยัน');
 return b;
}
const audit=(db,actor,action,entity,id)=>bind(db,
 'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)',
 actor,action,entity,String(id));
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function adminDeleteIdentity(req,env,actor,path){
 if(actor?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบ');
 if(req.method!=='POST')fail(405,'ใช้ POST เพื่อยืนยันการลบเท่านั้น');
 const id=positiveId(/^\/api\/admin\/users\/(\d+)\/delete$/.exec(path)?.[1]||
  /^\/api\/admin\/students\/(\d+)\/delete$/.exec(path)?.[1]||
  /^\/api\/admin\/portal\/accounts\/(\d+)\/delete$/.exec(path)?.[1]);
 if(!id)fail(404,'ไม่พบข้อมูลที่ต้องการลบ');
 const b=await parse(req);
 if(path.startsWith('/api/admin/users/')){
  const old=await bind(env.DB,'SELECT id,username,display_name,role,deleted_at FROM users WHERE id=?',id).first();
  if(!old||old.deleted_at)fail(404,'ไม่พบบัญชีครู');
  if(old.role==='admin'||old.id===actor.id)fail(403,'ไม่อนุญาตให้ลบบัญชี Admin หรือบัญชีของตนเอง');
  if(b.confirm!==old.username)fail(400,'กรุณาพิมพ์ Username ของครูให้ตรงกัน');
  const dummy=random();
  await env.DB.batch([
   bind(env.DB,`UPDATE users SET active=0,deleted_at=CURRENT_TIMESTAMP,
     username=?,display_name=?,password_salt=?,password_hash=?
     WHERE id=? AND deleted_at IS NULL`,
     'archived-staff-'+id,'บุคลากรที่ออกจากระบบ #'+id,dummy,dummy,id),
   bind(env.DB,'DELETE FROM sessions WHERE user_id=?',id),
   bind(env.DB,'DELETE FROM staff_push_subscriptions WHERE user_id=?',id),
   bind(env.DB,'DELETE FROM student_affairs_assignments WHERE user_id=?',id),
   bind(env.DB,'DELETE FROM affairs_grade_heads WHERE teacher_user_id=?',id),
   bind(env.DB,'UPDATE classrooms SET advisor_user_id=NULL WHERE advisor_user_id=?',id),
   bind(env.DB,'UPDATE timetable SET active=0 WHERE teacher_user_id=?',id),
   audit(env.DB,actor.id,'personnel_archived','users',id)
  ]);
  return reply({ok:true,kind:'archived',message:'ลบบัญชีครูออกจากรายการใช้งานแล้ว โดยเก็บประวัติการสอนและเช็กชื่อไว้'});
 }
 if(path.startsWith('/api/admin/students/')){
  const old=await bind(env.DB,'SELECT id,student_no,full_name,deleted_at FROM students WHERE id=?',id).first();
  if(!old||old.deleted_at)fail(404,'ไม่พบนักเรียน');
  if(b.confirm!==old.student_no)fail(400,'กรุณาพิมพ์เลขประจำตัวนักเรียนให้ตรงกัน');
  const stmts=[
   bind(env.DB,'DELETE FROM guardian_student_links WHERE student_id=?',id),
   bind(env.DB,"DELETE FROM portal_accounts WHERE student_id=? AND role='student'",id),
   bind(env.DB,`UPDATE students SET active=0,deleted_at=CURRENT_TIMESTAMP,
      student_no=?,full_name=? WHERE id=? AND deleted_at IS NULL`,
      'archived-student-'+id,'ข้อมูลนักเรียนที่ถอนออก #'+id,id),
   audit(env.DB,actor.id,'student_archived','students',id)
  ];
  await env.DB.batch(stmts);
  return reply({ok:true,kind:'archived',message:
   'ถอนข้อมูลนักเรียนออกจากหน้าทำงานและเพิกถอนบัญชี/สิทธิ์ผู้ปกครองแล้ว เก็บประวัติเช็กชื่อและคะแนนย้อนหลังตามความจำเป็น'});
 }
 const old=await bind(env.DB,'SELECT id,username,role FROM portal_accounts WHERE id=?',id).first();
 if(!old)fail(404,'ไม่พบบัญชี');
 if(old.role!=='guardian'&&old.role!=='student')fail(403,'ประเภทบัญชีไม่ถูกต้อง');
 if(b.confirm!==old.username)fail(400,'กรุณาพิมพ์ Username เพื่อยืนยันการลบ');
 await env.DB.batch([
  bind(env.DB,'DELETE FROM portal_sessions WHERE account_id=?',id),
  bind(env.DB,'DELETE FROM guardian_student_links WHERE guardian_account_id=?',id),
  bind(env.DB,'DELETE FROM guardian_push_subscriptions WHERE guardian_account_id=?',id),
  bind(env.DB,'DELETE FROM portal_accounts WHERE id=?',id),
  audit(env.DB,actor.id,'portal_account_deleted','portal_accounts',id)
 ]);
 return reply({ok:true,kind:'deleted',message:'ลบบัญชีและสิทธิ์ที่เชื่อมโยงเรียบร้อยแล้ว โดยไม่ลบข้อมูลการมาเรียนของนักเรียน'});
}
