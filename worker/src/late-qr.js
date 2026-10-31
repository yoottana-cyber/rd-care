import {autoApproveLateQr,revokeAutoLateQr} from './late-qr-auto.js';
import {getLateCutoffTime} from './school-settings.js';
// School gate QR check-in. Server time in Bangkok is authoritative.
// Permanent printed QR is a public URL, NOT student authentication. Students must log in.
// School-local Node deployments pass a validated same-origin PWA URL.
// Existing Cloudflare-only deployments keep their historical QR destination.
const homeUrl=env=>{
 const value=env?.RD_SCHOOL_APP_URL;
 return typeof value==='string'&&/^https:\/\/[^\s/?#]+\/[a-z0-9/-]+\/$/.test(value)
  ?value:'https://rd-care.pages.dev/';
};
const textEncoder=new TextEncoder();
const stamp=()=>Math.floor(Date.now()/1000);
export const schoolTime=(value=new Date())=>{
 const x=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
 return x;
};
export const schoolDay=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export const lateGateOpen=(value=new Date(),cutoff='08:00')=>schoolTime(value)>cutoff;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const hashed=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function read(req){
 const raw=await req.text();if(raw.length>2000)fail(413,'ข้อมูลใหญ่เกินไป');
 try{const obj=JSON.parse(raw);if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error();return obj}
 catch{fail(400,'รูปแบบข้อมูลไม่ถูกต้อง')}
}
function secureCode(code){
 if(typeof code!=='string'||!/^[a-f0-9]{40}$/.test(code))fail(400,'QR ไม่ถูกต้อง กรุณาสแกนใหม่');
 return code;
}
function allowedStaff(user){if(!['teacher','staff','admin'].includes(user?.role))fail(403,'เฉพาะครูเวรหรือผู้ดูแลระบบ')}
async function openGate(env){
 const cutoff=await getLateCutoffTime(env);
 if(!lateGateOpen(new Date(),cutoff))fail(403,'เปิดลงชื่อมาสายหลัง '+cutoff+' น. ตามเวลาโรงเรียนเท่านั้น');
}
export async function lateGateStaffRoutes(req,env,user,path){
 allowedStaff(user);
 const day=schoolDay();
 if(path==='/api/late/qr/print'&&req.method==='GET'){
  // Stable printed QR is a public entry point, not a secret or an attendance receipt.
  // A school can print the same code once, and reuse it indefinitely.
  const url=homeUrl(env)+'?late_qr=gate';
  const {default:qrcode}=await import('qrcode-generator');
  const qr=qrcode(0,'M');qr.addData(url);qr.make();
  return reply({url,svg:qr.createSvgTag({cellSize:8,margin:16,scalable:true}),permanent:true,
   cutoff_time:await getLateCutoffTime(env)});
 }
 if(path==='/api/late/qr/rotate'&&req.method==='POST'){
  await openGate(env);
  const token=[...crypto.getRandomValues(new Uint8Array(20))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const until=stamp()+180;
  await env.DB.batch([
   env.DB.prepare('UPDATE late_qr_tokens SET expires_at=? WHERE issued_by=? AND school_date=? AND expires_at>?').bind(stamp()-1,user.id,day,stamp()),
   env.DB.prepare('INSERT INTO late_qr_tokens(issued_by,school_date,token_hash,expires_at) VALUES(?,?,?,?)')
    .bind(user.id,day,await hashed(token),until)
  ]);
  const url=homeUrl(env)+'?late_qr='+token;
  // SVG is generated locally in the Worker. No scanner token is sent to third parties.
  const {default:qrcode}=await import('qrcode-generator');
  const qr=qrcode(0,'M');qr.addData(url);qr.make();
  return reply({url,svg:qr.createSvgTag({cellSize:6,margin:12,scalable:true}),
   expiresAt:until,schoolDate:day,schoolTime:schoolTime(),validSeconds:180});
 }
 if(path==='/api/late/qr/stop'&&req.method==='POST'){
  const result=await env.DB.prepare(`UPDATE late_qr_tokens SET expires_at=?
   WHERE issued_by=? AND school_date=? AND expires_at>?`)
   .bind(stamp()-1,user.id,day,stamp()).run();
  return reply({ok:true,disabled:Number(result.meta?.changes||0)});
 }
 if(path==='/api/late/qr/queue'&&req.method==='GET'){
  const requested=new URL(req.url).searchParams.get('date');
  const viewDay=requested||day;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(viewDay)||!Number.isFinite(Date.parse(viewDay+'T00:00:00Z'))||
   viewDay>day||Date.parse(day+'T00:00:00Z')-Date.parse(viewDay+'T00:00:00Z')>31*86400000)
   fail(400,'แสดงประวัติ QR ได้ไม่เกิน 31 วันที่ผ่านมา');
  const {results}=await env.DB.prepare(`WITH scans AS (
    SELECT 'legacy-'||id AS id,request_id,student_id,school_date,issued_by,created_at
      FROM late_qr_submissions
    UNION ALL
    SELECT 'static-'||id AS id,request_id,student_id,school_date,
      NULL AS issued_by,created_at FROM late_static_qr_submissions
   )
   SELECT q.id,q.school_date,q.created_at,
    r.arrived_at,r.reason,r.state,s.student_no,s.full_name,
    ae.id AS auto_id,ae.active AS auto_active,c.advisor_user_id,
    c.label AS classroom_label,h.roll_no,q.issued_by
   FROM scans q
   JOIN late_self_requests r ON r.id=q.request_id
   LEFT JOIN late_qr_auto_events ae ON ae.request_id=q.request_id
   JOIN students s ON s.id=q.student_id
   LEFT JOIN student_enrollments h ON h.student_id=s.id
    AND h.start_date<=q.school_date AND (h.end_date IS NULL OR h.end_date>q.school_date)
   LEFT JOIN classrooms c ON c.id=h.classroom_id
   WHERE q.school_date=? AND (q.issued_by=? OR q.issued_by IS NULL OR ? IN('staff','admin'))
     AND (ae.id IS NULL OR ae.active=1)
   ORDER BY q.created_at DESC,q.id DESC LIMIT 150`).bind(viewDay,user.id,user.role).all();
  const items=results.map(row=>({...row,
   can_delete:!!row.auto_id&&(
    user.role==='staff'||user.role==='admin'||row.advisor_user_id===user.id),
   can_delete_rejected:row.state==='rejected'&&!row.auto_id&&(
    user.role==='staff'||user.role==='admin'||row.advisor_user_id===user.id||
    (row.id.startsWith('legacy-')&&row.issued_by===user.id))}));
  return reply({date:viewDay,time:schoolTime(),items,
    pending:items.filter(x=>x.state==='pending').length});
 }
 const deleteMatch=/^\/api\/late\/qr\/auto-(\d+)\/delete$/.exec(path);
 if(deleteMatch&&req.method==='POST')
  return reply(await revokeAutoLateQr(env,user,Number(deleteMatch[1])));
 const rejectedDelete=/^\/api\/late\/qr\/(static-\d+|legacy-\d+)\/delete-rejected$/.exec(path);
 if(rejectedDelete&&req.method==='POST'){
  const isPermanent=rejectedDelete[1].startsWith('static-');
  const id=Number(rejectedDelete[1].replace(/^(static-|legacy-)/,''));
  if(!Number.isSafeInteger(id)||id<1)fail(400,'รายการไม่ถูกต้อง');
  const source=isPermanent?'late_static_qr_submissions':'late_qr_submissions';
  const item=await env.DB.prepare(`SELECT q.request_id,${isPermanent?'NULL':'q.issued_by'} AS issued_by,
   r.state,r.school_date,ae.id AS auto_id,c.advisor_user_id
   FROM ${source} q JOIN late_self_requests r ON r.id=q.request_id
   LEFT JOIN late_qr_auto_events ae ON ae.request_id=r.id
   LEFT JOIN student_enrollments h ON h.student_id=r.student_id
    AND h.start_date<=r.school_date AND (h.end_date IS NULL OR h.end_date>r.school_date)
   LEFT JOIN classrooms c ON c.id=h.classroom_id
   WHERE q.id=?`).bind(id).first();
  if(!item)fail(404,'ไม่พบรายการลงชื่อ');
  if(!['staff','admin'].includes(user.role)&&item.advisor_user_id!==user.id&&
     (isPermanent||item.issued_by!==user.id))
   fail(403,'ลบได้เฉพาะรายการของครูเวรผู้รับผิดชอบหรือครูที่ปรึกษา');
  if(item.state!=='rejected'||item.auto_id)fail(409,'ลบได้เฉพาะรายการที่ไม่อนุมัติและไม่มีประวัติอนุมัติอัตโนมัติ');
  // Delete the rejected request, cascading only its QR submission. Keep the audit
  // trail; never alter late_records or attendance_daily from this endpoint.
  const results=await env.DB.batch([
   env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
    SELECT ?,'late_qr_rejected_deleted','late_self_requests',CAST(r.id AS TEXT)
    FROM late_self_requests r WHERE r.id=? AND r.state='rejected'
      AND NOT EXISTS(SELECT 1 FROM late_qr_auto_events e WHERE e.request_id=r.id)`)
    .bind(user.id,item.request_id),
   env.DB.prepare(`DELETE FROM late_self_requests WHERE id=? AND state='rejected'
    AND NOT EXISTS(SELECT 1 FROM late_qr_auto_events e
     WHERE e.request_id=late_self_requests.id)`).bind(item.request_id)
  ]);
  if(!results[0]?.meta?.changes||!results[1]?.meta?.changes)
   fail(409,'รายการนี้ถูกลบหรือเปลี่ยนสถานะแล้ว');
  return reply({ok:true,deleted:true,message:'ลบรายการที่ไม่อนุมัติแล้ว'});
 }
 const match=/^\/api\/late\/qr\/(static-\d+|legacy-\d+|\d+)\/review$/.exec(path);
 if(match&&req.method==='POST'){
  const b=await read(req),isPermanent=match[1].startsWith('static-');
  const id=Number(match[1].replace(/^(static-|legacy-)/,''));
  if(!['verified','rejected'].includes(b.state))fail(400,'สถานะไม่ถูกต้อง');
  const source=isPermanent?'late_static_qr_submissions':'late_qr_submissions';
  const item=await env.DB.prepare(`SELECT q.id,q.request_id,
   ${isPermanent?'NULL AS issued_by':'q.issued_by'},r.student_id,r.school_date,r.state
   FROM ${source} q JOIN late_self_requests r ON r.id=q.request_id WHERE q.id=?`)
   .bind(id).first();
  if(!item)fail(404,'ไม่พบรายการลงชื่อ');
  if(!isPermanent&&item.issued_by!==user.id&&!['staff','admin'].includes(user.role))
   fail(403,'ตรวจสอบได้เฉพาะรายการจาก QR ของครูเวรคนนี้');
  if(item.state!=='pending')fail(409,'รายการนี้ได้รับการตรวจสอบแล้ว');
  if(b.state==='verified'){
   const existing=await env.DB.prepare('SELECT id FROM late_records WHERE student_id=? AND school_date=?')
    .bind(item.student_id,item.school_date).first();
   if(existing)fail(409,'นักเรียนได้รับการบันทึกมาสายแล้ว');
   try{
    await env.DB.batch([
     env.DB.prepare(`INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
      SELECT student_id,school_date,arrived_at,reason,'verified',?,?
      FROM late_self_requests WHERE id=? AND state='pending'`).bind(user.id,user.id,item.request_id),
     env.DB.prepare(`UPDATE late_self_requests SET state='verified',verified_by=?,reviewed_at=CURRENT_TIMESTAMP
      WHERE id=? AND state='pending'`).bind(user.id,item.request_id),
     env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
      VALUES(?,'late_qr_verified','late_self_requests',?)`).bind(user.id,String(item.request_id))
    ]);
   }catch(err){if(/UNIQUE constraint/.test(err?.message||''))fail(409,'นักเรียนคนนี้ถูกบันทึกมาสายแล้ว');throw err}
  }else{
   const result=await env.DB.prepare(`UPDATE late_self_requests
    SET state='rejected',verified_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND state='pending'`)
    .bind(user.id,item.request_id).run();
   if(!result.meta?.changes)fail(409,'รายการนี้ได้รับการตรวจสอบแล้ว');
   await env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
    VALUES(?,'late_qr_rejected','late_self_requests',?)`).bind(user.id,String(item.request_id)).run();
  }
  return reply({ok:true,state:b.state});
 }
 fail(404,'ไม่พบ API');
}
export async function submitStudentLateQr(req,env,account){
 if(account.role!=='student'||account.must_change_password||!account.student_id||!account.active)
  fail(403,'กรุณาเข้าสู่ระบบด้วยบัญชีนักเรียนและเปลี่ยนรหัสผ่านชั่วคราวก่อน');
 await openGate(env);
 const b=await read(req),permanent=b.token==='gate';
 const token=permanent?'gate':secureCode(b.token);
 const reason=typeof b.reason==='string'?b.reason.trim():'';
 if(reason.length>300||/[\u0000-\u001f\u007f]/.test(reason))fail(400,'เหตุผลต้องไม่เกิน 300 ตัวอักษร');
 const day=schoolDay(),now=stamp();
 const qr=permanent?null:await env.DB.prepare(`SELECT id,issued_by FROM late_qr_tokens
 WHERE token_hash=? AND school_date=? AND expires_at>? LIMIT 1`)
 .bind(await hashed(token),day,now).first();
 if(!permanent&&!qr)fail(410,'QR หมดอายุหรือถูกเปลี่ยนแล้ว กรุณาสแกนใหม่');
 const student=await env.DB.prepare(`SELECT s.id FROM students s
 JOIN student_enrollments h ON h.student_id=s.id AND h.start_date<=?
   AND (h.end_date IS NULL OR h.end_date>?)
 WHERE s.id=? AND s.active=1 LIMIT 1`).bind(day,day,account.student_id).first();
 if(!student)fail(403,'บัญชีนักเรียนไม่ได้อยู่ในทะเบียนที่ใช้งานของวันนี้');
 const prior=await env.DB.prepare(`SELECT
  (SELECT COUNT(*) FROM late_records WHERE student_id=? AND school_date=?)
  +(SELECT COUNT(*) FROM late_self_requests WHERE student_id=? AND school_date=?) AS total`)
 .bind(student.id,day,student.id,day).first();
 if(prior?.total)fail(409,'วันนี้มีรายการลงชื่อมาสายของนักเรียนแล้ว กรุณาติดต่อครูเวรหากต้องแก้ไข');
 // Arrival time is generated by server, never accepted from student inputs.
 const arrival=schoolTime();
 if(permanent){
  try{return reply(await autoApproveLateQr(env,{studentId:student.id,day,arrival,reason}))}
  catch(e){if(/UNIQUE constraint/.test(e?.message||''))fail(409,'ลงชื่อมาสายวันนี้แล้ว');throw e}
 }
 try{
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO late_self_requests(student_id,school_date,arrived_at,reason)
    VALUES(?,?,?,?)`).bind(student.id,day,arrival,reason),
   permanent?
     env.DB.prepare(`INSERT INTO late_static_qr_submissions(request_id,student_id,school_date)
      SELECT id,?,? FROM late_self_requests WHERE student_id=? AND school_date=?`)
      .bind(student.id,day,student.id,day):
     env.DB.prepare(`INSERT INTO late_qr_submissions(request_id,token_id,student_id,school_date,issued_by)
      SELECT id,?,?,?,? FROM late_self_requests WHERE student_id=? AND school_date=?`)
      .bind(qr.id,student.id,day,qr.issued_by,student.id,day)
  ]);
 }catch(e){if(/UNIQUE constraint/.test(e?.message||''))fail(409,'ลงชื่อมาสายวันนี้แล้ว');throw e}
 return reply({ok:true,date:day,arrivedAt:arrival,state:'pending',
  message:'ลงชื่อมาสายสำเร็จ รอครูเวรตรวจสอบ'});
}
