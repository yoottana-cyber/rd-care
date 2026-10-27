import {readXlsxRows} from './xlsx-reader.js';
import {readCsvFile} from './csv-encoding.js';
import {csvRows} from './unified-import.js';
import {downloadAdvisorExampleXlsx} from './template-xlsx.js';

const HEADER='classroom,full_name,username,password';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const batches=(rows,size)=>Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size));

export function prepareAdvisorRows(raw,rooms){
 if(!Array.isArray(raw)||!raw.length||raw[0].map(x=>String(x??'').trim().toLowerCase()).join(',')!==HEADER)
  throw Error('หัวตารางต้องเป็น '+HEADER);
 const labels=new Set(rooms.map(r=>r.label));
 const byRoom=new Set(),byUser=new Set();
 const rows=raw.slice(1).map((cells,index)=>{
  const values=cells.map(v=>String(v??''));
  const [classroom='',full_name='',user='',password='']=values;
  const item={classroom:classroom.trim(),full_name:full_name.trim(),username:user.trim().toLowerCase(),
   password,source_row:Number(cells.source_row)||index+2};
  let message='';
  if(cells.length<3||cells.length>4)message='ต้องมี 4 คอลัมน์ (Password อาจเว้นว่างสำหรับครูเดิม)';
  else if(!labels.has(item.classroom))message='ไม่พบห้องเรียน '+item.classroom;
  else if(item.classroom.includes('\ufffd')||item.full_name.includes('\ufffd'))message='อักขระไทยเสียหาย กรุณาใช้ CSV UTF-8 หรือ Excel .xlsx';
  else if(!item.full_name||item.full_name.length>100)message='ชื่อ–สกุลครูต้องยาวไม่เกิน 100 ตัว';
  else if(!/^[a-z0-9._-]{3,40}$/i.test(item.username))message='Username ไม่ถูกต้อง';
  else if(item.password&&item.password.length<4)message='รหัสผ่านครูใหม่ต้องมีอย่างน้อย 4 ตัว';
  else if(item.password.length>128)message='รหัสผ่านยาวเกิน 128 ตัว';
  else if(/^\d{13}$/.test(item.password))message='ห้ามใช้เลขบัตรประชาชนเป็นรหัสผ่าน';
  else if(byRoom.has(item.classroom))message='ห้องซ้ำในไฟล์';
  else if(byUser.has(item.username))message='Username ซ้ำในไฟล์ ให้ผูกห้องเพิ่มเติมแยกครั้ง';
  byRoom.add(item.classroom);byUser.add(item.username);
  return {values:item,message,status:message?'error':'ready'};
 });
 if(!rows.length)throw Error('ไม่มีรายชื่อครูที่ปรึกษาหลังหัวตาราง');
 return rows;
}
export function createAdvisorImport({api,rooms,onSuccess}){
 let currentRows=[],preview=[],busy=false,phase='',filename='',committed=0;
 function clear(){
  for(const row of currentRows)row.password='';
  currentRows=[];preview=[];busy=false;phase='';filename='';committed=0;
 }
 function draw(container){
  const target=container.querySelector('#advisorImportPreview'),button=container.querySelector('#advisorImportCommit');
  if(!target)return;
  const errors=preview.filter(x=>x.status==='error').length;
  const done=preview.filter(x=>x.status==='imported').length;
  target.innerHTML=preview.length?'<p class="summary"><strong>'+esc(filename)+'</strong> • '+preview.length+
   ' ห้อง • มีปัญหา '+errors+' • บันทึกแล้ว '+done+'</p>'+
   '<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="table"><thead><tr>'+
   '<th>แถว</th><th>ห้อง</th><th>ชื่อครูที่ปรึกษา</th><th>Username</th><th>การดำเนินการ</th><th>ผลตรวจ</th></tr></thead><tbody>'+
   preview.map(x=>'<tr><td>'+x.source_row+'</td><td>'+esc(x.room)+'</td><td>'+esc(x.full_name)+'</td><td>'+esc(x.username)+
    '</td><td>'+esc(x.mode==='create'?'สร้างครูใหม่':x.mode==='link'?'ใช้บัญชีครูเดิม':'—')+'</td><td>'+
    esc(x.message|| (x.status==='imported'?'นำเข้าสำเร็จ':'พร้อมนำเข้า'))+'</td></tr>').join('')+
   '</tbody></table></div>':'';
  button.hidden=!preview.length||done===preview.length;
  button.disabled=busy||errors>0||done>0;
  const status=container.querySelector('#advisorImportStatus');
  if(status)status.textContent=phase;
 }
 async function preflight(container){
  if(busy)return;
  busy=true;clear();busy=true;phase='กำลังตรวจสอบไฟล์และรายชื่อครู...';draw(container);
  try{
   const form=container.querySelector('#advisorImportForm'),data=new FormData(form);
   const file=form.querySelector('input[name="file"]').files[0];
   let raw;
   if(file){
    filename=file.name;
    if(/\.xlsx$/i.test(file.name))raw=await readXlsxRows(file);
    else if(/\.csv$/i.test(file.name)){
     const parsed=await readCsvFile(file,String(data.get('encoding')||'auto'));
     raw=csvRows(parsed.text);
    }else throw Error('เลือก Excel .xlsx หรือ CSV .csv เท่านั้น');
   }else{
    filename='ข้อมูล CSV ที่วาง';
    const str=String(data.get('csv')||'');
    if(str.includes('\ufffd'))throw Error('อักขระภาษาไทยเสียหาย กรุณาเลือกไฟล์ต้นฉบับ');
    raw=csvRows(str);
   }
   const prepared=prepareAdvisorRows(raw,typeof rooms==='function'?rooms():rooms);
   currentRows=prepared.map(r=>r.values);
   preview=prepared.map(r=>({source_row:r.values.source_row,room:r.values.classroom,full_name:r.values.full_name,
    username:r.values.username,status:r.status,message:r.message,mode:''}));
   const bad=prepared.some(r=>r.status==='error');
   if(!bad){
    const groups=batches(currentRows,50);
    let start=0;
    for(const group of groups){
     const result=await api('/api/admin/advisors/preview',{method:'POST',body:{advisors:group}});
     if(!Array.isArray(result.items)||result.items.length!==group.length)throw Error('ผลตรวจจากเซิร์ฟเวอร์ไม่ครบ');
     for(let i=0;i<result.items.length;i++)preview[start+i]={...result.items[i]};
     start+=group.length;
    }
   }
   phase=preview.some(r=>r.status==='error')?'พบข้อมูลที่ต้องแก้ไข ก่อนนำเข้าครูที่ปรึกษา':
    'ตรวจสอบผ่านทั้งหมด '+currentRows.length+' ห้อง พร้อมยืนยันนำเข้า';
  }catch(e){
   for(const row of currentRows)row.password='';
   currentRows=[];preview=[];phase=e.message;
  }finally{busy=false;draw(container)}
 }
 async function commit(container){
  if(busy||!preview.length||preview.some(x=>x.status!=='ready'))return;
  if(!confirm('ยืนยันสร้างบัญชีครู/ผูกครูที่ปรึกษา '+currentRows.length+' ห้อง?'))return;
  busy=true;committed=0;
  try{
   for(const group of batches(currentRows,5)){
    const response=await api('/api/admin/advisors/commit',{method:'POST',body:{advisors:group}});
    if(!response?.ok||response.assigned!==group.length)throw Error('ผลบันทึกชุดนี้ไม่ครบ');
    for(let i=committed;i<committed+group.length;i++){
     preview[i].status='imported';preview[i].message='นำเข้าสำเร็จ';
     currentRows[i].password='';
    }
    committed+=group.length;
    phase='บันทึกแล้ว '+committed+' / '+currentRows.length+' ห้อง';
    draw(container);
   }
   phase='นำเข้าครูที่ปรึกษาสำเร็จ '+committed+' ห้อง';
   await onSuccess?.();
  }catch(e){
   phase='บันทึกแล้ว '+committed+' ห้อง และหยุดเนื่องจาก: '+e.message+
    ' กรุณาตรวจรายชื่อครูและห้องที่บันทึกสำเร็จก่อนนำเข้าไฟล์ที่เหลือ (อย่ากดนำเข้าทั้งไฟล์ซ้ำ)';
  }finally{
   for(const row of currentRows)row.password='';
   busy=false;draw(container);
  }
 }
 function render(container){
  if(!container)return;
  container.innerHTML='<section class="card stack"><h3>📥 นำเข้าครูที่ปรึกษาหลายห้องในไฟล์เดียว (Excel / CSV)</h3>'+
   '<p class="muted">ใช้ 4 คอลัมน์: <code>classroom,full_name,username,password</code> • เฉพาะผู้ดูแลระบบ • นำเข้าครูที่ปรึกษาหลายห้องในไฟล์เดียว</p>'+
   '<div class="row" style="flex-wrap:wrap;gap:12px"><button id="advisorTemplateExcel" type="button" class="button secondary">ดาวน์โหลด Excel ตัวอย่าง (.xlsx)</button>'+
   '<a href="./templates/advisor-all-rooms-import.csv" download>ดาวน์โหลด CSV ภาษาไทยสำหรับ Excel</a></div>'+
   '<form id="advisorImportForm" class="stack"><div class="field"><label>เลือกไฟล์ Excel .xlsx หรือ CSV .csv</label>'+
   '<input type="file" name="file" accept=".xlsx,.csv,text/csv"></div>'+
   '<div class="field"><label>รหัสภาษาไทย CSV</label><select name="encoding"><option value="auto">ตรวจจับอัตโนมัติ</option>'+
   '<option value="utf-8">UTF-8</option><option value="windows-874">Windows-874 / TIS-620</option></select></div>'+
   '<div class="field"><label>หรือวางข้อมูล CSV</label><textarea name="csv" rows="4" placeholder="classroom,full_name,username,password"></textarea></div>'+
   '<p class="muted">ครูใหม่: กรอก Password อย่างน้อย 4 ตัว (แนะนำให้ยาวและไม่ซ้ำ) • ครูที่มีบัญชีแล้ว: ชื่อและ Username ต้องตรงกับระบบและเว้น Password ว่าง • ไม่เปลี่ยนรหัสผ่านครูเดิม</p>'+
   '<div class="warn">ห้องที่มีครูที่ปรึกษาอยู่แล้วจะถูกปฏิเสธ ไม่เขียนทับการมอบหมายเดิม • หนึ่งห้องต่อหนึ่งครูที่ปรึกษา • หนึ่ง Username ต่อไฟล์</div>'+
   '<button class="button full" type="submit">ตรวจสอบทั้งไฟล์ก่อนนำเข้า</button></form>'+
   '<div id="advisorImportStatus" role="status" aria-live="polite" class="muted"></div>'+
   '<div id="advisorImportPreview"></div>'+
   '<button type="button" class="button full" id="advisorImportCommit" hidden>ยืนยันนำเข้าครูที่ปรึกษาทั้งไฟล์</button>'+
   '<p class="muted">กรณีเครือข่ายขัดข้อง ระบบอาจบันทึกไปแล้วบางชุด กรุณาตรวจรายการที่สำเร็จก่อนนำเข้าซ้ำ</p></section>';
  container.querySelector('#advisorTemplateExcel').addEventListener('click',downloadAdvisorExampleXlsx);
  container.querySelector('#advisorImportForm').addEventListener('submit',e=>{e.preventDefault();preflight(container)});
  container.querySelector('#advisorImportCommit').addEventListener('click',()=>commit(container));
  draw(container);
 }
 return {render,clear};
}
