import {readXlsxRows} from './xlsx-reader.js';
import {downloadStudentExampleXlsx} from './template-xlsx.js';
import {readCsvFile} from './csv-encoding.js';

const HEADER='classroom,roll_no,student_no,full_name,username,password';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function csvRows(text){
 const rows=[];let row=[],cell='',inQuotes=false;
 text=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(inQuotes&&text[i+1]==='"'){cell+='"';i++}else inQuotes=!inQuotes;
  }else if(ch===','&&!inQuotes){row.push(cell);cell=''}
  else if((ch==='\r'||ch==='\n')&&!inQuotes){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   row.push(cell);if(row.some(x=>String(x).trim())){row.source_row=rows.length+1;rows.push(row)}
   row=[];cell='';
  }else cell+=ch;
 }
 if(inQuotes)throw Error('CSV มีเครื่องหมายคำพูดไม่ครบ');
 row.push(cell);if(row.some(x=>String(x).trim())){row.source_row=rows.length+1;rows.push(row)}
 return rows;
}
export function prepareRows(raw,rooms){
 if(!Array.isArray(raw)||!raw.length)throw Error('ไม่มีข้อมูลในไฟล์');
 const header=raw[0].map(x=>String(x??'').trim().toLowerCase()).join(',');
 if(header!==HEADER)throw Error('ไฟล์ต้องมีหัวตารางตรงตามตัวอย่าง: '+HEADER);
 const labels=new Set(rooms.map(r=>r.label)),ids=new Set(),names=new Set(),rolls=new Set();
 const records=raw.slice(1).map((r,i)=>{
  const source_row=Number(r.source_row)||i+2;
  const [classroom,roll_no,student_no,full_name,username,password]=r.map(v=>String(v??''));
  const values={classroom:classroom.trim(),roll_no:Number(roll_no),student_no:student_no.trim(),full_name:full_name.trim(),
   username:username.trim(),password,source_row};
  let message='';
  const key=values.student_no.toLowerCase(),uname=values.username.toLowerCase();
  const rollkey=values.classroom+':'+values.roll_no;
  if(r.length!==6)message='คอลัมน์ไม่ครบ 6 ช่อง';
  else if(values.classroom.includes('\ufffd')||values.full_name.includes('\ufffd'))
   message='ข้อความภาษาไทยเสียหาย (�) กรุณาใช้ CSV ต้นฉบับ หรือบันทึกใหม่เป็น CSV UTF-8 / Excel .xlsx';
  else if(!labels.has(values.classroom))message='ไม่พบห้องเรียน '+values.classroom;
  else if(!Number.isInteger(values.roll_no)||values.roll_no<1||values.roll_no>100)message='เลขที่ต้องอยู่ในช่วง 1–100';
  else if(!values.student_no||values.student_no.length>40)message='รหัสนักเรียนไม่ถูกต้อง';
  else if(!values.full_name||values.full_name.length>120)message='ชื่อ–สกุลไม่ถูกต้อง';
  else if(!/^[a-z0-9._-]{3,40}$/i.test(values.username))message='Username ไม่ถูกต้อง';
  else if(values.password.length<4||values.password.length>128)message='Password ต้องยาว 4–128 ตัว';
  else if(/^\d{13}$/.test(values.password))message='ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน';
  else if(ids.has(key)||names.has(uname)||rolls.has(rollkey))message='ข้อมูลซ้ำในไฟล์ (รหัสนักเรียน / Username / เลขที่ในห้อง)';
  ids.add(key);names.add(uname);rolls.add(rollkey);
  return {values,message,status:message?'error':'ready'};
 });
 if(!records.length)throw Error('ไม่มีรายชื่อนักเรียนหลังหัวตาราง');
 return records;
}
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
export function createUnifiedImport({api,rooms,onSuccess}){
 let rows=[],preview=[],filename='',busy=false,stopped=false,completed=0,phase='',detectedEncoding='';
 function showPreview(container){
  const place=container.querySelector('#unifiedPreview');if(!place)return;
  const errors=preview.filter(x=>x.status==='error').length;
  const imported=preview.filter(x=>x.status==='imported').length;
  place.innerHTML=preview.length?`<p class="summary"><strong>${esc(filename)}</strong>: ${preview.length} คน / มีปัญหา ${errors} / นำเข้าแล้ว ${imported}</p>
   <div class="table-wrap" style="max-height:440px;overflow:auto"><table class="table">
    <thead><tr><th>แถว</th><th>ห้อง</th><th>เลขที่</th><th>รหัสนักเรียน</th><th>ชื่อ</th><th>Username</th><th>ผลตรวจ</th></tr></thead>
    <tbody>${preview.map(x=>`<tr><td>${x.source_row}</td><td>${esc(x.room)}</td><td>${x.roll_no}</td><td>${esc(x.student_no)}</td>
      <td>${esc(x.full_name)}</td><td>${esc(x.username)}</td><td class="${x.status==='error'?'import-error':x.status==='imported'?'import-success':''}">${esc(x.message|| (x.status==='imported'?'นำเข้าสำเร็จ':'พร้อมนำเข้า'))}</td></tr>`).join('')}</tbody></table></div>`:'';
  const button=container.querySelector('#unifiedCommit');
  if(button){button.hidden=!preview.length||imported===preview.length;button.disabled=busy||errors>0||preview.some(x=>x.status==='imported');}
  const status=container.querySelector('#unifiedStatus');
  if(status)status.textContent=phase;
 }
 async function preflight(container){
  if(busy)return;
  busy=true;rows=[];preview=[];completed=0;detectedEncoding='';
  const button=container.querySelector('#unifiedPreviewButton');
  if(button)button.disabled=true;
  try{
   const form=container.querySelector('#unifiedForm'),data=new FormData(form),file=data.get('file');
   let raw;
   if(file?.size){
    if(file.size>8_000_000)throw Error('ไฟล์ใหญ่เกิน 8 MB กรุณาแบ่งเป็นหลายไฟล์');
    if(/\.xlsx$/i.test(file.name))raw=await readXlsxRows(file);
    else if(/\.csv$/i.test(file.name)){
     const result=await readCsvFile(file,String(data.get('encoding')||'auto'));
     raw=csvRows(result.text);detectedEncoding=result.encodingLabel;
    }
    else throw Error('รองรับไฟล์ .xlsx หรือ .csv เท่านั้น');
    filename=file.name;
   }else{
    const pasted=String(data.get('csv')||'');
    if(pasted.includes('\ufffd'))throw Error('ข้อความที่วางมีอักขระภาษาไทยเสียหาย (�) กรุณาเลือกไฟล์ CSV ต้นฉบับหรือ Excel .xlsx แทน');
    raw=csvRows(pasted);filename='ข้อความ CSV';
   }
   const prepared=prepareRows(raw,typeof rooms==='function'?rooms():rooms);
   rows=prepared.map(x=>x.values);
   preview=prepared.map(x=>({source_row:x.values.source_row,room:x.values.classroom,roll_no:x.values.roll_no,
    student_no:x.values.student_no,full_name:x.values.full_name,username:x.values.username,status:x.status,message:x.message}));
   let checked=0;
   if(prepared.some(x=>x.message)){
    phase=(detectedEncoding?'ตรวจพบรหัสอักขระ '+detectedEncoding+' • ':'')+'พบข้อมูลผิดพลาดภายในไฟล์ กรุณาแก้ไขก่อนนำเข้า';
   }else{
    phase='กำลังตรวจสอบข้อมูลในฐานข้อมูล...';showPreview(container);
    const groups=chunks(rows,100);
    for(const group of groups){
     const result=await api('/api/admin/unified-import/preview',{method:'POST',body:{students:group}});
     for(const x of result.items){
      const target=preview.find(p=>p.source_row===x.source_row);
      if(target){target.status=x.status;target.message=x.message}
     }
     checked+=group.length;
     phase='ตรวจแล้ว '+checked+' / '+rows.length+' คน';showPreview(container);
    }
    phase=(detectedEncoding?'ตรวจพบรหัสอักขระ '+detectedEncoding+' • ':'')+(preview.some(x=>x.status==='error')?'พบรายการที่ต้องแก้ไข ไม่สามารถเริ่มบันทึกได้':
     'ตรวจสอบครบทั้งไฟล์แล้ว พร้อมนำเข้า '+rows.length+' คน');
   }
  }catch(e){rows=[];preview=[];phase=e.message;}
  finally{busy=false;if(button?.isConnected)button.disabled=false;showPreview(container)}
 }
 async function commit(container){
  if(busy||!preview.length||preview.some(x=>x.status!=='ready'))return;
  if(!confirm('ยืนยันนำเข้านักเรียนและบัญชี '+rows.length+' คนจากทุกห้องที่ระบุในไฟล์? ระบบจะทยอยบันทึกเป็นชุดย่อย'))return;
  busy=true;stopped=false;let imported=0;
  const btn=container.querySelector('#unifiedCommit'),cancel=container.querySelector('#unifiedCancel');
  if(btn)btn.disabled=true;if(cancel)cancel.hidden=false;
  try{
   for(const group of chunks(rows,10)){
    if(stopped)break;
    const result=await api('/api/admin/unified-import/commit',{method:'POST',body:{students:group}});
    imported+=result.imported;
    for(const x of result.items){
     const target=preview.find(p=>p.source_row===x.source_row);
     if(target){target.status='imported';target.message='นำเข้าสำเร็จ'}
    }
    phase='นำเข้าสำเร็จ '+imported+' / '+rows.length+' คน';
    showPreview(container);
   }
   if(imported===rows.length){
    rows=[];phase='นำเข้าครบ '+imported+' คนแล้ว (บัญชีพร้อมใช้งาน)';
    await onSuccess?.();
   }else{rows=[];phase='หยุดการนำเข้าหลังบันทึก '+imported+' คน กรุณาตรวจรายชื่อก่อนเริ่มไฟล์ใหม่';}
  }catch(e){
   rows=[];phase='การนำเข้าหยุดหลังบันทึก '+imported+' คน: '+e.message+
     ' — ชุดที่บันทึกแล้วจะยังอยู่ กรุณาตรวจรายชื่อในระบบก่อนนำเข้าไฟล์อีกครั้ง';
  }finally{busy=false;if(cancel?.isConnected)cancel.hidden=true;showPreview(container)}
 }
 function render(container){
  if(!container)return;
  container.innerHTML=`<section class="card stack"><h3>นำเข้านักเรียนและบัญชีจากทุกห้องในไฟล์เดียว</h3>
   <p class="muted">ไฟล์มาตรฐาน 6 คอลัมน์: classroom,roll_no,student_no,full_name,username,password • ไม่ต้องเลือกห้องเรียน • รองรับรายชื่อจำนวนมาก โดยระบบแบ่งชุดนำเข้าอัตโนมัติ</p>
   <p class="row" style="flex-wrap:wrap"><button type="button" class="button secondary" id="downloadUnifiedExcel">ดาวน์โหลดไฟล์ตัวอย่าง Excel (.xlsx) ฟอนต์ไทยที่แก้ไขแล้ว</button> <a href="./templates/student-all-rooms-import.csv" download>ดาวน์โหลดตัวอย่าง CSV (.csv)</a></p>
   <form id="unifiedForm" class="stack">
     <div class="field"><label>เลือกไฟล์ Excel .xlsx หรือ CSV .csv</label><input name="file" type="file" accept=".xlsx,.csv,text/csv"></div>
     <div class="field"><label>รหัสภาษาไทยของไฟล์ CSV</label><select name="encoding">
      <option value="auto">ตรวจจับอัตโนมัติ (แนะนำ)</option>
      <option value="utf-8">UTF-8 (CSV UTF-8)</option>
      <option value="windows-874">Windows-874 / TIS-620 (CSV จาก Excel รุ่นเก่า)</option>
     </select></div>
     <div class="field"><label>หรือวาง CSV ตามรูปแบบไฟล์ตัวอย่าง</label>
      <textarea name="csv" rows="3" placeholder="classroom,roll_no,student_no,full_name,username,password"></textarea></div>
     <p class="muted">ระบุห้องเรียนตรงกับที่มีในระบบ เช่น ม.1/1 และ ม.2/3 • รหัสนักเรียนและ Username ที่มี 0 นำหน้า ให้ตั้งคอลัมน์ Excel เป็น Text</p>
     <p class="muted">ไฟล์ CSV ที่บันทึกจาก Excel บางเครื่องใช้รหัสภาษาไทย Windows-874/TIS-620 ระบบจะอ่านให้อัตโนมัติ หากชื่อกลายเป็น � ให้ใช้ไฟล์ต้นฉบับหรือบันทึกใหม่เป็น CSV UTF-8</p>
     <p class="warn">Password ขั้นต่ำ 4 ตัวตามที่ตั้งค่าไว้ แต่ควรใช้รหัสผ่านยาวและไม่ซ้ำ ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน และโปรดเก็บไฟล์รหัสผ่านเป็นความลับ</p>
     <button class="button full" id="unifiedPreviewButton" type="submit">ตรวจสอบทั้งไฟล์ก่อนนำเข้า</button>
   </form>
   <div id="unifiedStatus" class="muted" role="status" aria-live="polite"></div>
   <div id="unifiedPreview"></div>
   <button type="button" class="button full" id="unifiedCommit" hidden>ยืนยันนำเข้าทั้งหมด</button>
   <button type="button" class="button secondary" id="unifiedCancel" hidden>หยุดหลังจบชุดปัจจุบัน</button>
   <p class="muted">ระบบแบ่งการบันทึกเป็นชุดละ 10 คนเพื่อความเสถียร แต่ละชุดบันทึกแบบครบหรือไม่บันทึกเลย หากเกิดข้อผิดพลาดระหว่างทาง รายการที่สำเร็จแล้วจะไม่ถูกย้อนกลับทั้งไฟล์</p>
   <p class="warn">ใช้เฉพาะข้อมูลจำลองในฐาน Dev ก่อนผ่านการทบทวน PDPA และขั้นตอนเปิดระบบจริง</p>
  </section>`;
  container.querySelector('#downloadUnifiedExcel').addEventListener('click',downloadStudentExampleXlsx);
  container.querySelector('#unifiedForm').addEventListener('submit',e=>{e.preventDefault();preflight(container)});
  container.querySelector('#unifiedCommit').addEventListener('click',()=>commit(container));
  container.querySelector('#unifiedCancel').addEventListener('click',()=>{stopped=true;phase='กำลังหยุดหลังจบชุดที่ทำอยู่...';showPreview(container)});
  showPreview(container);
 }
 function clear(){rows=[];preview=[];filename='';completed=0;phase='';stopped=true}
 return {render,clear};
}
