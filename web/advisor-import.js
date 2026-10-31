import {readXlsxRows} from './xlsx-reader.js';
import {readCsvFile} from './csv-encoding.js';
import {csvRows} from './unified-import.js';
import {downloadAdvisorExampleXlsx} from './template-xlsx.js';

const HEADER='classroom,full_name,username,password';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const batches=(rows,size)=>Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size));
// Never split two advisors for the same classroom across commit requests:
// an authoritative room replacement must always update both slots together.
export function advisorRoomBatches(rows,maxRows=5){
 const grouped=new Map();
 for(const row of rows){
  const label=row.classroom;
  if(!grouped.has(label))grouped.set(label,[]);
  grouped.get(label).push(row);
 }
 const result=[];let batch=[];
 for(const group of grouped.values()){
  if(group.length>maxRows)throw Error('ข้อมูลครูที่ปรึกษาหนึ่งห้องเกินขนาดชุดนำเข้า');
  if(batch.length&&batch.length+group.length>maxRows){
   result.push(batch);batch=[];
  }
  batch.push(...group);
 }
 if(batch.length)result.push(batch);
 return result;
}

export function prepareAdvisorRows(raw,rooms,{existingMode='skip'}={}){
 if(!Array.isArray(raw)||!raw.length||raw[0].map(x=>String(x??'').trim().toLowerCase()).join(',')!==HEADER)
  throw Error('หัวตารางต้องเป็น '+HEADER);
 const labels=new Set(rooms.map(r=>r.label));
 const byRoom=new Map(),byUser=new Map();
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
  // Existing accounts may carry old passwords in files; server checks only genuinely new accounts.
  else if(item.password.length>128)message='รหัสผ่านยาวเกิน 128 ตัว';
  else if(/^\d{13}$/.test(item.password))message='ห้ามใช้เลขบัตรประชาชนเป็นรหัสผ่าน';
  else if((byRoom.get(item.classroom)||0)>=2)message='ห้องนี้มีครูที่ปรึกษาเกิน 2 คน';
  else if((byUser.get(item.username)||[]).includes(item.classroom))
   message='Username ซ้ำในห้องเดียวกัน';
  else if(byUser.has(item.username)&&existingMode==='skip')
   message='Username ซ้ำในไฟล์ ให้ใช้โหมดแทนที่หากครูดูแลหลายห้อง';
  else if(byUser.has(item.username)&&byUser.get(item.username+'::name')!==item.full_name)
   message='Username เดียวกันมีชื่อไม่ตรงกันในไฟล์';
  byRoom.set(item.classroom,(byRoom.get(item.classroom)||0)+1);
  byUser.set(item.username,[...(byUser.get(item.username)||[]),item.classroom]);
  if(!byUser.has(item.username+'::name'))byUser.set(item.username+'::name',item.full_name);
  return {values:item,message,status:message?'error':'ready'};
 });
 if(!rows.length)throw Error('ไม่มีรายชื่อครูที่ปรึกษาหลังหัวตาราง');
 return rows;
}
export function createAdvisorImport({api,rooms,onSuccess}){
 let currentRows=[],preview=[],busy=false,phase='',filename='',committed=0,existingMode='skip';
 function clear(){
  for(const row of currentRows)row.password='';
  currentRows=[];preview=[];busy=false;phase='';filename='';committed=0;
 }
 function draw(container){
  const target=container.querySelector('#advisorImportPreview'),button=container.querySelector('#advisorImportCommit');
  if(!target)return;
  const errors=preview.filter(x=>x.status==='error').length;
  const done=preview.filter(x=>x.status==='imported').length;
  const skipped=preview.filter(x=>x.status==='skipped').length;
  const updates=preview.filter(x=>['update_name','link_update','replace_update_name'].includes(x.mode)).length;
  const replacingRooms=new Set(preview.filter(x=>x.status==='ready'&&
   ['replace','create_replace','replace_update_name'].includes(x.mode)).map(x=>x.room)).size;
  const actionable=preview.filter(x=>x.status==='ready').length;
  target.innerHTML=preview.length?'<p class="summary"><strong>'+esc(filename)+'</strong> • '+preview.length+
   ' รายการ • ห้องที่แทนที่ '+replacingRooms+' • ข้าม '+skipped+' • อัปเดตชื่อ '+updates+' • มีปัญหา '+errors+' • บันทึกแล้ว '+done+'</p>'+
   '<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="table"><thead><tr>'+
   '<th>แถว</th><th>ห้อง</th><th>ชื่อครูที่ปรึกษา</th><th>Username</th><th>การดำเนินการ</th><th>ผลตรวจ</th></tr></thead><tbody>'+
   preview.map(x=>'<tr><td>'+x.source_row+'</td><td>'+esc(x.room)+'</td><td>'+esc(x.full_name)+'</td><td>'+esc(x.username)+
    '</td><td>'+esc(x.mode==='replace'||x.mode==='create_replace'||x.mode==='replace_update_name'?'แทนที่ครูของห้องตามไฟล์':x.mode==='create'?'สร้างบัญชี + ผูกห้อง':x.mode==='link'?'ผูกครูเดิมเพิ่ม':x.mode==='link_update'?'ผูกห้อง + อัปเดตชื่อ':x.mode==='update_name'?'อัปเดตชื่อเดิม':x.mode==='skip'?'ข้ามครูเดิม':'—')+'</td><td>'+
    esc(x.message|| (x.status==='imported'?'นำเข้าสำเร็จ':'พร้อมนำเข้า'))+'</td></tr>').join('')+
   '</tbody></table></div>':'';
  button.hidden=!preview.length||actionable===0;
  button.disabled=busy||errors>0||done>0||actionable===0;
  const status=container.querySelector('#advisorImportStatus');
  if(status)status.textContent=phase;
 }
 async function preflight(container){
  if(busy)return;
  busy=true;clear();busy=true;phase='กำลังตรวจสอบไฟล์และรายชื่อครู...';draw(container);
  try{
   const form=container.querySelector('#advisorImportForm'),data=new FormData(form);
   existingMode=String(data.get('existingMode')||'skip');
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
   const prepared=prepareAdvisorRows(raw,typeof rooms==='function'?rooms():rooms,{existingMode});
   currentRows=prepared.map(r=>r.values);
   preview=prepared.map(r=>({source_row:r.values.source_row,room:r.values.classroom,full_name:r.values.full_name,
    username:r.values.username,status:r.status,message:r.message,mode:''}));
   const bad=prepared.some(r=>r.status==='error');
   if(!bad){
    const groups=existingMode==='replace'?advisorRoomBatches(currentRows,120):batches(currentRows,50);
    let start=0;
    for(const group of groups){
     const result=await api('/api/admin/advisors/preview',{method:'POST',body:{advisors:group,existingMode}});
     if(!Array.isArray(result.items)||result.items.length!==group.length)throw Error('ผลตรวจจากเซิร์ฟเวอร์ไม่ครบ');
     for(let i=0;i<result.items.length;i++)preview[start+i]={...result.items[i]};
     start+=group.length;
    }
   }
   const toSave=preview.filter(r=>r.status==='ready').length;
   const skipping=preview.filter(r=>r.status==='skipped').length;
   phase=preview.some(r=>r.status==='error')?'พบข้อมูลที่ต้องแก้ไข ก่อนนำเข้าครูที่ปรึกษา':
    toSave?'ตรวจสอบแล้ว '+currentRows.length+' รายการ • พร้อมบันทึก '+toSave+' • ข้าม '+skipping:
    'ข้อมูลเดิมครบแล้ว ข้าม '+skipping+' รายการ ไม่มีรายการที่ต้องบันทึก';
   if(!preview.some(r=>r.status==='error')&&existingMode==='replace'){
    const roomsToReplace=new Set(preview.filter(r=>r.status==='ready'&&
     ['replace','create_replace','replace_update_name'].includes(r.mode)).map(r=>r.room)).size;
    phase+=' • ห้องที่เปลี่ยนแปลง '+roomsToReplace+' ห้อง';
   }
  }catch(e){
   for(const row of currentRows)row.password='';
   currentRows=[];preview=[];phase=e.message;
  }finally{busy=false;draw(container)}
 }
 async function commit(container){
  if(busy||!preview.length||preview.some(x=>x.status==='error')||
   !preview.some(x=>x.status==='ready')||preview.some(x=>x.status==='imported'))return;
  const changes=preview.filter(x=>x.status==='ready').length;
  const skipped=preview.filter(x=>x.status==='skipped').length;
  if(!confirm('ยืนยันนำเข้าครูที่ปรึกษา?\nรายการบันทึก '+changes+' • ข้ามคนเดิม '+skipped+
   '\nโหมด: '+(existingMode==='replace'?'แทนที่ครูที่ปรึกษาตามรายชื่อในไฟล์':'ข้ามรายการเดิม')+
   (existingMode==='replace'?
    '\nสำคัญ: ทุกห้องที่อยู่ในไฟล์จะใช้รายชื่อใหม่แทนคนเก่า และลบครูที่ปรึกษาคนที่ 2 ของห้องนั้นหากไฟล์มีเพียง 1 คน':
    '\nจะไม่เขียนทับครูเดิม')+
   '\nไม่เปลี่ยนรหัสผ่านหรือข้อมูลนักเรียน'))return;
  busy=true;committed=0;
  let assigned=0,updated=0,skippedCount=0,replaced=0;
  try{
   for(const group of (existingMode==='replace'?advisorRoomBatches(currentRows,5):batches(currentRows,5))){
    const response=await api('/api/admin/advisors/commit',{method:'POST',body:{advisors:group,existingMode}});
    if(!response?.ok||!Array.isArray(response.items)||response.items.length!==group.length)
     throw Error('ผลบันทึกชุดนี้ไม่ครบ');
    assigned+=Number(response.assigned)||0;
    updated+=Number(response.updated)||0;
    skippedCount+=Number(response.skipped)||0;
    replaced+=Number(response.replacedRooms)||0;
    for(let i=0;i<group.length;i++){
     const index=currentRows.indexOf(group[i]);
     if(index<0)throw Error('ไม่พบแถวในผลตรวจ');
     preview[index]={...response.items[i]};
     if(preview[index].status==='imported')preview[index].message='บันทึกสำเร็จ';
     currentRows[index].password='';
    }
    committed+=group.length;
    phase='ประมวลผลแล้ว '+committed+' / '+currentRows.length+
     ' • แทนที่ห้อง '+replaced+' • เพิ่ม/ผูกครู '+assigned+' • อัปเดตชื่อ '+updated+' • ข้าม '+skippedCount;
    draw(container);
   }
   phase='นำเข้าครูที่ปรึกษาเสร็จแล้ว • แทนที่ห้อง '+replaced+' • เพิ่ม/ผูกครู '+assigned+' • อัปเดตชื่อ '+updated+' • ข้าม '+skippedCount;
   await onSuccess?.();
  }catch(e){
   phase='บันทึกแล้ว '+committed+' รายการ และหยุดเนื่องจาก: '+e.message+
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
   '<div class="field"><label>เมื่อครูเป็นที่ปรึกษาห้องนี้อยู่แล้ว</label><select name="existingMode" id="advisorExistingMode">'+
   '<option value="skip">ข้ามรายการเดิม (แนะนำ) — เพิ่มเฉพาะรายการที่ยังไม่มี</option>'+
   '<option value="replace">อัปเดต/แทนที่ครูที่ปรึกษาเดิมตามไฟล์ (ใช้ข้อมูลใหม่ทับของเก่า)</option></select></div>'+ 
   '<p class="muted">ข้าม = เพิ่มเฉพาะรายการที่ยังไม่มี • แทนที่ = ใช้รายชื่อในไฟล์แทนครูเดิมของทุกห้องที่ระบุ แม้ห้องนั้นมีครูครบแล้ว (ห้องที่ไม่อยู่ในไฟล์ไม่เปลี่ยน)</p>'+ 
   '<p class="muted">ครูใหม่: กรอก Password อย่างน้อย 10 ตัว (แนะนำให้ยาวและไม่ซ้ำ) • ครูที่มีบัญชีแล้ว: ใส่ Username เดิม (ในโหมดแทนที่สามารถแก้ชื่อได้ และไม่ต้องกรอกรหัสผ่านใหม่) • ไม่เปลี่ยนรหัสผ่านครูเดิม</p>'+
   '<div class="warn">หนึ่งห้องมีครูที่ปรึกษาได้ 1–2 คน • โหมดแทนที่: ถ้าไฟล์มี 1 คนต่อห้อง ครูคนที่ 2 เดิมจะถูกยกเลิกการมอบหมาย • ครูคนเดิมสามารถดูแลหลายห้องในไฟล์เดียว • ไม่ลบบัญชีครูหรือข้อมูลนักเรียน</div>'+
   '<button class="button full" type="submit">ตรวจสอบทั้งไฟล์ก่อนนำเข้า</button></form>'+
   '<div id="advisorImportStatus" role="status" aria-live="polite" class="muted"></div>'+
   '<div id="advisorImportPreview"></div>'+
   '<button type="button" class="button full" id="advisorImportCommit" hidden>ยืนยันนำเข้าครูที่ปรึกษาทั้งไฟล์</button>'+
   '<p class="muted">กรณีเครือข่ายขัดข้อง ระบบอาจบันทึกไปแล้วบางชุด กรุณาตรวจรายการที่สำเร็จก่อนนำเข้าซ้ำ</p></section>';
  container.querySelector('#advisorTemplateExcel').addEventListener('click',downloadAdvisorExampleXlsx);
  container.querySelector('#advisorImportForm').addEventListener('submit',e=>{e.preventDefault();preflight(container)});
  container.querySelector('#advisorImportCommit').addEventListener('click',()=>commit(container));
  const invalidate=()=>{if(busy)return;clear();phase='มีการเปลี่ยนไฟล์หรือโหมด กรุณาตรวจสอบใหม่';draw(container)};
  container.querySelector('#advisorExistingMode').addEventListener('change',invalidate);
  container.querySelector('#advisorImportForm input[name="file"]').addEventListener('change',invalidate);
  container.querySelector('#advisorImportForm textarea[name="csv"]').addEventListener('input',invalidate);
  draw(container);
 }
 return {render,clear};
}
