// File-backed score records: only current, approved misconduct/merit rules.
// Client never sends raw points. All committed rows are D1-transactional and
// have a durable idempotency receipt, so resuming the same file doesn't double score.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,
 headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const adminAffairs=u=>['admin','staff'].includes(u?.role)||
 (u?.role==='teacher'&&Number(u?.student_affairs)===1);
const scopeSql=`AND (EXISTS(SELECT 1 FROM classrooms c
 WHERE c.id=s.classroom_id AND (c.advisor_user_id=? OR c.advisor2_user_id=?))
 OR EXISTS(SELECT 1 FROM timetable t WHERE t.classroom_id=s.classroom_id
 AND t.teacher_user_id=? AND t.active=1))`;
const allowedModes=new Set(['behavior','good']);
const isUuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function normalizeRows(body){
 if(!allowedModes.has(body?.mode)||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>20)
  fail(400,'รูปแบบการนำเข้าหรือจำนวนแถวไม่ถูกต้อง (สูงสุด 20 แถวต่อชุด)');
 const numbers=new Set(),keys=new Set();
 return body.rows.map((r,i)=>{
  const rowNo=Number(r?.row_no),ruleId=Number(r?.rule_id);
  const studentNo=typeof r?.student_no==='string'?r.student_no.trim():'';
  const reason=typeof r?.reason==='string'?r.reason.trim():'';
  if(!Number.isSafeInteger(rowNo)||rowNo<2||rowNo>100000||numbers.has(rowNo))
   fail(400,'เลขแถว Excel ไม่ถูกต้องหรือซ้ำกัน');
  numbers.add(rowNo);
  if(!studentNo||studentNo.length>40||/[\u0000-\u001f\u007f]/.test(studentNo)||
    !Number.isSafeInteger(ruleId)||ruleId<1||
    reason.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason))
   return {row_no:rowNo,student_no:studentNo,rule_id:ruleId,reason,error:'รหัสนักเรียน/เกณฑ์คะแนน/รายละเอียดไม่ถูกต้อง'};
  const key=studentNo.toLowerCase()+':'+ruleId;
  if(keys.has(key))return {row_no:rowNo,student_no:studentNo,rule_id:ruleId,reason,error:'นักเรียนและเกณฑ์นี้ซ้ำในชุดเดียวกัน'};
  keys.add(key);
  return {row_no:rowNo,student_no:studentNo,rule_id:ruleId,reason};
 });
}
export async function previewScoreImport(env,user,body){
 const rows=normalizeRows(body),restricted=!adminAffairs(user);
 const studentNos=[...new Set(rows.filter(r=>!r.error).map(r=>r.student_no))];
 const ids=[...new Set(rows.filter(r=>!r.error).map(r=>r.rule_id))];
 const [people,ruleResults]=await Promise.all([
  studentNos.length?env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,c.label AS classroom_label
   FROM students s JOIN classrooms c ON c.id=s.classroom_id WHERE s.active=1
   AND s.student_no IN (${studentNos.map(()=>'?').join(',')})
   ${restricted?scopeSql:''}`).bind(...studentNos,...(restricted?[user.id,user.id,user.id]:[])).all():
   Promise.resolve({results:[]}),
  ids.length?env.DB.prepare(`SELECT id,name,category,points,active
   FROM affairs_behavior_rules WHERE id IN (${ids.map(()=>'?').join(',')})
   AND id NOT IN (SELECT rule_id FROM truancy_score_policy)`).bind(...ids).all():
   Promise.resolve({results:[]})
 ]);
 const students=new Map((people.results||[]).map(x=>[String(x.student_no),x]));
 const rules=new Map((ruleResults.results||[]).map(x=>[Number(x.id),x]));
 const checked=rows.map(row=>{
  const student=students.get(row.student_no),rule=rules.get(row.rule_id);
  let issue=row.error||'';
  if(!issue&&!student)issue='ไม่พบนักเรียนที่เปิดใช้งานหรือไม่อยู่ในสิทธิ์ของครู';
  if(!issue&&(!rule||Number(rule.active)!==1))issue='ไม่พบเกณฑ์คะแนนที่เปิดใช้งาน';
  if(!issue&&(!['good','minor','moderate','serious','very_serious'].includes(rule.category)||
    (body.mode==='good')!==(rule.category==='good')||
    !Number.isSafeInteger(Number(rule.points))||Number(rule.points)===0||
    Math.abs(Number(rule.points))>50||
    (rule.category==='good'&&Number(rule.points)<0)||
    (rule.category!=='good'&&Number(rule.points)>0)))
   issue='เกณฑ์คะแนนไม่ตรงหมวดความผิด/ความดี';
  return {row_no:row.row_no,student_no:row.student_no,rule_id:row.rule_id,
   reason:row.reason,student_id:student?.id||null,full_name:student?.full_name||'',
   classroom_label:student?.classroom_label||'',rule_name:rule?.name||'',
   points:rule?.points??null,category:rule?.category||'',error:issue};
 });
 return checked;
}
export async function scoreImportRoutes(env,user,path,body){
 if(!['admin','staff','teacher'].includes(user?.role))fail(403,'เฉพาะครูและฝ่ายกิจการนักเรียน');
 if(!['/api/affairs/behavior/import/preview','/api/affairs/behavior/import/commit'].includes(path))
  fail(404,'ไม่พบ API');
 const checked=await previewScoreImport(env,user,body);
 if(path.endsWith('/preview'))return reply({items:checked});
 if(!isUuid(body.import_id))fail(400,'รหัสชุดนำเข้าไม่ถูกต้อง');
 const errors=checked.filter(r=>r.error);
 if(errors.length)fail(400,'พบข้อผิดพลาดในการนำเข้าแถว '+errors.map(x=>x.row_no).join(', '));
 const rows=normalizeRows(body);
 const previous=(await env.DB.prepare(`SELECT row_no,actor_id,mode,student_id,rule_id,reason,behavior_record_id
  FROM score_import_receipts WHERE import_id=? AND row_no IN (${rows.map(()=>'?').join(',')})`)
  .bind(body.import_id,...rows.map(x=>x.row_no)).all()).results||[];
 const existing=new Map(previous.map(x=>[Number(x.row_no),x]));
 let skipped=0;const fresh=[];
 for(const row of checked){
  const detail=row.reason||row.rule_name;
  const old=existing.get(row.row_no);
  if(old){
   if(old.actor_id!==user.id||old.mode!==body.mode||
     Number(old.student_id)!==Number(row.student_id)||Number(old.rule_id)!==Number(row.rule_id)||
     old.reason!==detail||!old.behavior_record_id)
    fail(409,'พบหมายเลขชุด/แถวเดิมที่มีข้อมูลไม่ตรงกัน กรุณาเลือกไฟล์ใหม่');
   skipped++;continue;
  }
  fresh.push({...row,detail});
 }
 if(fresh.length){
  const statements=[];
  for(const row of fresh){
   statements.push(env.DB.prepare(`INSERT INTO behavior_records
    (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
    VALUES(?,?,?,?,?,?)`).bind(row.student_id,row.points,row.detail,user.id,row.rule_id,row.category));
   statements.push(env.DB.prepare(`INSERT INTO score_import_receipts
    (import_id,row_no,actor_id,mode,student_id,rule_id,reason,behavior_record_id)
    VALUES(?,?,?,?,?,?,?,last_insert_rowid())`)
    .bind(body.import_id,row.row_no,user.id,body.mode,row.student_id,row.rule_id,row.detail));
   statements.push(env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
    SELECT ?,'affairs_score_excel_imported','behavior_records',CAST(behavior_record_id AS TEXT)
    FROM score_import_receipts WHERE import_id=? AND row_no=?`)
    .bind(user.id,body.import_id,row.row_no));
  }
  // One atomic D1 batch per 20 rows. Prior receipts are rechecked on retry.
  await env.DB.batch(statements);
 }
 return reply({ok:true,inserted:fresh.length,skipped,count:checked.length});
}
