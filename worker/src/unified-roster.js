import {validateStudentInput} from './admin-validation.js';
import {validUsername,bangkokToday} from './core.js';
import {passwordHash} from './password.js';

const hex=n=>[...crypto.getRandomValues(new Uint8Array(n))].map(x=>x.toString(16).padStart(2,'0')).join('');
const fail=(status,message)=>{throw Object.assign(new Error(message),{code:status})};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{
 'content-type':'application/json;charset=utf-8','cache-control':'no-store'
}});
const clean=v=>typeof v==='string'?v.trim():'';
const key=v=>clean(v).toLocaleLowerCase();
const isBlank=v=>v===undefined||v===null||v==='';

function validateRow(raw,roomId){
 const s=validateStudentInput({...raw,classroom_id:roomId,active:1});
 const username=key(raw.username),password=isBlank(raw.password)?'':raw.password;
 if(username&&!validUsername(username))throw Error('Username ต้องมี 3–40 ตัวอักษร ใช้อังกฤษ ตัวเลข จุด ขีด');
 if(typeof password!=='string'||(password&&(password.length<4||password.length>128||
  /[\u0000-\u001f\u007f]/.test(password)||/^\d{13}$/.test(password))))
  throw Error('Password ต้องมี 4–128 ตัวอักษร และห้ามใช้เลขประจำตัวประชาชน');
 return {...s,username,password};
}

export function planUnifiedRoster(rows,roomMap,existingStudents=[],existingAccounts=[]){
 const ids=new Set(),usernames=new Set(),rolls=new Set();
 const studentByNo=new Map(existingStudents.map(x=>[key(x.student_no),x]));
 const takenRolls=new Map(existingStudents.map(x=>[x.classroom_id+':'+x.roll_no,x]));
 const accountsByStudent=new Map(existingAccounts.filter(x=>x.role==='student'&&x.student_id)
  .map(x=>[Number(x.student_id),x]));
 const accountsByUsername=new Map(existingAccounts.map(x=>[key(x.username),x]));
 const items=rows.map((raw,index)=>{
  const line=Number.isSafeInteger(raw?.source_row)&&raw.source_row>0?raw.source_row:index+2;
  const roomLabel=clean(raw?.classroom),roomId=roomMap.get(roomLabel);
  let student=null,message='',status='ready',existingId=null,accountAction='none';
  if(!roomId)message='ไม่พบห้องเรียน '+roomLabel;
  else try{student=validateRow(raw,roomId)}catch(e){message=e.message}
  if(student){
   const id=key(student.student_no),roll=roomId+':'+student.roll_no;
   const current=studentByNo.get(id),occupied=takenRolls.get(roll);
   existingId=current?.id??null;
   if(ids.has(id))message ||= 'รหัสนักเรียนซ้ำภายในไฟล์ (ข้ามแถวที่ซ้ำ)';
   if(rolls.has(roll))message ||= 'เลขที่ซ้ำในห้องเดียวกันภายในไฟล์';
   if(current?.deleted_at)message ||= 'นักเรียนนี้ถูกเก็บเป็นประวัติแล้ว ต้องตรวจสอบทะเบียนก่อนคืนสถานะ';
   else if(current&&Number(current.classroom_id)!==Number(roomId))
    message ||= 'นักเรียนอยู่คนละห้อง โปรดย้ายห้องผ่านเมนูทะเบียนเพื่อรักษาประวัติเช็กชื่อ';
   if(occupied&&key(occupied.student_no)!==id)
    message ||= 'เลขที่นี้มีนักเรียนอื่นใช้อยู่แล้วในห้อง';
   const existingAccount=current?accountsByStudent.get(Number(current.id)):null;
   const login=student.username||(existingAccount?.username||'');
   if(student.password&&!login){
    if(!validUsername(id))message ||= 'ต้องกำหนด Username เมื่อสร้างบัญชี';
   }
   const finalUsername=student.username||existingAccount?.username||(student.password?id:'');
   if(finalUsername){
    if(!validUsername(finalUsername))message ||= 'Username ไม่ถูกต้อง';
    const accountOwner=accountsByUsername.get(key(finalUsername));
    if(accountOwner&&Number(accountOwner.student_id)!==Number(current?.id))
     message ||= 'Username มีบัญชีของบุคคลอื่นอยู่แล้ว';
    if(usernames.has(key(finalUsername)))message ||= 'Username ซ้ำภายในไฟล์';
   }
   if(!message){
    if(existingAccount)accountAction=student.username||student.password?'update':'none';
    else if(finalUsername&&student.password)accountAction='create';
    else if(finalUsername&&!student.password)message='บัญชีใหม่ต้องมี Password ในไฟล์';
   }
   // Never reserve identifiers or rolls for a rejected row. Later valid rows survive.
   if(!message){
    ids.add(id);rolls.add(roll);
    if(finalUsername)usernames.add(key(finalUsername));
    status=current?'update':'ready';
   }
  }
  if(message)status='error';
  return {source_row:line,room:roomLabel,student_no:clean(raw?.student_no),
   full_name:clean(raw?.full_name),username:clean(raw?.username).toLowerCase(),
   roll_no:Number(raw?.roll_no),existing_id:existingId,account_action:accountAction,
   status,message};
 });
 return {ready:items.every(x=>x.status!=='error'),valid:items.filter(x=>x.status!=='error').length,
  added:items.filter(x=>x.status==='ready').length,
  updated:items.filter(x=>x.status==='update').length,
  skipped:items.filter(x=>x.status==='error').length,
  errors:items.filter(x=>x.status==='error').length,items};
}

async function body(req){
 const raw=await req.text();
 if(raw.length>150000)fail(413,'ข้อมูลแต่ละชุดใหญ่เกินไป');
 let data;try{data=JSON.parse(raw)}catch{fail(400,'รูปแบบไฟล์ไม่ถูกต้อง')}
 if(!data||!Array.isArray(data.students))fail(400,'ไม่มีรายชื่อนักเรียน');
 return data;
}
function sqlPlaceholders(values){return values.map(()=>'?').join(',')}
async function gather(env,rows){
 const roomNames=[...new Set(rows.map(x=>clean(x?.classroom)).filter(Boolean))];
 const rooms=roomNames.length?(await env.DB.prepare('SELECT id,label FROM classrooms WHERE label IN ('+
  sqlPlaceholders(roomNames)+')').bind(...roomNames).all()).results:[];
 const roomMap=new Map(rooms.map(x=>[x.label,x.id]));
 const ids=[...new Set(rows.map(x=>key(x?.student_no)).filter(x=>x.length>0&&x.length<=40))];
 const checks=[];
 if(ids.length)checks.push(env.DB.prepare('SELECT id,student_no,classroom_id,roll_no,deleted_at FROM students WHERE lower(student_no) IN ('+
  sqlPlaceholders(ids)+')').bind(...ids));
 for(const room of rooms){
  const rolls=[...new Set(rows.filter(x=>roomMap.get(clean(x.classroom))===room.id).map(x=>Number(x.roll_no))
   .filter(x=>Number.isInteger(x)&&x>0&&x<=100))];
  if(rolls.length)checks.push(env.DB.prepare('SELECT id,student_no,classroom_id,roll_no,deleted_at FROM students WHERE classroom_id=? AND roll_no IN ('+
   sqlPlaceholders(rolls)+')').bind(room.id,...rolls));
 }
 const checked=checks.length?await env.DB.batch(checks):[];
 const students=[...new Map(checked.flatMap(x=>x.results||[]).map(x=>[Number(x.id),x])).values()];
 const names=[...new Set(rows.map(x=>key(x?.username)).filter(x=>x.length>0&&x.length<=40))];
 const studentIds=[...new Set(students.map(x=>x.id))];
 const conditions=[],params=[];
 if(names.length){conditions.push('lower(username) IN ('+sqlPlaceholders(names)+')');params.push(...names)}
 if(studentIds.length){conditions.push('student_id IN ('+sqlPlaceholders(studentIds)+')');params.push(...studentIds)}
 const accounts=conditions.length?(await env.DB.prepare('SELECT id,username,role,student_id FROM portal_accounts WHERE '+
  conditions.join(' OR ')).bind(...params).all()).results:[];
 return {roomMap,students,accounts};
}
function sqlStatus(message){return /UNIQUE|constraint|TIMETABLE_OVERLAP/i.test(String(message||''))
 ?'ข้อมูลซ้ำหรือเลขที่ถูกใช้แล้ว กรุณาตรวจสอบข้อมูลล่าสุด': 'บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง';}
async function commitOne(env,user,raw,plan,roomId){
 const student=validateRow(raw,roomId);
 const stmts=[];
 const currentId=plan.existing_id;
 if(currentId){
  stmts.push(env.DB.prepare('UPDATE students SET full_name=?,roll_no=? WHERE id=? AND classroom_id=? AND deleted_at IS NULL')
   .bind(student.full_name,student.roll_no,currentId,roomId));
  stmts.push(env.DB.prepare('UPDATE student_enrollments SET roll_no=? WHERE student_id=? AND end_date IS NULL AND classroom_id=?')
   .bind(student.roll_no,currentId,roomId));
 }else{
  stmts.push(env.DB.prepare('INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,?,?,1)')
   .bind(student.student_no,roomId,student.roll_no,student.full_name));
  stmts.push(env.DB.prepare(`INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)
   SELECT id,?,?,?,? FROM students WHERE lower(student_no)=lower(?)`)
   .bind(roomId,student.roll_no,bangkokToday(),user.id,student.student_no));
 }
 const linkedAccount= currentId ? await env.DB.prepare('SELECT id,username FROM portal_accounts WHERE student_id=? AND role=\'student\'')
  .bind(currentId).first():null;
 if(linkedAccount){
  if(plan.account_action==='update'){
   const nextUsername=student.username||linkedAccount.username;
   if(student.password){
    const salt=hex(16),hash=await passwordHash(student.password,salt);
    stmts.push(env.DB.prepare('UPDATE portal_accounts SET username=?,display_name=?,password_salt=?,password_hash=?,must_change_password=0 WHERE id=?')
     .bind(nextUsername,student.full_name,salt,hash,linkedAccount.id));
   }else stmts.push(env.DB.prepare('UPDATE portal_accounts SET username=?,display_name=? WHERE id=?')
    .bind(nextUsername,student.full_name,linkedAccount.id));
  }else stmts.push(env.DB.prepare('UPDATE portal_accounts SET display_name=? WHERE id=?')
   .bind(student.full_name,linkedAccount.id));
 }else if(plan.account_action==='create'){
  const salt=hex(16),hash=await passwordHash(student.password,salt);
  stmts.push(env.DB.prepare(`INSERT INTO portal_accounts
   (username,display_name,role,student_id,password_salt,password_hash,must_change_password,created_by)
   SELECT ?,full_name,'student',id,?,?,0,? FROM students WHERE lower(student_no)=lower(?)`)
   .bind(student.username||student.student_no,salt,hash,user.id,student.student_no));
 }
 stmts.push(env.DB.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
  .bind(user.id,currentId?'student_import_updated':'student_import_created','students',String(currentId||student.student_no)));
 await env.DB.batch(stmts); // One student per atomic D1 batch: failure skips only that row.
}
export async function unifiedRosterEndpoint(req,env,user,path){
 if(user?.role!=='admin')fail(403,'เฉพาะ Admin');
 if(req.method!=='POST')fail(405,'Method not allowed');
 const b=await body(req),rows=b.students,commit=path.endsWith('/commit');
 if(rows.length<1||rows.length>(commit?10:100))
  fail(400,commit?'ระบบบันทึกชุดละไม่เกิน 10 คนอัตโนมัติ':'ระบบตรวจสอบชุดละไม่เกิน 100 คนอัตโนมัติ');
 const {roomMap,students,accounts}=await gather(env,rows);
 const planned=planUnifiedRoster(rows,roomMap,students,accounts);
 if(!commit)return json(planned);
 const items=[],results={added:0,updated:0,skipped:0,accounts:0};
 for(let i=0;i<rows.length;i++){
  // Recheck each row before writing, including changes made by earlier rows.
  const fresh=await gather(env,[rows[i]]);
  const plan=planUnifiedRoster([rows[i]],fresh.roomMap,fresh.students,fresh.accounts).items[0];
  plan.source_row=planned.items[i].source_row;
  if(planned.items[i].status==='error'||plan.status==='error'){
   items.push({...plan,status:'skipped',message:planned.items[i].message||plan.message});
   results.skipped++;continue;
  }
  try{
   await commitOne(env,user,rows[i],plan,fresh.roomMap.get(plan.room));
   if(plan.status==='update')results.updated++;else results.added++;
   if(plan.account_action!=='none')results.accounts++;
   items.push({...plan,status:plan.status==='update'?'updated':'imported',
    message:plan.status==='update'?'อัปเดตข้อมูลเดิมแล้ว':'เพิ่มนักเรียนแล้ว'});
  }catch(e){
   items.push({...plan,status:'skipped',message:sqlStatus(e?.message)});
   results.skipped++;
  }
 }
 return json({ok:true,imported:results.added+results.updated,...results,items},201);
}
