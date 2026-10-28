// Central admin-managed school settings. Effective cutoffs are read on every QR submission.
import {validDate} from './core.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{code:status})};
const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store'
}});
export const DEFAULT_SCHOOL_SETTINGS=Object.freeze({
 school_name:'โรงเรียนรัษฎา',academic_year:2569,semester:2,
 semester_start_date:null,semester_end_date:null,
 school_start_time:'08:00',late_cutoff_time:'08:00',
 first_period_start_time:'08:30',period_duration_minutes:50
});
const keys=Object.keys(DEFAULT_SCHOOL_SETTINGS);
const timePattern=/^([01]\d|2[0-3]):[0-5]\d$/;
export function validateSchoolSettings(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))
  fail(400,'ข้อมูลตั้งค่าระบบไม่ถูกต้อง');
 if(Object.keys(body).length!==keys.length)fail(400,'กรุณาส่งข้อมูลตั้งค่าครบทุกช่อง');
 const name=typeof body.school_name==='string'?body.school_name.trim():'';
 if(name.length<2||name.length>100||/[\u0000-\u001f\u007f<>]/.test(name))
  fail(400,'ชื่อโรงเรียนต้องมีความยาว 2–100 ตัวอักษร');
 const year=Number(body.academic_year);
 if(!Number.isInteger(year)||year<2500||year>2700||String(body.academic_year).trim()!==String(year))
  fail(400,'ปีการศึกษาไม่ถูกต้อง (พ.ศ. 2500–2700)');
 const semester=Number(body.semester);
 if(![1,2].includes(semester)||String(body.semester).trim()!==String(semester))
  fail(400,'ภาคเรียนต้องเป็น 1 หรือ 2');
 const start=body.semester_start_date||null,end=body.semester_end_date||null;
 if(start!==null&&!validDate(start)||end!==null&&!validDate(end))
  fail(400,'วันที่เริ่มหรือสิ้นสุดภาคเรียนไม่ถูกต้อง');
 if((start&&!end)||(!start&&end)||start&&end&&start>end)
  fail(400,'ต้องกำหนดวันเริ่มและสิ้นสุดภาคเรียนให้ครบ และวันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
 const schoolStart=body.school_start_time,cutoff=body.late_cutoff_time;
 const firstPeriod=body.first_period_start_time,duration=body.period_duration_minutes;
 if(typeof schoolStart!=='string'||typeof cutoff!=='string'||
  !timePattern.test(schoolStart)||!timePattern.test(cutoff))
  fail(400,'เวลาเรียนและเวลาเริ่มมาสายต้องเป็น HH:MM');
 if(schoolStart<'05:00'||schoolStart>'12:00'||cutoff<'05:00'||cutoff>'12:00'||cutoff<schoolStart)
  fail(400,'เวลาเริ่มมาสายต้องไม่น้อยกว่าเวลาเริ่มเรียน และอยู่ระหว่าง 05:00–12:00 น.');
 if(typeof firstPeriod!=='string'||!timePattern.test(firstPeriod)||firstPeriod<'05:00'||firstPeriod>'18:00')
  fail(400,'เวลาเริ่มคาบที่ 1 ต้องเป็นเวลาระหว่าง 05:00–18:00 น.');
 if(![40,45,50].includes(duration))
  fail(400,'เวลาเรียนหนึ่งคาบต้องเลือก 50, 45 หรือ 40 นาทีเท่านั้น');
 const [h,m]=firstPeriod.split(':').map(Number);
 if(h*60+m+10*duration>24*60)fail(400,'ระยะเวลาคาบเรียนทั้งวันเกินเวลา 24:00 น.');
 return {school_name:name,academic_year:year,semester,
  semester_start_date:start,semester_end_date:end,
  school_start_time:schoolStart,late_cutoff_time:cutoff,
  first_period_start_time:firstPeriod,period_duration_minutes:duration};
}
export async function getSchoolSettings(env){
 const result=await env.DB.prepare(
  `SELECT school_name,academic_year,semester,semester_start_date,semester_end_date,
   school_start_time,late_cutoff_time,first_period_start_time,period_duration_minutes,
   updated_by,updated_at FROM school_settings WHERE id=1`
 ).first();
 return result?{...DEFAULT_SCHOOL_SETTINGS,...result}:DEFAULT_SCHOOL_SETTINGS;
}
export async function getLateCutoffTime(env){
 const record=await env.DB.prepare('SELECT late_cutoff_time FROM school_settings WHERE id=1').first();
 return record?.late_cutoff_time||DEFAULT_SCHOOL_SETTINGS.late_cutoff_time;
}
export async function schoolSettingsRoutes(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบโรงเรียนเท่านั้น');
 if(path!=='/api/admin/school-settings')fail(404,'ไม่พบเมนูตั้งค่าโรงเรียน');
 if(req.method==='GET'){
  const settings=await getSchoolSettings(env);
  const {results}=await env.DB.prepare(`SELECT h.id,h.created_at,h.previous_value,h.next_value,u.display_name AS actor_name
   FROM school_settings_history h JOIN users u ON u.id=h.actor_id
   ORDER BY h.id DESC LIMIT 20`).all();
  return reply({settings,history:(results||[]).map(item=>({
   id:item.id,created_at:item.created_at,actor_name:item.actor_name,
   previous:JSON.parse(item.previous_value),next:JSON.parse(item.next_value)
  }))});
 }
 if(req.method!=='POST')fail(405,'ไม่รองรับคำขอนี้');
 const raw=await req.text();
 if(raw.length>6000)fail(413,'ข้อมูลตั้งค่ายาวเกินไป');
 let b;try{b=JSON.parse(raw)}catch{fail(400,'ข้อมูลตั้งค่าไม่ถูกต้อง')}
 const next=validateSchoolSettings(b);
 const previous=await getSchoolSettings(env);
 const oldValue=Object.fromEntries(keys.map(key=>[key,previous[key]]));
 const changed=keys.some(key=>oldValue[key]!==next[key]);
 if(!changed)return reply({ok:true,unchanged:true,settings:previous});
 await env.DB.batch([
  env.DB.prepare(`UPDATE school_settings SET school_name=?,academic_year=?,semester=?,
   semester_start_date=?,semester_end_date=?,school_start_time=?,late_cutoff_time=?,
   first_period_start_time=?,period_duration_minutes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
    .bind(next.school_name,next.academic_year,next.semester,next.semester_start_date,
     next.semester_end_date,next.school_start_time,next.late_cutoff_time,
     next.first_period_start_time,next.period_duration_minutes,user.id),
  env.DB.prepare(`INSERT INTO school_settings_history(actor_id,previous_value,next_value)
   VALUES(?,?,?)`).bind(user.id,JSON.stringify(oldValue),JSON.stringify(next)),
  env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
   VALUES(?,'school_settings_updated','school_settings','1')`).bind(user.id)
 ]);
 return reply({ok:true,settings:await getSchoolSettings(env)});
}
