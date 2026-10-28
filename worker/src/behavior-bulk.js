// Authorized student lookup and transactional multi-student merit/conduct recording.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const respond=(data,status=200)=>new Response(JSON.stringify(data),
 {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const id=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const affairsUser=user=>['admin','staff'].includes(user?.role)||
 (user?.role==='teacher'&&Number(user?.student_affairs)===1);
const accessible=`(EXISTS(SELECT 1 FROM classrooms c2
 WHERE c2.id=s.classroom_id AND c2.advisor_user_id=?)
 OR EXISTS(SELECT 1 FROM timetable t
 WHERE t.classroom_id=s.classroom_id AND t.teacher_user_id=? AND t.active=1))`;

export function normalizeBehaviorStudentIds(values){
 if(!Array.isArray(values)||values.length===0||values.length>200)
  fail(400,'กรุณาเลือกนักเรียน 1–200 คนต่อครั้ง');
 const ids=values.map(id);
 if(ids.some(value=>value===null)||new Set(ids).size!==ids.length)
  fail(400,'เลขอ้างอิงนักเรียนไม่ถูกต้องหรือซ้ำกัน');
 return ids;
}

export async function searchBehaviorStudents(req,env,user){
 const query=new URL(req.url).searchParams.get('query')||'';
 if(query.length>60||/[\u0000-\u001f\u007f]/.test(query))
  fail(400,'คำค้นมีรูปแบบไม่ถูกต้อง');
 const term=query.trim();
 if(term.length<2)fail(400,'กรุณากรอกเลขประจำตัวหรือชื่อนักเรียนอย่างน้อย 2 ตัวอักษร');
 const restricted=!affairsUser(user);
 const where=restricted?`AND ${accessible}`:'';
 const args=restricted?[term,term,user.id,user.id,term]:[term,term,term];
 const {results}=await env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,s.roll_no,
  s.classroom_id,c.label AS classroom_label
  FROM students s JOIN classrooms c ON c.id=s.classroom_id
  WHERE s.active=1 AND (instr(lower(s.student_no),lower(?))>0 OR instr(lower(s.full_name),lower(?))>0)
  ${where}
  ORDER BY CASE WHEN s.student_no=? THEN 0 ELSE 1 END,c.grade,c.room,s.roll_no
  LIMIT 60`).bind(...args).all();
 return respond({items:results});
}

export async function recordBehaviorBulk(env,user,body){
 if(Object.hasOwn(body,'points')||Object.hasOwn(body,'category')||
  Object.hasOwn(body,'adjustment_rule_id'))
  fail(400,'ต้องใช้เกณฑ์คะแนนที่ได้รับอนุมัติ ไม่สามารถกรอกคะแนนเอง');
 const ids=normalizeBehaviorStudentIds(body.student_ids),ruleId=id(body.rule_id);
 const rule=ruleId?await env.DB.prepare(
  'SELECT id,name,category,points,active FROM affairs_behavior_rules WHERE id=?')
  .bind(ruleId).first():null;
 if(!rule?.active||!['good','minor','moderate','serious','very_serious'].includes(rule.category))
  fail(400,'กรุณาเลือกเกณฑ์คะแนนที่เปิดใช้งาน');
 const points=Number(rule.points);
 if(!Number.isSafeInteger(points)||Math.abs(points)>50||points===0||
   (rule.category==='good'&&points<0)||(rule.category!=='good'&&points>0))
  fail(400,'ประเภทและจำนวนคะแนนไม่ตรงเกณฑ์');
 if(body.reason!==undefined&&body.reason!==null&&typeof body.reason!=='string')
  fail(400,'รายละเอียดต้องเป็นข้อความ');
 const detail=(body.reason||'').trim();
 if(detail.length>300)fail(400,'รายละเอียดต้องไม่เกิน 300 ตัวอักษร');
 const reason=detail||rule.name;
 // Check every member against the current permissions before writing any record.
 const restricted=!affairsUser(user);
 const placeholders=ids.map(()=>'?').join(',');
 const accessSql=`SELECT s.id FROM students s WHERE s.active=1
  AND s.id IN (${placeholders}) ${restricted?'AND '+accessible:''}`;
 const {results}=await env.DB.prepare(accessSql)
  .bind(...ids,...(restricted?[user.id,user.id]:[])).all();
 if(results.length!==ids.length)
  fail(403,'มีนักเรียนที่ไม่อยู่ในสิทธิ์ของครู กรุณาเลือกรายชื่อใหม่');
 const statements=[];
 for(const studentId of ids){
  statements.push(env.DB.prepare(`INSERT INTO behavior_records
   (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
   VALUES(?,?,?,?,?,?)`).bind(studentId,points,reason,user.id,rule.id,rule.category));
  // The batch executes sequentially in one D1 transaction. Capture the ID of
  // the preceding behavior insert before adding the audit row.
  statements.push(env.DB.prepare(`INSERT INTO audit_logs
   (actor_id,action,entity_type,entity_id)
   VALUES(?,'affairs_behavior_recorded','behavior_records',CAST(last_insert_rowid() AS TEXT))`)
   .bind(user.id));
 }
 await env.DB.batch(statements);
 return respond({ok:true,count:ids.length,points,category:rule.category,rule_name:rule.name},201);
}
