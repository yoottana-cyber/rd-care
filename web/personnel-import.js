// Admin-only personnel CSV/XLSX import with explicit skip/update handling.
// Passwords remain only in memory for the current review/commit; never render them.
import {readXlsxRows} from './xlsx-reader.js';
import {readCsvFile} from './csv-encoding.js';
import {csvRows} from './unified-import.js';
import {downloadPersonnelExampleXlsx} from './template-xlsx.js';

const HEADERS='username,full_name,role,password';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const chunks=(rows,size)=>Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size));
export function parsePersonnelImportRows(raw){
 if(!Array.isArray(raw)||!raw.length||
  raw[0].map(v=>String(v??'').trim().toLowerCase().replace(/^\ufeff/,'')).join(',')!==HEADERS)
  throw Error('หัวตารางต้องเป็น '+HEADERS);
 const seen=new Set();
 const items=raw.slice(1).map((cells,index)=>{
  const [username,full_name,role,password]=cells.map(x=>String(x??''));
  const source_row=Number(cells.source_row)||index+2;
  const item={source_row,username:username?.trim().toLowerCase()||'',
   display_name:full_name?.trim()||'',role:role?.trim().toLowerCase()||'',
   password:password||''};
  let message='';
  if(cells.length!==4)message='ต้องมี 4 คอลัมน์';
  else if(!/^[a-z0-9._-]{3,40}$/.test(item.username))message='Username ต้องเป็นอังกฤษ ตัวเลข จุดหรือขีด 3–40 ตัว';
  else if(seen.has(item.username))message='Username ซ้ำภายในไฟล์';
  else if(!item.display_name||item.display_name.length>100||
   /[\u0000-\u001f\u007f\ufffd]/.test(item.display_name))message='ชื่อ–สกุลไม่ถูกต้อง';
  else if(!['teacher','staff'].includes(item.role))message='role ต้องเป็น teacher หรือ staff';
  else if(/^\d{13}$/.test(item.password))message='ห้ามใช้เลขบัตรประชาชนเป็นรหัสผ่าน';
  else if(item.password.length>128||/[\u0000-\u001f\u007f]/.test(item.password))
   message='รหัสผ่านมีอักขระต้องห้ามหรือยาวเกิน 128 ตัว';
  seen.add(item.username);
  return {item,source_row,message,status:message?'error':'pending'};
 });
 if(!items.length)throw Error('ไฟล์ยังไม่มีรายชื่อบุคลากร');
 return items;
}

export function createPersonnelImport({api,onSuccess,toast}){
 let rows=[],preview=[],fileLabel='',mode='skip',busy=false,phase='';
 const wipe=()=>{for(const row of rows)row.password='';rows=[]};
 function clear(){
  wipe();preview=[];fileLabel='';phase='';
 }
 function draw(container){
  const box=container.querySelector('#personnelImportPreview');
  const btn=container.querySelector('#personnelImportCommit');
  const status=container.querySelector('#personnelImportStatus');
  if(status)status.textContent=phase;
  const counts={ready:0,update:0,skipped:0,error:0,imported:0,updated:0};
  for(const p of preview)if(counts[p.status]!==undefined)counts[p.status]++;
  if(btn){
   btn.hidden=!preview.length;
   btn.disabled=busy||rows.length===0||counts.error>0||counts.imported>0||counts.updated>0||
    counts.ready+counts.update===0;
  }
  if(!box)return;
  box.innerHTML=preview.length?'<p class="summary">ไฟล์ '+esc(fileLabel)+
   ' • เพิ่มใหม่ '+counts.ready+' • อัปเดต '+counts.update+
   ' • ข้ามคนเดิม '+counts.skipped+' • ผิดพลาด '+counts.error+
   ' • บันทึกแล้ว '+(counts.imported+counts.updated)+'</p>'+
   '<div class="table-wrap" style="max-height:380px;overflow:auto"><table class="table">'+
   '<thead><tr><th>แถว</th><th>Username</th><th>ชื่อบุคลากร</th><th>บทบาท</th><th>การดำเนินการ / ผลตรวจ</th></tr></thead><tbody>'+
   preview.map(p=>'<tr><td>'+p.source_row+'</td><td>'+esc(p.username)+
    '</td><td>'+esc(p.display_name)+'</td><td>'+esc(p.role)+
    '</td><td>'+esc(p.message||p.status)+'</td></tr>').join('')+
   '</tbody></table></div>':'';
 }
 async function readFile(file,encoding){
  if(!file?.size)throw Error('กรุณาเลือกไฟล์ Excel หรือ CSV');
  if(file.size>8_000_000)throw Error('ไฟล์ใหญ่เกิน 8 MB');
  if(/\.xlsx$/i.test(file.name))return readXlsxRows(file);
  if(/\.csv$/i.test(file.name))return csvRows((await readCsvFile(file,encoding)).text);
  throw Error('รองรับ .xlsx และ .csv เท่านั้น');
 }
 async function preflight(container){
  if(busy)return;
  clear();busy=true;
  const form=container.querySelector('#personnelImportForm'),data=new FormData(form);
  mode=String(data.get('mode')||'skip');
  const file=data.get('file');fileLabel=file?.name||'';
  const button=container.querySelector('#personnelImportPreviewButton');
  const controls=[...form.querySelectorAll('input,select')];
  if(button)button.disabled=true;
  for(const element of controls)element.disabled=true;
  phase='กำลังตรวจสอบไฟล์และ Username ที่มีอยู่ในฐานข้อมูล...';draw(container);
  try{
   const source=await readFile(file,String(data.get('encoding')||'auto'));
   if(source.length>5001)throw Error('ไฟล์ใหญ่เกิน 5,000 รายชื่อ');
   const parsed=parsePersonnelImportRows(source);
   rows=parsed.map(x=>x.item);
   preview=parsed.map(x=>({source_row:x.source_row,username:x.item.username,
    display_name:x.item.display_name,role:x.item.role,status:x.status,message:x.message}));
   if(parsed.some(x=>x.message)){
    phase='พบรูปแบบไฟล์ผิดพลาด กรุณาแก้ไขไฟล์ก่อนนำเข้า';
    return;
   }
   for(const group of chunks(rows,50)){
    const result=await api('/api/admin/personnel-import/preview',{
     method:'POST',body:{mode,people:group},timeoutMs:30000});
    if(!Array.isArray(result.items)||result.items.length!==group.length)
     throw Error('ผลตรวจรายชื่อจากเซิร์ฟเวอร์ไม่ครบ');
    const start=rows.indexOf(group[0]);
    for(let i=0;i<group.length;i++)
     preview[start+i]={...result.items[i]};
    phase='ตรวจแล้ว '+(start+group.length)+' / '+rows.length+' รายการ';
    draw(container);
   }
   const errors=preview.filter(x=>x.status==='error').length;
   const created=preview.filter(x=>x.status==='ready').length;
   const updated=preview.filter(x=>x.status==='update').length;
   const skipped=preview.filter(x=>x.status==='skipped').length;
   phase=errors?'พบข้อมูลต้องแก้ไข '+errors+' แถว: ยังไม่อนุญาตให้บันทึก':
    'ตรวจแล้ว: เพิ่มใหม่ '+created+' • อัปเดต '+updated+' • ข้าม '+skipped+
    ' • ยังไม่มีการบันทึก';
  }catch(e){
   wipe();preview=[];phase='ตรวจสอบไม่สำเร็จ: '+String(e?.message||'ระบบไม่พร้อม')+
    ' • ไม่มีการบันทึก';
  }finally{
   busy=false;
   for(const element of controls)if(element.isConnected)element.disabled=false;
   if(button?.isConnected)button.disabled=false;
   draw(container);
  }
 }
 async function commit(container){
  if(busy||!preview.length||preview.some(x=>x.status==='error'))return;
  const create=preview.filter(x=>x.status==='ready').length;
  const update=preview.filter(x=>x.status==='update').length;
  const skip=preview.filter(x=>x.status==='skipped').length;
  if(!create&&!update)return;
  if(!confirm('ยืนยันนำเข้าบุคลากร?\nเพิ่มใหม่ '+create+
   ' • อัปเดตเฉพาะชื่อ '+update+' • ข้ามคนเดิม '+skip+
   '\nรหัสผ่าน บทบาท สิทธิ์ และสถานะของบัญชีเดิมจะไม่เปลี่ยน'))return;
  busy=true;
  const button=container.querySelector('#personnelImportCommit');
  const controls=[...container.querySelectorAll('#personnelImportForm input,#personnelImportForm select')];
  if(button)button.disabled=true;
  for(const element of controls)element.disabled=true;
  let created=0,updated=0,skipped=0,done=0;
  try{
   // Re-evaluate every chunk on the server, so stale browser previews cannot
   // bypass admin permissions or resurrect users deleted since the preview.
   for(const group of chunks(rows,5)){
    const result=await api('/api/admin/personnel-import/commit',{
     method:'POST',body:{mode,people:group},timeoutMs:30000});
    if(!result.ok||!Array.isArray(result.items)||result.items.length!==group.length)
     throw Error('เซิร์ฟเวอร์ไม่ได้ยืนยันผลครบถ้วน');
    for(let i=0;i<group.length;i++){
     const item=result.items[i];
     preview[done+i]={...item};
    }
    created+=result.created;updated+=result.updated;skipped+=result.skipped;
    done+=group.length;
    phase='ประมวลผล '+done+'/'+rows.length+' • เพิ่ม '+created+
     ' • อัปเดต '+updated+' • ข้าม '+skipped;
    draw(container);
   }
   phase='สำเร็จ • เพิ่ม '+created+' • อัปเดตชื่อ '+updated+
    ' • ข้าม '+skipped+' โดยคงรหัสผ่านและสิทธิ์ของบัญชีเดิม';
   toast?.(phase);
   await onSuccess?.();
  }catch(e){
   phase='หยุดหลังบันทึก '+done+' จาก '+rows.length+
    ' รายการ • ไม่ทราบผลบางชุด: '+String(e?.message||'ข้อผิดพลาด')+
    ' • กรุณาตรวจรายชื่อในระบบแล้วเลือกไฟล์ตรวจสอบใหม่ก่อนนำเข้าต่อ ไม่ส่งซ้ำโดยอัตโนมัติ';
  }finally{
   wipe();busy=false;
   for(const element of controls)if(element.isConnected)element.disabled=false;
   if(button?.isConnected)button.disabled=true;
   draw(container);
  }
 }
 function render(container){
  if(!container)return;
  clear();
  container.innerHTML='<section class="card stack">'+
   '<h3>📥 นำเข้าบุคลากร (ข้ามคนเดิม / อัปเดตชื่อ)</h3>'+
   '<p class="muted">นำเข้าบัญชีครูและฝ่ายกิจการนักเรียน ไม่ต้องเลือกห้องเรียน; ใช้ Username เป็นรหัสจับคู่ ห้ามนำเข้าบัญชี Admin</p>'+
   '<div class="row" style="flex-wrap:wrap;gap:9px">'+
   '<button type="button" class="button secondary" id="personnelExampleExcel">ดาวน์โหลดไฟล์ตัวอย่าง Excel</button>'+
   '<a href="./templates/personnel-import.csv" download>ดาวน์โหลด CSV UTF-8</a></div>'+
   '<form id="personnelImportForm" class="stack">'+
   '<div class="field"><label>เลือกไฟล์ .xlsx / .csv</label><input type="file" name="file" accept=".xlsx,.csv,text/csv" required></div>'+
   '<div class="field"><label>รหัสอักขระ CSV</label><select name="encoding">'+
   '<option value="auto">ตรวจจับอัตโนมัติ</option><option value="utf-8">UTF-8</option>'+
   '<option value="windows-874">Windows-874 / TIS-620</option></select></div>'+
   '<div class="field"><label>กรณี Username มีอยู่แล้ว</label><select name="mode" id="personnelMode">'+
   '<option value="skip">ข้ามคนเดิม (แนะนำ) — เพิ่มเฉพาะคนใหม่</option>'+
   '<option value="update">อัปเดตชื่อบุคลากรเดิม — เพิ่มคนใหม่ด้วย</option></select></div>'+
   '<p class="muted">หัวตาราง: <code>username,full_name,role,password</code> • role ใช้ teacher หรือ staff • ครูใหม่ Password อย่างน้อย 10 ตัว, staff ใหม่อย่างน้อย 12 ตัว • คนเดิมเว้นรหัสผ่านว่างได้</p>'+
   '<p class="warn">ในโหมดอัปเดต ระบบเปลี่ยนเฉพาะชื่อที่แสดงเท่านั้น ไม่เปลี่ยนรหัสผ่าน บทบาท ฝ่ายกิจการ สถานะบัญชี หรือสิทธิ์ครูที่ปรึกษา หากต้องเปลี่ยนสิทธิ์ให้ใช้เมนูจัดการบุคลากร</p>'+
   '<button type="submit" class="button full" id="personnelImportPreviewButton">ตรวจสอบทั้งไฟล์ก่อนบันทึก</button></form>'+
   '<div id="personnelImportStatus" class="muted" role="status" aria-live="polite"></div>'+
   '<div id="personnelImportPreview"></div>'+
   '<button type="button" class="button full" id="personnelImportCommit" hidden>ยืนยันนำเข้าตามผลตรวจ</button>'+
   '<p class="muted">ไฟล์ที่มีรหัสผ่านควรเก็บในพื้นที่ของโรงเรียนและลบเมื่อไม่จำเป็น; ก่อนนำเข้าจริงให้สำรอง SQLite ด้วย school:backup</p>'+
   '</section>';
  container.querySelector('#personnelExampleExcel')?.addEventListener('click',downloadPersonnelExampleXlsx);
  container.querySelector('#personnelImportForm')?.addEventListener('submit',event=>{
   event.preventDefault();preflight(container);
  });
  container.querySelector('#personnelImportCommit')?.addEventListener('click',()=>commit(container));
  container.querySelector('#personnelMode')?.addEventListener('change',()=>{
   wipe();preview=[];phase='เปลี่ยนโหมดแล้ว ต้องกดตรวจสอบไฟล์ใหม่อีกครั้ง';draw(container);
  });
  container.querySelector('input[name="file"]')?.addEventListener('change',()=>{
   wipe();preview=[];phase='เปลี่ยนไฟล์แล้ว ต้องตรวจสอบใหม่';draw(container);
  });
  draw(container);
 }
 return {render,clear};
}
