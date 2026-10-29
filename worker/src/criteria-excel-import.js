// Imports schoolwide behavior/merit CRITERIA, not individual student scores.
// Only authorized Student Affairs staff may use this endpoint.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const reply=(data)=>new Response(JSON.stringify(data),{headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store'
}});
const clean=s=>String(s??'').trim();
const validId=n=>Number.isSafeInteger(n)&&n>0;
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const categories=new Set(['good','minor','moderate','serious','very_serious']);
const matchMode=(category,mode)=>mode==='good'?category==='good':category!=='good';
const normName=s=>s.toLocaleLowerCase('th');

export function normalizeCriteriaRows(body){
 if(!['good','behavior'].includes(body?.mode)||!Array.isArray(body.rows)||
  !body.rows.length||body.rows.length>15)
  fail(400,'กรุณานำเข้าเกณฑ์ครั้งละ 1–15 แถว และระบุหมวดให้ถูกต้อง');
 const seenRows=new Set(),seenNames=new Set(),seenIds=new Set();
 return body.rows.map((r,i)=>{
  const row_no=Number(r?.row_no);
  if(!Number.isSafeInteger(row_no)||row_no<2||row_no>100000||seenRows.has(row_no))
   fail(400,'หมายเลขแถว Excel ไม่ถูกต้องหรือซ้ำกัน');
  seenRows.add(row_no);
  const rawId=r?.rule_id;
  const input_rule_id=rawId===null||rawId===''||rawId===undefined?null:Number(rawId);
  const category=clean(r?.category).toLowerCase(),name=clean(r?.name);
  const points=r?.points===null||r?.points===''||r?.points===undefined?NaN:Number(r.points);
  const active=r?.active===1||r?.active==='1'||r?.active===true?1:
   r?.active===0||r?.active==='0'||r?.active===false?0:null;
  let error='';
  if(input_rule_id!==null&&!validId(input_rule_id))error='rule_id ต้องเป็นรหัสเกณฑ์เดิม หรือเว้นว่างเพื่อเพิ่มใหม่';
  else if(!categories.has(category)||!matchMode(category,body.mode))error='ประเภทเกณฑ์ไม่ตรงกับหน้าความผิด/ความดี';
  else if(name.length<2||name.length>120||/[\u0000-\u001f\u007f]/.test(name))error='ชื่อเกณฑ์ต้องมี 2–120 ตัวอักษร';
  else if(!Number.isSafeInteger(points)||points===0||Math.abs(points)>50||
   (category==='good'&&points<0)||(category!=='good'&&points>0))
   error='คะแนนความดีต้องเป็น +1 ถึง +50 และความผิด -1 ถึง -50';
  else if(active===null)error='active ต้องเป็น 1 (เปิดใช้งาน) หรือ 0 (ปิดใช้งาน)';
  const nameKey=category+':'+normName(name);
  if(!error&&(seenNames.has(nameKey)||(input_rule_id!==null&&seenIds.has(input_rule_id))))
   error='ชื่อเกณฑ์หรือรหัสเกณฑ์ซ้ำในชุดนี้';
  seenNames.add(nameKey);
  if(input_rule_id!==null)seenIds.add(input_rule_id);
  return {row_no,input_rule_id,category,name,points,active,error};
 });
}
async function criteriaCatalog(env){
 const {results}=await env.DB.prepare(`SELECT r.id,r.name,r.category,r.points,r.active,
  CASE WHEN r.id=(SELECT rule_id FROM truancy_score_policy WHERE id=1) THEN 1 ELSE 0 END AS automatic
  FROM affairs_behavior_rules r ORDER BY r.id`).all();
 return results||[];
}
function validateRows(rows,mode,catalog){
 const byId=new Map(catalog.map(r=>[Number(r.id),r]));
 const byName=new Map();
 for(const rule of catalog){
  const key=rule.category+':'+normName(rule.name);
  const matches=byName.get(key)||[];
  matches.push(rule);byName.set(key,matches);
 }
 return rows.map(r=>{
  const old=r.input_rule_id===null?null:byId.get(r.input_rule_id);
  const matching=byName.get(r.category+':'+normName(r.name))||[];
  let target=old||null,error=r.error||'';
  if(!error&&r.input_rule_id!==null&&!old)error='ไม่พบรหัสเกณฑ์ที่จะอัปเดต';
  if(!error&&old&&!matchMode(old.category,mode))error='ไม่อนุญาตเปลี่ยนเกณฑ์ข้ามหมวดความผิด/ความดี';
  if(!error&&old?.automatic)error='เกณฑ์หนีเรียนอัตโนมัติเป็นเกณฑ์คุ้มครอง ไม่สามารถแก้ไขผ่าน Excel';
  if(!error&&matching.length>1)error='ชื่อเกณฑ์ซ้ำในระบบ กรุณาตรวจสอบรายการเดิม';
  if(!error&&matching.some(x=>x.automatic))error='ชื่อเกณฑ์เป็นรายการหนีเรียนอัตโนมัติที่แก้ไขไม่ได้';
  if(!error&&old&&matching.length&&Number(matching[0].id)!==Number(old.id))
   error='ชื่อเกณฑ์นี้ถูกใช้กับรายการอื่น กรุณาเปลี่ยนชื่อ';
  if(!error&&!target&&matching.length)target=matching[0];
  if(!error&&target&&!matchMode(target.category,mode))error='เกณฑ์เดิมอยู่ผิดหมวด';
  return {...r,error,status:error?'error':target?'update':'create',
   target_rule_id:target?.id||null,previous_name:target?.name||'',
   previous_points:target?.points??null};
 });
}
function compareReceipt(receipt,row,mode,user){
 return Number(receipt.actor_id)===Number(user.id)&&receipt.mode===mode&&
  (receipt.input_rule_id===null?null:Number(receipt.input_rule_id))===row.input_rule_id&&
  receipt.category===row.category&&receipt.name===row.name&&
  Number(receipt.points)===row.points&&Number(receipt.active)===row.active;
}
export async function criteriaImportRoutes(env,user,path,body){
 if(!(user?.role==='admin'||user?.role==='staff'||
  (user?.role==='teacher'&&Number(user.student_affairs)===1)))
  fail(403,'เฉพาะผู้ได้รับมอบหมายงานฝ่ายกิจการนักเรียน');
 const commit=path==='/api/affairs/behavior/rules/import/commit';
 if(!commit&&path!=='/api/affairs/behavior/rules/import/preview')fail(404,'ไม่พบ API นำเข้าเกณฑ์');
 const rows=normalizeCriteriaRows(body),mode=body.mode;
 const importId=body.import_id;
 if(commit&&!uuid(importId))fail(400,'รหัสชุดนำเข้าผิดรูปแบบ');
 const prior=commit?(await env.DB.prepare(`SELECT * FROM affairs_criteria_import_receipts
  WHERE import_id=? AND row_no IN (${rows.map(()=>'?').join(',')})`)
  .bind(importId,...rows.map(r=>r.row_no)).all()).results||[]:[];
 const priorByRow=new Map(prior.map(r=>[Number(r.row_no),r]));
 // Replayed chunks are identified before checking current rules: an earlier
 // successful create has necessarily changed the catalog.
 for(const row of rows){
  const previous=priorByRow.get(row.row_no);
  if(previous&&!compareReceipt(previous,row,mode,user))
   fail(409,'ชุดนำเข้าเดิมมีเนื้อหาไม่ตรงกัน กรุณาเลือกไฟล์อีกครั้ง');
 }
 const fresh=rows.filter(r=>!priorByRow.has(r.row_no));
 const checked=validateRows(fresh,mode,await criteriaCatalog(env));
 if(!commit)return reply({items:checked});
 if(checked.some(r=>r.error))
  fail(400,'มีข้อมูลเกณฑ์ไม่ถูกต้องที่แถว '+checked.filter(r=>r.error).map(r=>r.row_no).join(', '));
 // A file may mention the same existing rule through both its ID and its
 // name; refuse so one transaction cannot overwrite another row silently.
 const targets=checked.filter(r=>r.target_rule_id).map(r=>Number(r.target_rule_id));
 if(new Set(targets).size!==targets.length)fail(400,'เกณฑ์เดิมซ้ำกันในชุดนำเข้า');
 const stmts=[];
 for(const row of checked){
  if(row.target_rule_id){
   stmts.push(env.DB.prepare(`UPDATE affairs_behavior_rules
    SET name=?,category=?,points=?,active=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND id NOT IN (SELECT rule_id FROM truancy_score_policy)`)
    .bind(row.name,row.category,row.points,row.active,user.id,row.target_rule_id));
  }else{
   stmts.push(env.DB.prepare(`INSERT INTO affairs_behavior_rules(name,category,points,active,updated_by)
    VALUES(?,?,?,?,?)`).bind(row.name,row.category,row.points,row.active,user.id));
  }
  stmts.push(env.DB.prepare(`INSERT INTO affairs_criteria_import_receipts
   (import_id,row_no,actor_id,mode,input_rule_id,rule_id,category,name,points,active)
   VALUES(?,?,?,?,?,${row.target_rule_id?'?':'last_insert_rowid()'},?,?,?,?)`)
   .bind(importId,row.row_no,user.id,mode,row.input_rule_id,
    ...(row.target_rule_id?[row.target_rule_id]:[]),
    row.category,row.name,row.points,row.active));
  stmts.push(env.DB.prepare(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
   SELECT ?,'affairs_criteria_excel_imported','affairs_behavior_rules',CAST(rule_id AS TEXT)
   FROM affairs_criteria_import_receipts WHERE import_id=? AND row_no=?`)
   .bind(user.id,importId,row.row_no));
 }
 if(stmts.length)await env.DB.batch(stmts);
 return reply({ok:true,inserted:checked.filter(r=>r.status==='create').length,
  updated:checked.filter(r=>r.status==='update').length,
  skipped:prior.length,count:rows.length});
}
