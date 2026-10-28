// Read-only schoolwide score monitoring for authenticated school staff and teachers.
// No disciplinary-case reports or write capability.
import {bangkokToday} from './core.js';
import {caseTypeSql,scoreColumns,scoreSummary} from './score-ledger.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=data=>new Response(JSON.stringify(data),{
 status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export function allowSchoolScoreMonitor(user){
 return ['teacher','staff','admin'].includes(user?.role);
}
export async function schoolScoreMonitorSummary(env,user){
 if(!allowSchoolScoreMonitor(user))fail(403,'เฉพาะบุคลากรโรงเรียน');
 const date=bangkokToday();
 const {results}=await env.DB.prepare(`SELECT c.id AS classroom_id,c.grade,c.label AS classroom_label,
  s.id AS student_id,s.student_no,s.full_name,${scoreColumns('b')},
  COUNT(b.id) AS events
  FROM students s
  JOIN classrooms c ON c.id=s.classroom_id
  LEFT JOIN behavior_records b
   ON b.student_id=s.id AND b.deleted_at IS NULL AND substr(b.created_at,1,10)<=?
  WHERE s.active=1
  GROUP BY s.id
  ORDER BY c.grade,c.room,s.roll_no`).bind(date).all();
 return reply({date,read_only:true,items:(results||[]).map(row=>({
  ...row,...scoreSummary(row)
 }))});
}
export async function schoolScoreMonitorHistory(req,env,user){
 if(!allowSchoolScoreMonitor(user))fail(403,'เฉพาะบุคลากรโรงเรียน');
 const query=new URL(req.url).searchParams;
 const studentId=validId(query.get('student_id'));
 if(!studentId)fail(400,'กรุณาระบุนักเรียนที่ต้องการดูประวัติ');
 const limitRaw=query.get('limit'),offsetRaw=query.get('offset');
 const limit=limitRaw===null?100:Number(limitRaw);
 const offset=offsetRaw===null?0:Number(offsetRaw);
 if(!Number.isSafeInteger(limit)||limit<1||limit>200||
  !Number.isSafeInteger(offset)||offset<0||offset>100000)
  fail(400,'รูปแบบการแบ่งหน้าประวัติไม่ถูกต้อง');
 const student=await env.DB.prepare('SELECT id FROM students WHERE id=? AND active=1')
  .bind(studentId).first();
 if(!student)fail(404,'ไม่พบนักเรียนที่ใช้งาน');
 const {results}=await env.DB.prepare(`SELECT b.id,b.points,b.reason,b.created_at,
  b.affairs_category,${caseTypeSql('b')} AS score_type,
  COALESCE(ar.name,adj.name,
   CASE WHEN b.affairs_category='adjustment' THEN 'ปรับพฤติกรรม'
    WHEN b.points>0 THEN 'ทำความดี' ELSE 'บันทึกความผิด' END) AS action_name,
  u.display_name AS teacher_name
  FROM behavior_records b
  JOIN users u ON u.id=b.recorded_by
  LEFT JOIN affairs_behavior_rules ar ON ar.id=b.affairs_rule_id
  LEFT JOIN affairs_adjustment_rules adj ON adj.id=b.adjustment_rule_id
  WHERE b.student_id=? AND b.deleted_at IS NULL
  ORDER BY b.id DESC LIMIT ? OFFSET ?`).bind(studentId,limit+1,offset).all();
 const row=await env.DB.prepare(`SELECT ${scoreColumns('b')}
  FROM behavior_records b WHERE b.student_id=?`).bind(studentId).first();
 const scores=scoreSummary(row);
 return reply({items:(results||[]).slice(0,limit).map(r=>({...r,can_delete:0})),
  has_more:(results||[]).length>limit,
  next_offset:offset+Math.min(limit,(results||[]).length),
  read_only:true,total:-scores.behavior_remaining,...scores});
}
