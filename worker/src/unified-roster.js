import {validateStudentInput} from './admin-validation.js';
import {validUsername,bangkokToday} from './core.js';
import {passwordHash} from './password.js';

const hex=bytes=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const fail=(status,message)=>{throw Object.assign(new Error(message),{code:status})};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const clean=v=>typeof v==='string'?v.trim():'';
function validateRow(raw,roomId){
 const s=validateStudentInput({...raw,classroom_id:roomId,active:1});
 const username=clean(raw.username).toLowerCase();
 const password=raw.password;
 if(!validUsername(username))throw Error('Username ต้องมี 3–40 ตัวอักษร ใช้อังกฤษ ตัวเลข จุด ขีด');
 if(typeof password!=='string'||password.length<4||password.length>128||/[\u0000-\u001f\u007f]/.test(password))
  throw Error('Password ต้องมี 4–128 ตัวอักษร');
 if(/^\d{13}$/.test(password))throw Error('ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน');
 return {...s,username};
}
export function planUnifiedRoster(rows,roomMap,existingStudents=[],existingAccounts=[]){
 const ids=new Set(),usernames=new Set(),rolls=new Set();
 const occupiedIds=new Set(existingStudents.map(s=>String(s.student_no).toLowerCase()));
 const occupiedRolls=new Set(existingStudents.map(s=>s.classroom_id+':'+s.roll_no));
 const occupiedUsernames=new Set(existingAccounts.map(s=>String(s.username).toLowerCase()));
 const items=rows.map((raw,index)=>{
  const line=Number.isSafeInteger(raw?.source_row)&&raw.source_row>0?raw.source_row:index+2;
  const roomLabel=clean(raw.classroom);
  const roomId=roomMap.get(roomLabel);
  let student=null,message='';
  if(!roomId)message='ไม่พบห้องเรียน '+roomLabel;
  else try{student=validateRow(raw,roomId)}catch(e){message=e.message}
  if(student){
   const id=student.student_no.toLowerCase(),uname=student.username,roll=roomId+':'+student.roll_no;
   if(ids.has(id))message||='รหัสนักเรียนซ้ำภายในไฟล์';
   if(usernames.has(uname))message||='Username ซ้ำภายในไฟล์';
   if(rolls.has(roll))message||='เลขที่ซ้ำในห้องเดียวกันภายในไฟล์';
   if(occupiedIds.has(id))message||='รหัสนักเรียนนี้มีอยู่แล้วในระบบ';
   if(occupiedUsernames.has(uname))message||='Username มีบัญชีอยู่แล้ว';
   if(occupiedRolls.has(roll))message||='เลขที่นี้มีอยู่แล้วในห้อง';
   ids.add(id);usernames.add(uname);rolls.add(roll);
  }
  return {source_row:line,room:roomLabel,student_no:clean(raw?.student_no),
   full_name:clean(raw?.full_name),username:clean(raw?.username).toLowerCase(),
   roll_no:Number(raw?.roll_no),status:message?'error':'ready',message};
 });
 return {ready:items.every(x=>x.status==='ready'),valid:items.filter(x=>x.status==='ready').length,
  errors:items.filter(x=>x.status==='error').length,items};
}
async function body(req){
 const str=await req.text();
 if(str.length>150000)fail(413,'ข้อมูลแต่ละชุดใหญ่เกินไป');
 let data;try{data=JSON.parse(str)}catch{fail(400,'รูปแบบไฟล์ไม่ถูกต้อง')}
 if(!data||!Array.isArray(data.students))fail(400,'ไม่มีรายชื่อนักเรียน');
 return data;
}
export async function unifiedRosterEndpoint(req,env,user,path){
 if(user.role!=='admin')fail(403,'เฉพาะ Admin');
 if(req.method!=='POST')fail(405,'Method not allowed');
 const b=await body(req),rows=b.students;
 const commit=path.endsWith('/commit');
 if(rows.length<1||rows.length>(commit?10:100))
  fail(400,commit?'ระบบบันทึกชุดละไม่เกิน 10 คนอัตโนมัติ':'ระบบตรวจสอบชุดละไม่เกิน 100 คนอัตโนมัติ');
 const roomNames=[...new Set(rows.map(x=>clean(x?.classroom)))];
 const roomResult=await env.DB.prepare('SELECT id,label FROM classrooms WHERE label IN ('+roomNames.map(()=>'?').join(',')+')')
  .bind(...roomNames).all();
 const map=new Map(roomResult.results.map(x=>[x.label,x.id]));
 const ids=[...new Set(rows.map(x=>clean(x?.student_no).toLowerCase()).filter(x=>x&&x.length<=40))];
 const names=[...new Set(rows.map(x=>clean(x?.username).toLowerCase()).filter(x=>x&&x.length<=40))];
 const checks=[];
 if(ids.length)checks.push(env.DB.prepare('SELECT student_no,classroom_id,roll_no FROM students WHERE lower(student_no) IN ('+ids.map(()=>'?').join(',')+')').bind(...ids));
 for(const roomId of [...new Set(roomResult.results.map(r=>r.id))]){
  const rolls=[...new Set(rows.filter(x=>map.get(clean(x.classroom))===roomId).map(x=>Number(x.roll_no)).filter(x=>Number.isInteger(x)&&x>0&&x<=100))];
  if(rolls.length)checks.push(env.DB.prepare('SELECT student_no,classroom_id,roll_no FROM students WHERE classroom_id=? AND roll_no IN ('+rolls.map(()=>'?').join(',')+')').bind(roomId,...rolls));
 }
 let existing=[];
 if(checks.length){
  const checked=await env.DB.batch(checks);
  existing=checked.flatMap(x=>x.results||[]);
 }
 const accounts=names.length?(await env.DB.prepare('SELECT username FROM portal_accounts WHERE lower(username) IN ('+names.map(()=>'?').join(',')+')').bind(...names).all()).results:[];
 const plan=planUnifiedRoster(rows,map,existing,accounts);
 if(!commit)return json(plan);
 if(!plan.ready)return json({error:'พบข้อมูลไม่ถูกต้องในชุดนี้ ไม่มีการบันทึก',...plan},409);
 const stmts=[];
 for(const [i,p] of plan.items.entries()){
  const student=validateRow(rows[i],map.get(p.room));
  stmts.push(env.DB.prepare('INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,1)')
   .bind(student.student_no,student.classroom_id,student.roll_no,student.full_name));
  stmts.push(env.DB.prepare(`INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)
    SELECT id,?,?,?,? FROM students WHERE student_no=?`)
    .bind(student.classroom_id,student.roll_no,bangkokToday(),user.id,student.student_no));
  const salt=hex(16),hash=await passwordHash(rows[i].password,salt);
  stmts.push(env.DB.prepare(`INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,created_by)
    SELECT ?,full_name,'student',id,?,?,? FROM students WHERE student_no=?`)
    .bind(student.username,salt,hash,user.id,student.student_no));
 }
 stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
  .bind(user.id,'unified_roster_import','students',String(rows.length)));
 await env.DB.batch(stmts);
 return json({ok:true,imported:rows.length,accounts:rows.length,items:plan.items.map(x=>({...x,status:'imported',message:'นำเข้าสำเร็จ'}))},201);
}
