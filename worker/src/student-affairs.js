import {bangkokToday,validDate,weekday} from './core.js';
import {sendDailyAttendanceReminderPush} from './staff-push.js';
import {scoreColumns,scoreSummary} from './score-ledger.js';
import {searchBehaviorStudents,recordBehaviorBulk} from './behavior-bulk.js';
import {scoreImportRoutes} from './score-excel-import.js';
import {schoolScoreMonitorSummary,schoolScoreMonitorHistory} from './teacher-score-monitor.js';
import {previewBehaviorAdjustments,recordBehaviorAdjustmentBulk} from './adjustment-bulk.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const staff=u=>['admin','staff'].includes(u?.role)||(u?.role==='teacher'&&Number(u?.student_affairs)===1);
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const string=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const text=(v,max=300)=>{const s=string(v,max);if(!s)fail(400,'กรุณากรอกรายละเอียด');return s};
const checkedDate=d=>{if(!validDate(d)||d>bangkokToday())fail(400,'วันที่ไม่ถูกต้องหรือเป็นอนาคต');return d};
const categories=['good','minor','moderate','serious','very_serious'];
const label={good:'ทำความดี',minor:'ความผิดเล็กน้อย',moderate:'ความผิดปานกลาง',serious:'ความผิดร้ายแรง',very_serious:'ความผิดร้ายแรงมาก',adjustment:'ปรับคะแนน'};
const timeBangkok=()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
const log=(db,user,action,type,entity)=>db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)').bind(user,action,type,String(entity)).run();
const roomRows=async (env,date)=>{
 const {results}=await env.DB.prepare(`SELECT c.id,c.grade,c.label,c.advisor_user_id,c.advisor2_user_id,u.display_name AS advisor_name,u2.display_name AS advisor2_name,
  COUNT(s.id) AS students,COUNT(d.student_id) AS checked
 FROM classrooms c LEFT JOIN users u ON u.id=c.advisor_user_id AND u.active=1
 LEFT JOIN users u2 ON u2.id=c.advisor2_user_id AND u2.active=1
 LEFT JOIN student_enrollments h ON h.classroom_id=c.id AND h.start_date<=?
  AND (h.end_date IS NULL OR h.end_date>?)
 LEFT JOIN students s ON s.id=h.student_id AND s.active=1
 LEFT JOIN attendance_daily d ON d.student_id=s.id AND d.school_date=?
 GROUP BY c.id,c.grade,c.label,c.advisor_user_id,c.advisor2_user_id,u.display_name,u2.display_name ORDER BY c.grade,c.room`)
 .bind(date,date,date).all();
 return results.map(r=>({...r,students:Number(r.students)||0,checked:Number(r.checked)||0,
  complete:Number(r.students)>0&&Number(r.checked)>=Number(r.students),
  missing:Number(r.students)>0?Math.max(0,Number(r.students)-Number(r.checked)):0}));
};
const settings=async env=>(await env.DB.prepare('SELECT * FROM affairs_settings WHERE id=1').first())||{auto_enabled:0,reminder_time:'08:30',weekdays:'1,2,3,4,5'};
async function roster(env){
 const [teachers,rooms,heads]=await Promise.all([
  env.DB.prepare("SELECT id,display_name,active FROM users WHERE role IN ('teacher','staff') ORDER BY display_name").all(),
  env.DB.prepare(`SELECT c.id,c.label,c.grade,c.advisor_user_id,c.advisor2_user_id,u.display_name AS advisor_name,u2.display_name AS advisor2_name
   FROM classrooms c LEFT JOIN users u ON u.id=c.advisor_user_id
   LEFT JOIN users u2 ON u2.id=c.advisor2_user_id ORDER BY c.grade,c.room`).all(),
  env.DB.prepare(`SELECT h.grade,h.teacher_user_id,u.display_name AS teacher_name
    FROM affairs_grade_heads h JOIN users u ON u.id=h.teacher_user_id ORDER BY h.grade`).all()
 ]);
 return {teachers:teachers.results||[],rooms:rooms.results||[],heads:heads.results||[]};
}
async function eligibility(env,u,student){
 if(staff(u)||u.role==='admin')return env.DB.prepare('SELECT id FROM students WHERE id=? AND active=1').bind(student).first();
 if(u.role!=='teacher')return null;
 return env.DB.prepare(`SELECT s.id FROM students s WHERE s.id=? AND s.active=1 AND
  (EXISTS(SELECT 1 FROM classrooms c WHERE c.id=s.classroom_id AND (c.advisor_user_id=? OR c.advisor2_user_id=?))
   OR EXISTS(SELECT 1 FROM timetable t WHERE t.classroom_id=s.classroom_id AND t.teacher_user_id=? AND t.active=1))`)
  .bind(student,u.id,u.id,u.id).first();
}
async function recordBehavior(env,u,b,adjust=false){
 const student=id(b.student_id);
 if(!student||!await eligibility(env,u,student))fail(403,'ไม่มีสิทธิ์บันทึกนักเรียนคนนี้');
 let points,category,ruleId=null,adjustId=null,ruleName='';
 if(adjust){
  // An ordinary teacher may record a verified adjustment for a student they teach/advice.
  // The eligibility check above and the approved rule + atomic outstanding score gate remain required.
  if(b.points!==undefined||b.category!==undefined)fail(400,'ต้องเลือกเกณฑ์ปรับพฤติกรรมที่อนุมัติแล้ว ไม่สามารถกรอกคะแนนเอง');
  adjustId=id(b.adjustment_rule_id);
  const rule=adjustId?await env.DB.prepare(
   'SELECT id,name,points,active FROM affairs_adjustment_rules WHERE id=?').bind(adjustId).first():null;
  if(!rule?.active)fail(400,'เลือกเกณฑ์ปรับพฤติกรรมที่เปิดใช้งาน');
  points=Number(rule.points);category='adjustment';ruleName=rule.name;
 }else{
  ruleId=id(b.rule_id);
  const rule=ruleId?await env.DB.prepare(
   'SELECT id,name,category,points,active FROM affairs_behavior_rules WHERE id=? AND id NOT IN (SELECT rule_id FROM truancy_score_policy)')
   .bind(ruleId).first():null;
  if(!rule?.active)fail(400,'เลือกเกณฑ์คะแนนที่ฝ่ายกิจการนักเรียนเปิดใช้งาน');
  points=Number(rule.points);category=rule.category;ruleName=rule.name;
  if(category==='good'&&points<=0||category!=='good'&&points>=0)
   fail(400,'ประเภทคะแนนไม่ตรงเกณฑ์ที่กำหนด');
 }
 const reason=text(b.reason||ruleName,300);
 let insert;
 if(adjust){
  // Atomic check against outstanding misconduct; merits never offset violations.
  insert=await env.DB.prepare(`INSERT INTO behavior_records
   (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category,adjustment_rule_id)
   SELECT ?,?,?,?,NULL,'adjustment',? WHERE ?>0 AND ?<=
    (SELECT COALESCE(SUM(CASE WHEN points<0 THEN -points
      WHEN affairs_category='adjustment' AND points>0 THEN -points ELSE 0 END),0)
     FROM behavior_records WHERE student_id=? AND deleted_at IS NULL)`)
   .bind(student,points,reason,u.id,adjustId,points,points,student).run();
  if(!insert.meta.changes)fail(409,'คะแนนพฤติกรรมค้างสะสมไม่เพียงพอสำหรับเกณฑ์ปรับพฤติกรรมที่เลือก');
 }else{
  insert=await env.DB.prepare(`INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
   VALUES(?,?,?,?,?,?)`).bind(student,points,reason,u.id,ruleId,category).run();
 }
 await log(env.DB,u.id,adjust?'affairs_behavior_adjusted':'affairs_behavior_recorded',
  'behavior_records',insert.meta.last_row_id);
 return reply({ok:true,id:insert.meta.last_row_id,points,category,rule_name:ruleName},201);
}
async function notifyOne(env,room,date,kind,actorId=null){
 // Unique room/day/type makes both cron replay and repeated manual POST idempotent.
 if(room.complete||room.students===0||!(room.advisor_user_id||room.advisor2_user_id))return {room:room.label,state:'not_needed'};
 const claim=await env.DB.prepare(`INSERT OR IGNORE INTO affairs_attendance_reminders(classroom_id,school_date,kind,actor_id)
  VALUES(?,?,?,?)`).bind(room.id,date,kind,actorId).run();
 if(claim.meta.changes===0)return {room:room.label,state:'already_queued'};
 const reminderId=claim.meta.last_row_id;
 let delivered=0,attempted=0;
 const d=await env.DB.prepare(`SELECT p.id,p.user_id,p.endpoint,p.p256dh,p.auth FROM staff_push_subscriptions p
  JOIN users u ON u.id=p.user_id AND u.active=1 AND u.role IN ('teacher','staff')
  WHERE p.user_id IN (?,?) ORDER BY p.id LIMIT 10`).bind(room.advisor_user_id||0,room.advisor2_user_id||0).all();
 for(const device of d.results||[]){
  attempted++;
  try{
   const response=await sendDailyAttendanceReminderPush(device,env,{classroomId:room.id,date});
   if(response.ok)delivered++;
   else if([404,410].includes(response.status))
    await env.DB.prepare('DELETE FROM staff_push_subscriptions WHERE id=? AND user_id=?').bind(device.id,device.user_id).run();
  }catch(e){console.warn('RD CONNECT attendance reminder push failed',e?.name||'network')}
 }
 const state=delivered?'sent':attempted?'failed':'no_subscription';
 await env.DB.prepare(`UPDATE affairs_attendance_reminders SET attempted=?,delivered=?,state=?,updated_at=CURRENT_TIMESTAMP
  WHERE id=?`).bind(attempted,delivered,state,reminderId).run();
 return {room:room.label,state,attempted,delivered};
}
export async function sendScheduledAttendanceReminders(env){
 if(!env.DB)return {state:'no_database'};
 const setting=await settings(env),day=bangkokToday();
 if(!setting.auto_enabled||!String(setting.weekdays||'').split(',').includes(String(weekday(day))))
  return {state:'disabled_or_non_school_day'};
 if(timeBangkok()<setting.reminder_time)return {state:'not_due'};
 const skipped=await env.DB.prepare('SELECT school_date FROM affairs_non_school_days WHERE school_date=?').bind(day).first();
 if(skipped)return {state:'closed_school_day'};
 const rows=(await roomRows(env,day)).filter(x=>x.missing>0&&(x.advisor_user_id||x.advisor2_user_id));
 // Each 5-min scheduled trigger processes a bounded group; remaining rooms continue on next trigger.
 const pending=[];
 for(const room of rows){
  const prior=await env.DB.prepare(`SELECT id FROM affairs_attendance_reminders
   WHERE classroom_id=? AND school_date=? AND kind='auto'`).bind(room.id,day).first();
  if(!prior)pending.push(room);
  if(pending.length>=8)break;
 }
 const outcomes=await Promise.all(pending.map(room=>notifyOne(env,room,day,'auto')));
 return {state:'processed',count:outcomes.length,outcomes};
}
export async function studentAffairsRoutes(req,env,u,path){
 const method=req.method;const url=new URL(req.url),q=url.searchParams;
 const ordinaryBehavior=(method==='GET'&&['/api/affairs/behavior/rules','/api/affairs/behavior/students','/api/affairs/behavior/approved-adjustments','/api/affairs/behavior/monitor/summary','/api/affairs/behavior/monitor/history'].includes(path))||
  (method==='POST'&&['/api/affairs/behavior/record','/api/affairs/behavior/record/bulk','/api/affairs/behavior/import/preview','/api/affairs/behavior/import/commit','/api/affairs/behavior/adjust','/api/affairs/behavior/adjust/preview','/api/affairs/behavior/adjust/bulk'].includes(path));
 if(!staff(u)&&!(['teacher','admin'].includes(u.role)&&ordinaryBehavior))
  fail(403,'เฉพาะครูที่ได้รับมอบหมายสิทธิ์ฝ่ายกิจการนักเรียน');
 let b=null;
 if(method==='POST'){
  const raw=await req.text();if(raw.length>10000)fail(413,'ข้อมูลมีขนาดใหญ่เกินไป');
  try{b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw Error()}catch{fail(400,'รูปแบบข้อมูลไม่ถูกต้อง')}
 }
 if(method==='GET'&&path==='/api/affairs/attendance'){
  const date=checkedDate(q.get('date')||bangkokToday()),items=await roomRows(env,date);
  const {results:reminders}=await env.DB.prepare(`SELECT r.classroom_id,r.kind,r.state,r.attempted,r.delivered,r.created_at
   FROM affairs_attendance_reminders r WHERE r.school_date=? ORDER BY r.id DESC`).bind(date).all();
  return reply({date,items,reminders,setting:await settings(env),
   summary:{rooms:items.filter(x=>x.students>0).length,complete:items.filter(x=>x.complete).length,
    pending:items.filter(x=>x.students>0&&!x.complete).length}});
 }
 if(method==='GET'&&path==='/api/affairs/people')return reply(await roster(env));
 if(method==='GET'&&path==='/api/affairs/behavior/students')return searchBehaviorStudents(req,env,u);
 if(method==='GET'&&path==='/api/affairs/behavior/monitor/summary')return schoolScoreMonitorSummary(env,u);
 if(method==='GET'&&path==='/api/affairs/behavior/monitor/history')return schoolScoreMonitorHistory(req,env,u);
 if(method==='GET'&&path==='/api/affairs/students'){
  const query=string(q.get('query'),70);
  if(query.length<2)fail(400,'ค้นหาชื่อหรือรหัสนักเรียนอย่างน้อย 2 ตัวอักษร');
  const pattern='%'+query.replace(/[\\%_]/g,m=>'\\'+m)+'%';
  const {results}=await env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,c.label AS classroom_label,
   c.grade FROM students s JOIN classrooms c ON c.id=s.classroom_id
   WHERE s.active=1 AND (s.student_no LIKE ? ESCAPE '\\' OR s.full_name LIKE ? ESCAPE '\\')
   ORDER BY c.grade,c.room,s.roll_no LIMIT 35`).bind(pattern,pattern).all();
  return reply({items:results});
 }
 if(method==='POST'&&path==='/api/affairs/advisor'){
  const room=id(b.classroom_id);
  const first=b.teacher_user_id===null?null:id(b.teacher_user_id);
  const second=b.teacher2_user_id===undefined?undefined:b.teacher2_user_id===null?null:id(b.teacher2_user_id);
  if(!room||b.teacher_user_id!==null&&!first||
   b.teacher2_user_id!==undefined&&b.teacher2_user_id!==null&&!second||
   first&&second&&first===second||second&&!first)
   fail(400,'เลือกครูที่ปรึกษาได้ 1 หรือ 2 คน ห้ามซ้ำกัน');
  const ids=[first,second].filter(Number.isSafeInteger);
  if(ids.length){
   const check=await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE id IN ("+ids.map(()=>'?').join(',')+") AND role IN ('teacher','staff') AND active=1").bind(...ids).first();
   if(Number(check?.n)!==ids.length)fail(400,'ต้องเป็นบัญชีครูที่ใช้งานอยู่');
  }
  const both=second!==undefined;
  const sql=both?'UPDATE classrooms SET advisor_user_id=?,advisor2_user_id=? WHERE id=?':
   'UPDATE classrooms SET advisor_user_id=? WHERE id=?';
  const change=await env.DB.prepare(sql).bind(...(both?[first,second,room]:[first,room])).run();
  if(!change.meta.changes)fail(404,'ไม่พบห้องเรียน');
  await log(env.DB,u.id,'affairs_advisor_assigned','classrooms',room);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/affairs/heads'){
  const grade=Number(b.grade),teacher=b.teacher_user_id===null?null:id(b.teacher_user_id);
  if(!Number.isInteger(grade)||grade<1||grade>6||!(teacher||b.teacher_user_id===null))
   fail(400,'ระดับชั้นหรือครูไม่ถูกต้อง');
  if(teacher){
   const check=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND active=1").bind(teacher).first();
   if(!check)fail(400,'หัวหน้าระดับต้องเป็นครูที่เปิดใช้งาน');
   await env.DB.prepare(`INSERT INTO affairs_grade_heads(grade,teacher_user_id,updated_by)
    VALUES(?,?,?) ON CONFLICT(grade) DO UPDATE SET teacher_user_id=excluded.teacher_user_id,
    updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(grade,teacher,u.id).run();
  }else await env.DB.prepare('DELETE FROM affairs_grade_heads WHERE grade=?').bind(grade).run();
  await log(env.DB,u.id,'affairs_grade_head_assigned','affairs_grade_heads',grade);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/affairs/settings'){
  const enabled=b.auto_enabled===true||b.auto_enabled===1;
  const time=String(b.reminder_time||'');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail(400,'เวลาต้องอยู่ในรูปแบบ HH:MM');
  const weekdays=Array.isArray(b.weekdays)?[...new Set(b.weekdays.map(Number))].sort((a,b)=>a-b):[];
  if(!weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))
   fail(400,'เลือกวันที่อนุญาตให้แจ้งเตือนอย่างน้อยหนึ่งวัน');
  await env.DB.prepare(`UPDATE affairs_settings SET auto_enabled=?,reminder_time=?,weekdays=?,
   updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
   .bind(enabled?1:0,time,weekdays.join(','),u.id).run();
  await log(env.DB,u.id,'affairs_reminder_settings','affairs_settings',1);
  return reply({ok:true,setting:await settings(env)});
 }
 if(method==='GET'&&path==='/api/affairs/closed-days'){
  const {results}=await env.DB.prepare('SELECT school_date,label FROM affairs_non_school_days ORDER BY school_date DESC LIMIT 120').all();
  return reply({items:results});
 }
 if(method==='POST'&&path==='/api/affairs/closed-days/remove'){
  const date=b.date;
  if(!validDate(date))fail(400,'วันที่ไม่ถูกต้อง');
  await env.DB.prepare('DELETE FROM affairs_non_school_days WHERE school_date=?').bind(date).run();
  await log(env.DB,u.id,'affairs_non_school_day_removed','affairs_non_school_days',date);
  return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/affairs/closed-days'){
  const date=b.date;
  if(!validDate(date)||date<bangkokToday()&&Date.parse(date+'T00:00:00Z')<Date.now()-365*86400000)
   fail(400,'วันที่ปิดเรียนต้องถูกต้อง');
  const label=text(b.label,100);
  await env.DB.prepare(`INSERT INTO affairs_non_school_days(school_date,label,created_by)
   VALUES(?,?,?) ON CONFLICT(school_date) DO UPDATE SET label=excluded.label,created_by=excluded.created_by`)
   .bind(date,label,u.id).run();
  await log(env.DB,u.id,'affairs_non_school_day','affairs_non_school_days',date);return reply({ok:true});
 }
 if(method==='POST'&&path==='/api/affairs/remind'){
  const date=bangkokToday(),roomId=id(b.classroom_id);
  if(!roomId)fail(400,'กรุณาเลือกห้องเรียน');
  const room=(await roomRows(env,date)).find(x=>x.id===roomId);
  if(!room)fail(404,'ไม่พบห้องเรียน');
  const outcome=await notifyOne(env,room,date,'manual',u.id);
  await log(env.DB,u.id,'affairs_attendance_reminder','classrooms',roomId);
  return reply({ok:true,...outcome});
 }
 if(method==='GET'&&path==='/api/affairs/behavior/rules'){
  const {results}=await env.DB.prepare(`SELECT id,name,category,points,active,updated_at,
     CASE WHEN id=(SELECT rule_id FROM truancy_score_policy WHERE id=1) THEN 1 ELSE 0 END AS automatic
    FROM affairs_behavior_rules ${staff(u)?'':'WHERE active=1'} ORDER BY category,id`).all();
  return reply({items:results,category_labels:label});
 }
 if(method==='POST'&&path==='/api/affairs/behavior/rules'){
  const ruleId=b.id===null||b.id===undefined?null:id(b.id);
  if(ruleId){
   const protectedRule=await env.DB.prepare('SELECT 1 AS protected FROM truancy_score_policy WHERE rule_id=?').bind(ruleId).first();
   if(protectedRule)fail(409,'เกณฑ์หนีเรียน -10 ทำงานอัตโนมัติ แก้ไขจากเมนูนี้ไม่ได้');
  }
  const name=text(b.name,120),category=String(b.category||''),points=Number(b.points),active=b.active!==false;
  if(!categories.includes(category)||!Number.isInteger(points)||Math.abs(points)>50||points===0||
    (category==='good'&&points<0)||(category!=='good'&&points>0))
   fail(400,'ประเภทหรือค่าคะแนนไม่ถูกต้อง (1–50 คะแนนตามประเภท)');
  let key=ruleId;
  if(ruleId){
   const result=await env.DB.prepare(`UPDATE affairs_behavior_rules SET name=?,category=?,points=?,active=?,
    updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,category,points,active?1:0,u.id,ruleId).run();
   if(!result.meta.changes)fail(404,'ไม่พบเกณฑ์คะแนน');
  }else{
   const res=await env.DB.prepare(`INSERT INTO affairs_behavior_rules(name,category,points,active,updated_by)
    VALUES(?,?,?,?,?)`).bind(name,category,points,active?1:0,u.id).run();key=res.meta.last_row_id;
  }
  await log(env.DB,u.id,'affairs_behavior_rule','affairs_behavior_rules',key);
  return reply({ok:true,id:key});
 }
 if(method==='GET'&&path==='/api/affairs/behavior/approved-adjustments'){
  const {results}=await env.DB.prepare(`SELECT id,name,points FROM affairs_adjustment_rules
   WHERE active=1 ORDER BY points,id`).all();
  return reply({items:results});
 }
 if(method==='GET'&&path==='/api/affairs/behavior/adjustment-rules'){
  const {results}=await env.DB.prepare(`SELECT id,name,points,active,updated_at
   FROM affairs_adjustment_rules ORDER BY id`).all();
  return reply({items:results});
 }
 if(method==='POST'&&path==='/api/affairs/behavior/adjustment-rules'){
  const key=b.id===null||b.id===undefined?null:id(b.id);
  const name=text(b.name,120),points=Number(b.points),active=b.active!==false;
  if(!Number.isInteger(points)||points<1||points>50)fail(400,'คะแนนปรับพฤติกรรมต้องเป็นจำนวนเต็ม 1–50');
  let updated=key;
  if(key){
   const x=await env.DB.prepare(`UPDATE affairs_adjustment_rules
    SET name=?,points=?,active=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(name,points,active?1:0,u.id,key).run();
   if(!x.meta.changes)fail(404,'ไม่พบเกณฑ์ปรับพฤติกรรม');
  }else{
   const x=await env.DB.prepare(`INSERT INTO affairs_adjustment_rules
    (name,points,active,updated_by) VALUES(?,?,?,?)`)
    .bind(name,points,active?1:0,u.id).run();updated=x.meta.last_row_id;
  }
  await log(env.DB,u.id,'affairs_adjustment_rule','affairs_adjustment_rules',updated);
  return reply({ok:true,id:updated});
 }
 if(method==='POST'&&path==='/api/affairs/behavior/record')return recordBehavior(env,u,b);
 if(method==='POST'&&(path==='/api/affairs/behavior/import/preview'||path==='/api/affairs/behavior/import/commit'))return scoreImportRoutes(env,u,path,b);
 if(method==='POST'&&path==='/api/affairs/behavior/record/bulk')return recordBehaviorBulk(env,u,b);
 if(method==='POST'&&path==='/api/affairs/behavior/adjust')return recordBehavior(env,u,b,true);
 if(method==='POST'&&path==='/api/affairs/behavior/adjust/preview')return reply(await previewBehaviorAdjustments(env,u,b));
 if(method==='POST'&&path==='/api/affairs/behavior/adjust/bulk')return recordBehaviorAdjustmentBulk(env,u,b);
 if(method==='GET'&&path==='/api/affairs/behavior/summary'){
  const date=q.get('date')||bangkokToday();checkedDate(date);
  const {results}=await env.DB.prepare(`SELECT c.grade,c.label AS classroom_label,s.id AS student_id,
   s.student_no,s.full_name,${scoreColumns('b')},
   COUNT(b.id) AS events FROM students s JOIN classrooms c ON c.id=s.classroom_id
   LEFT JOIN behavior_records b ON b.student_id=s.id AND b.deleted_at IS NULL AND substr(b.created_at,1,10)<=?
   WHERE s.active=1 GROUP BY s.id ORDER BY c.grade,c.room,s.roll_no`).bind(date).all();
  return reply({date,items:results.map(r=>({...r,...scoreSummary(r)}))});
 }
 if(method==='GET'&&path==='/api/affairs/cases'){
  const student=id(q.get('student_id'));
  if(!student)fail(400,'กรุณาเลือกนักเรียน');
  const {results}=await env.DB.prepare(`SELECT d.*,u.display_name AS recorder_name FROM affairs_disciplinary_cases d
   JOIN users u ON u.id=d.recorded_by WHERE d.student_id=? ORDER BY d.id DESC LIMIT 100`).bind(student).all();
  return reply({items:results});
 }
 if(method==='POST'&&path==='/api/affairs/cases'){
  const student=id(b.student_id),date=checkedDate(b.school_date);
  if(!student||!['reprimand','probation'].includes(b.measure))fail(400,'นักเรียนหรือมาตรการไม่ถูกต้อง');
  const found=await env.DB.prepare('SELECT id FROM students WHERE id=? AND active=1').bind(student).first();
  if(!found)fail(404,'ไม่พบนักเรียน');
  const details=text(b.details,2000),conditions=string(b.conditions,2000);
  const informed=b.guardian_informed_date?checkedDate(b.guardian_informed_date):null;
  const ack=b.guardian_ack_date?checkedDate(b.guardian_ack_date):null;
  if(ack&&!informed)fail(400,'ต้องบันทึกวันที่แจ้งผู้ปกครองก่อนวันที่รับทราบ');
  if(informed&&ack&&ack<informed)fail(400,'วันที่ผู้ปกครองรับทราบต้องไม่น้อยกว่าวันที่แจ้ง');
  const res=await env.DB.prepare(`INSERT INTO affairs_disciplinary_cases
   (student_id,measure,school_date,details,conditions,recorded_by,guardian_informed_date,guardian_ack_date)
   VALUES(?,?,?,?,?,?,?,?)`).bind(student,b.measure,date,details,conditions,u.id,informed,ack).run();
  await log(env.DB,u.id,'affairs_disciplinary_case','affairs_disciplinary_cases',res.meta.last_row_id);
  return reply({ok:true,id:res.meta.last_row_id},201);
 }
 const caseMatch=/^\/api\/affairs\/cases\/(\d+)\/review$/.exec(path);
 if(method==='POST'&&caseMatch){
  const caseId=id(caseMatch[1]),state=b.state;
  if(!['active','resolved','cancelled'].includes(state))fail(400,'สถานะไม่ถูกต้อง');
  const resolution=string(b.resolution,1000);
  const informed=b.guardian_informed_date?checkedDate(b.guardian_informed_date):null;
  const ack=b.guardian_ack_date?checkedDate(b.guardian_ack_date):null;
  const previous=await env.DB.prepare('SELECT guardian_informed_date FROM affairs_disciplinary_cases WHERE id=?')
   .bind(caseId).first();
  if(!previous)fail(404,'ไม่พบการบันทึกมาตรการ');
  if(ack&&!informed&&!previous.guardian_informed_date)fail(400,'กรุณาระบุวันที่แจ้งผู้ปกครอง');
  if(ack&&ack<(informed||previous.guardian_informed_date))fail(400,'วันที่รับทราบต้องไม่ก่อนวันที่แจ้ง');
  const changed=await env.DB.prepare(`UPDATE affairs_disciplinary_cases SET state=?,resolution=?,
   guardian_informed_date=COALESCE(?,guardian_informed_date),
   guardian_ack_date=COALESCE(?,guardian_ack_date),
   reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
   .bind(state,resolution,informed,ack,u.id,caseId).run();
  if(!changed.meta.changes)fail(404,'ไม่พบการบันทึกมาตรการ');
  await log(env.DB,u.id,'affairs_case_reviewed','affairs_disciplinary_cases',caseId);
  return reply({ok:true});
 }
 fail(404,'ไม่พบ API');
}
