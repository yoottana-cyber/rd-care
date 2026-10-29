// One occurrence per student and approved rule. D1 executes each INSERT in a
// batch transaction, so warning numbers are computed from the current ledger.
export const warningAllowance=category=>category==='minor'?2:category==='moderate'?1:0;
export const affairsRecorder=user=>user?.role==='admin'||
 (user?.role==='teacher'&&Number(user?.student_affairs)===1);
export const seriousConduct=category=>['serious','very_serious'].includes(category);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
export function ensureRecorder(user,category){
 if(seriousConduct(category)&&!affairsRecorder(user))
  fail(403,'ความผิดร้ายแรงและร้ายแรงมาก บันทึกได้เฉพาะครูฝ่ายกิจการนักเรียน');
}
const tokenFormat=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function behaviorRequestId(value){
 const token=value===undefined?crypto.randomUUID():value;
 if(typeof token!=='string'||!tokenFormat.test(token))
  fail(400,'รหัสอ้างอิงคำขอบันทึกไม่ถูกต้อง');
 return token.toLowerCase();
}
export function incidentInsert(db,studentId,rule,reason,actorId,requestId){
 return db.prepare(`INSERT OR IGNORE INTO behavior_incidents(
  student_id,affairs_rule_id,affairs_category,rule_points,reason,recorded_by,
  points_applied,warning_no,request_id)
 SELECT ?,r.id,r.category,r.points,?,?,
  CASE WHEN (r.category='minor' AND history.n<2) OR
            (r.category='moderate' AND history.n<1) THEN 0 ELSE r.points END,
  CASE WHEN (r.category='minor' AND history.n<2) OR
            (r.category='moderate' AND history.n<1) THEN history.n+1 ELSE 0 END,?
 FROM affairs_behavior_rules r
 CROSS JOIN (SELECT COUNT(*) AS n FROM behavior_incidents i
  WHERE i.student_id=? AND i.affairs_rule_id=? AND i.deleted_at IS NULL) history
 WHERE r.id=? AND r.active=1 AND r.deleted_at IS NULL
 AND r.id NOT IN (SELECT rule_id FROM truancy_score_policy)`)
  .bind(studentId,reason,actorId,requestId,studentId,rule.id,rule.id);
}
/** D1.batch atomically inserts and selects the receipts within one transaction.
 * Trigger side effects can make meta.changes > 1 or change meta.last_row_id;
 * neither is evidence of missing or duplicated incident records.
 */
export async function commitBehaviorIncidents(db,studentIds,rule,reason,actorId,requestId){
 const placeholders=studentIds.map(()=>'?').join(',');
 const receipts=db.prepare(`SELECT id,student_id,affairs_rule_id,reason,affairs_category,
  points_applied,warning_no,behavior_record_id FROM behavior_incidents
  WHERE request_id=? AND student_id IN (${placeholders})`)
  .bind(requestId,...studentIds);
 const output=await db.batch([
  ...studentIds.map(studentId=>incidentInsert(db,studentId,rule,reason,actorId,requestId)),
  receipts
 ]);
 const items=output[output.length-1]?.results;
 if(!Array.isArray(items)||items.length!==studentIds.length)
  fail(409,'ตรวจสอบรายการบันทึกไม่ครบ กรุณาตรวจประวัติก่อนส่งอีกครั้ง');
 const byStudent=new Map(items.map(item=>[Number(item.student_id),item]));
 if(byStudent.size!==studentIds.length||studentIds.some(id=>{
  const item=byStudent.get(id);
  return !item||Number(item.affairs_rule_id)!==Number(rule.id)||
   String(item.reason)!==reason||!Number.isSafeInteger(Number(item.id));
 }))fail(409,'รหัสคำขอถูกใช้กับรายการอื่นแล้ว กรุณาตรวจสอบก่อนบันทึก');
 return studentIds.map(id=>byStudent.get(id));
}
export const incidentSummary=items=>({
 count:items.length,warned:items.filter(x=>Number(x.points_applied)===0).length,
 deducted:items.filter(x=>Number(x.points_applied)<0).length,
 merited:items.filter(x=>Number(x.points_applied)>0).length,
 items:items.map(x=>({student_id:x.student_id,points:Number(x.points_applied),
  warning_no:Number(x.warning_no)||0,incident_id:x.id}))
});
