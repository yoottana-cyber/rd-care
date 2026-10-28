// Verified bulk behavior adjustments. All students must be authorized and have
// enough outstanding misconduct points; the entire batch is atomic.
import {normalizeBehaviorStudentIds} from './behavior-bulk.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,
 headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const positiveId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const unrestricted=user=>['admin','staff'].includes(user?.role)||
 (user?.role==='teacher'&&Number(user.student_affairs)===1);
const scopeSql=`(EXISTS(SELECT 1 FROM classrooms c2
 WHERE c2.id=s.classroom_id AND c2.advisor_user_id=?)
 OR EXISTS(SELECT 1 FROM timetable t
 WHERE t.classroom_id=s.classroom_id AND t.teacher_user_id=? AND t.active=1))`;
const outstandingSql=`COALESCE(SUM(CASE WHEN b.points<0 THEN -b.points
 WHEN b.affairs_category='adjustment' AND b.points>0 THEN -b.points
 ELSE 0 END),0)`;

export async function adjustmentSelection(env,user,studentIds){
 const ids=normalizeBehaviorStudentIds(studentIds),restricted=!unrestricted(user);
 const {results}=await env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,
  ${outstandingSql} AS remaining
  FROM students s LEFT JOIN behavior_records b
   ON b.student_id=s.id AND b.deleted_at IS NULL
  WHERE s.active=1 AND s.id IN (${ids.map(()=>'?').join(',')})
   ${restricted?'AND '+scopeSql:''}
  GROUP BY s.id`)
  .bind(...ids,...(restricted?[user.id,user.id]:[])).all();
 if(results.length!==ids.length)fail(403,'มีนักเรียนที่ไม่ได้รับอนุญาตหรือไม่อยู่ในทะเบียนที่ใช้งาน');
 const byId=new Map(results.map(row=>[Number(row.id),row]));
 return ids.map(id=>({...byId.get(id),remaining:Math.max(0,Number(byId.get(id).remaining)||0)}));
}

export async function previewBehaviorAdjustments(env,user,body){
 if(Object.keys(body).some(key=>!['student_ids','adjustment_rule_id'].includes(key)))
  fail(400,'รูปแบบการตรวจสอบรายการไม่ถูกต้อง');
 const ruleId=positiveId(body.adjustment_rule_id);
 const rule=ruleId?await env.DB.prepare(`SELECT id,name,points,active
  FROM affairs_adjustment_rules WHERE id=?`).bind(ruleId).first():null;
 if(!rule?.active||!Number.isInteger(Number(rule.points))||Number(rule.points)<=0||Number(rule.points)>50)
  fail(400,'กรุณาเลือกเกณฑ์ปรับพฤติกรรมที่เปิดใช้งาน');
 const items=await adjustmentSelection(env,user,body.student_ids);
 const points=Number(rule.points);
 return {rule:{id:rule.id,name:rule.name,points},
  items:items.map(item=>({...item,eligible:item.remaining>=points})),
  all_eligible:items.every(item=>item.remaining>=points)};
}

export async function recordBehaviorAdjustmentBulk(env,user,body){
 if(Object.keys(body).some(key=>!['student_ids','adjustment_rule_id','reason'].includes(key)))
  fail(400,'กรุณาใช้เกณฑ์ที่อนุมัติ ไม่สามารถกำหนดคะแนนเอง');
 if(body.reason!==undefined&&body.reason!==null&&typeof body.reason!=='string')
  fail(400,'รายละเอียดต้องเป็นข้อความ');
 const reasonText=String(body.reason||'').trim();
 if(reasonText.length>300)fail(400,'รายละเอียดต้องไม่เกิน 300 ตัวอักษร');
 const preview=await previewBehaviorAdjustments(env,user,{
  student_ids:body.student_ids,adjustment_rule_id:body.adjustment_rule_id
 });
 if(!preview.all_eligible)
  fail(409,'มีนักเรียนที่คะแนนความผิดคงเหลือไม่เพียงพอ กรุณาตรวจสอบรายชื่อก่อนบันทึก');
 const rule=preview.rule,reason=reasonText||rule.name,restricted=!unrestricted(user);
 const statements=[];
 for(const row of preview.items){
  // If scores, rule or access changed after preview, a NOT NULL constraint
  // failure aborts/rolls back the entire D1 transactional batch.
  const sql=`INSERT INTO behavior_records
   (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category,adjustment_rule_id)
   VALUES(?,CASE WHEN
    EXISTS(SELECT 1 FROM students s WHERE s.id=? AND s.active=1
     ${restricted?'AND '+scopeSql:''})
    AND EXISTS(SELECT 1 FROM affairs_adjustment_rules ar
     WHERE ar.id=? AND ar.active=1 AND ar.points=?)
    AND ?<=(SELECT COALESCE(SUM(CASE WHEN b.points<0 THEN -b.points
     WHEN b.affairs_category='adjustment' AND b.points>0 THEN -b.points
     ELSE 0 END),0) FROM behavior_records b
     WHERE b.student_id=? AND b.deleted_at IS NULL)
    THEN ? ELSE NULL END,?,?,NULL,'adjustment',?)`;
  statements.push(env.DB.prepare(sql).bind(row.id,row.id,
   ...(restricted?[user.id,user.id]:[]),rule.id,rule.points,rule.points,
   row.id,rule.points,reason,user.id,rule.id));
  statements.push(env.DB.prepare(`INSERT INTO audit_logs
   (actor_id,action,entity_type,entity_id)
   VALUES(?,'affairs_behavior_adjusted','behavior_records',CAST(last_insert_rowid() AS TEXT))`)
   .bind(user.id));
 }
 try{
  await env.DB.batch(statements);
 }catch(error){
  if(/constraint|not null|check failed/i.test(String(error?.message||'')))
   fail(409,'คะแนนหรือสิทธิ์ของนักเรียนบางคนเปลี่ยนไป ไม่มีการบันทึก กรุณาตรวจสอบอีกครั้ง');
  throw error;
 }
 return respond({ok:true,count:preview.items.length,points:rule.points,
  category:'adjustment',rule_name:rule.name},201);
}
