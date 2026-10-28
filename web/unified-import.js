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
export function prepareRows(raw,rooms,{rosterOnly=false}={}){
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
  else if(!rosterOnly&&values.username&&!/^[a-z0-9._-]{3,40}$/i.test(values.username))message='Username ไม่ถูกต้อง';
  else if(!rosterOnly&&values.password&&(values.password.length<4||values.password.length>128))message='Password ต้องยาว 4–128 ตัว';
  else if(!rosterOnly&&/^\d{13}$/.test(values.password))message='ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน';
  else if(ids.has(key)||(!rosterOnly&&names.has(uname))||rolls.has(rollkey))message='ข้อมูลซ้ำในไฟล์ (รหัสนักเรียน / Username / เลขที่ในห้อง)';
  if(!message){ids.add(key);if(uname&&!rosterOnly)names.add(uname);rolls.add(rollkey)}
  return {values,message,status:message?'error':'ready'};
 });
 if(!records.length)throw Error('ไม่มีรายชื่อนักเรียนหลังหัวตาราง');
 return records;
}
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
// The selected Excel/CSV file can be large; transport uses small, bounded requests.
export const ROSTER_PREVIEW_CHUNK=25;
export const ROSTER_COMMIT_CHUNK=1;
const ROSTER_VIEW_PAGE_SIZE=80;
export function createUnifiedImport({api,rooms,onSuccess,onOpenConflict}){
 let rows=[],preview=[],filename='',busy=false,stopped=false,phase='',detectedEncoding='';
 let previewPage=1,previewFilter='all';
 const conflictHtml=x=>{
  const student=x.conflict_student;
  if(!student)return '';
  const label=student.archived?'เก็บเป็นประวัติ':student.active?'ใช้งาน':'พักข้อมูล';
  return '<div class="rd-import-conflict-detail">ข้อมูลที่ครองเลขที่นี้: <strong>'+esc(student.full_name||'(ไม่ระบุชื่อ)')+
    '</strong> • รหัส '+esc(student.student_no)+' • '+label+
    (student.archived?
      ' <button type="button" class="button secondary" data-release-archived="'+Number(student.id)+'">ตรวจสอบและปลดเลขที่</button>':
     onOpenConflict?
      ' <button type="button" class="button secondary" data-conflict-student="'+Number(student.id)+
      '" data-conflict-room="'+Number(student.classroom_id)+'">ตรวจข้อมูลเดิมในทะเบียน</button>':'')+'</div>';
 };
 function showPreview(container){
  const place=container.querySelector('#unifiedPreview');if(!place)return;
  const skipped=preview.filter(x=>['error','skipped','uncertain'].includes(x.status)).length;
  const added=preview.filter(x=>x.status==='imported').length;
  const updated=preview.filter(x=>x.status==='updated').length;
  const pending=preview.filter(x=>['ready','update','uncertain'].includes(x.status)).length;
  const filtered=previewFilter==='issues'?
    preview.filter(x=>['error','skipped','uncertain'].includes(x.status)):preview;
  const pages=Math.max(1,Math.ceil(filtered.length/ROSTER_VIEW_PAGE_SIZE));
  previewPage=Math.max(1,Math.min(previewPage,pages));
  const visible=filtered.slice((previewPage-1)*ROSTER_VIEW_PAGE_SIZE,previewPage*ROSTER_VIEW_PAGE_SIZE);
  place.innerHTML=preview.length?`<p class="summary"><strong>${esc(filename)}</strong>: ${preview.length} แถว • เพิ่มแล้ว ${added} • อัปเดตแล้ว ${updated} • ข้าม/ต้องตรวจ ${skipped} • รอดำเนินการ ${pending}</p>
   <div class="row rd-import-controls">
    <button type="button" class="button secondary" id="unifiedAllRows" aria-pressed="${previewFilter==='all'}">ทุกแถว</button>
    <button type="button" class="button secondary" id="unifiedIssueRows" aria-pressed="${previewFilter==='issues'}">เฉพาะแถวมีปัญหา (${skipped})</button>
    <span class="muted">แสดง ${filtered.length?((previewPage-1)*ROSTER_VIEW_PAGE_SIZE+1):0}–${Math.min(previewPage*ROSTER_VIEW_PAGE_SIZE,filtered.length)} จาก ${filtered.length} แถว</span>
    <button type="button" class="button secondary" id="unifiedPrevPage" ${previewPage===1?'disabled':''}>ก่อนหน้า</button>
    <button type="button" class="button secondary" id="unifiedNextPage" ${previewPage===pages?'disabled':''}>ถัดไป</button>
   </div>
   <div class="table-wrap rd-import-table-scroll"><table class="table">
    <thead><tr><th>แถว</th><th>ห้อง</th><th>เลขที่</th><th>รหัสนักเรียน</th><th>ชื่อ</th><th>Username</th><th>ผลตรวจ / เหตุผลข้าม</th></tr></thead>
    <tbody>${visible.map(x=>`<tr><td>${x.source_row}</td><td>${esc(x.room)}</td><td>${x.roll_no}</td><td>${esc(x.student_no)}</td>
      <td>${esc(x.full_name)}</td><td>${esc(x.username)}</td>
      <td class="${['error','skipped','uncertain'].includes(x.status)?'import-error':['imported','updated'].includes(x.status)?'import-success':''}">
      ${esc(x.message||(x.status==='update'?'พบข้อมูลเดิม • เตรียมอัปเดต':'พร้อมเพิ่ม'))}${conflictHtml(x)}</td></tr>`).join('')}</tbody></table></div>`:'';
  place.querySelectorAll('[data-release-archived]').forEach(button=>button.addEventListener('click',async()=>{
   if(busy)return;
   const studentId=Number(button.dataset.releaseArchived);
   const identity='archived-student-'+studentId;
   const entered=window.prompt(
    'ตรวจสอบก่อนปลดเลขที่ของ '+identity+'\\nระบบจะปฏิเสธหากมีประวัติการมาเรียน คะแนน การย้ายห้อง หรือข้อมูลเชื่อมโยงอื่น\\nหากเป็นรายการที่ถอนออกแล้วและไม่มีประวัติ พิมพ์ '+identity+' เพื่อยืนยัน:',
    ''
   );
   if(entered===null)return;
   if(entered!==identity){phase='ยกเลิกการปลดเลขที่: ข้อความยืนยันไม่ตรง';showPreview(container);return}
   busy=true;button.disabled=true;
   try{
    await api('/api/admin/archived-students/'+studentId+'/release-roll',{
     method:'POST',body:{confirm:identity},timeoutMs:20000
    });
    // Keep the original chosen file and run authoritative preflight again.
    // This prevents committing a stale validation result after freeing the roll.
    busy=false;
    phase='ปลดเลขที่สำเร็จ กำลังตรวจสอบไฟล์ซ้ำจากฐานข้อมูลจริง...';
    showPreview(container);
    await preflight(container);
   }catch(e){
    busy=false;
    phase='ยังไม่ปลดเลขที่: '+e.message+' • หากมีประวัติเก่าระบบจะป้องกันการลบไว้';
    showPreview(container);
   }
  }));
  place.querySelectorAll('[data-conflict-student]').forEach(button=>button.addEventListener('click',()=>{
   if(!onOpenConflict)return;
   if(!confirm('เปิดทะเบียนเพื่อเทียบข้อมูลเดิม? หน้า Preview ที่ยังไม่บันทึกจะถูกปิด และต้องเลือกไฟล์ตรวจสอบใหม่ภายหลัง'))return;
   Promise.resolve(onOpenConflict(Number(button.dataset.conflictStudent),Number(button.dataset.conflictRoom)))
    .catch(e=>{phase='เปิดทะเบียนไม่สำเร็จ: '+e.message;showPreview(container)});
  }));
  place.querySelector('#unifiedAllRows')?.addEventListener('click',()=>{previewFilter='all';previewPage=1;showPreview(container)});
  place.querySelector('#unifiedIssueRows')?.addEventListener('click',()=>{previewFilter='issues';previewPage=1;showPreview(container)});
  place.querySelector('#unifiedPrevPage')?.addEventListener('click',()=>{previewPage--;showPreview(container)});
  place.querySelector('#unifiedNextPage')?.addEventListener('click',()=>{previewPage++;showPreview(container)});
  const button=container.querySelector('#unifiedCommit');
  if(button){
   button.hidden=!pending;
   button.disabled=busy||!pending;
   button.textContent='นำเข้าหรือดำเนินการต่อ '+pending+' รายการ';
  }
  const status=container.querySelector('#unifiedStatus');
  if(status)status.textContent=phase;
 }

 async function preflight(container){
  if(busy)return;
  busy=true;rows=[];preview=[];previewPage=1;previewFilter='all';detectedEncoding='';
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
   const accountMode=container.querySelector('#unifiedRosterOnly')?.checked?'roster_only':'with_accounts';
   const prepared=prepareRows(raw,typeof rooms==='function'?rooms():rooms,{rosterOnly:accountMode==='roster_only'});
   rows=prepared.map(x=>x.values);
   preview=prepared.map(x=>({source_row:x.values.source_row,room:x.values.classroom,roll_no:x.values.roll_no,
    student_no:x.values.student_no,full_name:x.values.full_name,username:x.values.username,status:x.status,message:x.message}));
   let checked=0;
   const allowed=prepared.filter(x=>!x.message).map(x=>x.values);
   phase='กำลังตรวจสอบรายการที่รูปแบบถูกต้องในฐานข้อมูล...';showPreview(container);
   for(const group of chunks(allowed,ROSTER_PREVIEW_CHUNK)){
    const result=await api('/api/admin/unified-import/preview',{method:'POST',body:{students:group,account_mode:accountMode},timeoutMs:30000});
    for(const x of result.items){
     const target=preview.find(p=>p.source_row===x.source_row);
     if(target){target.status=x.status;target.message=x.message;target.conflict_student=x.conflict_student||null}
    }
    checked+=group.length;
    phase='ตรวจแล้ว '+checked+' / '+allowed.length+' คน';showPreview(container);
   }
   const valid=preview.filter(x=>['ready','update'].includes(x.status)).length;
   const skip=preview.length-valid;
   phase=(detectedEncoding?'รหัสอักขระ '+detectedEncoding+' • ':'')+
    (accountMode==='roster_only'?'โหมดทะเบียนอย่างเดียว (ไม่สร้าง/แก้ไขบัญชี) • ':'โหมดรวมบัญชีนักเรียน • ')+
    'พร้อมเพิ่ม/อัปเดต '+valid+' • ข้ามข้อมูลผิดพลาด '+skip+' (ดูรายละเอียดรายแถว)';

  }catch(e){rows=[];preview=[];phase='ตรวจสอบไฟล์ไม่สำเร็จ: '+e.message+' • ยังไม่มีการบันทึกข้อมูล';}
  finally{busy=false;if(button?.isConnected)button.disabled=false;showPreview(container)}
 }
 async function commit(container){
  if(busy)return;
  const selected=rows.filter(x=>['ready','update','uncertain'].includes(
   preview.find(p=>p.source_row===x.source_row)?.status));
  if(!selected.length)return;
  const invalid=preview.filter(x=>x.status==='error').length;
  const accountMode=container.querySelector('#unifiedRosterOnly')?.checked?'roster_only':'with_accounts';
  const modeNotice=accountMode==='roster_only'?'โหมดทะเบียนอย่างเดียว: จะไม่สร้างบัญชีและไม่เปลี่ยน Username/Password':'โหมดรวมบัญชีนักเรียน: มีการประมวลผลรหัสผ่านซึ่งอาจเกินข้อจำกัด CPU ของ Worker Free';
  if(!confirm('ยืนยันนำเข้า/อัปเดต '+selected.length+' คน?\n'+modeNotice+'\nรายการที่รูปแบบผิดพลาดจะข้าม '+invalid+' แถว'))return;
  busy=true;stopped=false;
  // A 502 from Pages indicates that the Worker did not return normally.
  // Check the authenticated schema probe before writing, rather than
  // repeatedly submitting uncertain student updates to a broken backend.
  phase='ตรวจสอบการเชื่อมต่อ Worker และโครงสร้างฐานข้อมูลก่อนนำเข้า...';
  showPreview(container);
  try{
   const health=await api('/api/admin/unified-import/health',{timeoutMs:15000});
   if(!health.ok)throw Error('ระบบนำเข้ายังไม่พร้อม: '+(health.issues||[]).join(', '));
  }catch(e){
   const trace=e.requestId?' (รหัสตรวจสอบ '+e.requestId+')':'';
   phase='ยังไม่เริ่มบันทึก: ตรวจสอบ API ไม่ผ่าน'+(e.httpStatus?' HTTP '+e.httpStatus:'')+
    ' • '+e.message+trace+' • โปรดตรวจ Cloudflare Worker Logs / Service Binding';
   busy=false;showPreview(container);return;
  }
  const btn=container.querySelector('#unifiedCommit'),cancel=container.querySelector('#unifiedCancel');
  if(btn)btn.disabled=true;if(cancel)cancel.hidden=false;
  let completed=0,consecutiveErrors=0,pausedDueToServer=false;
  try{
   for(const group of chunks(selected,ROSTER_COMMIT_CHUNK)){
    if(stopped)break;
    try{
     const result=await api('/api/admin/unified-import/commit',{
      method:'POST',body:{students:group,account_mode:accountMode},timeoutMs:30000
     });
     for(const entry of result.items||[]){
      const p=preview.find(item=>item.source_row===entry.source_row);
      if(p){p.status=entry.status;p.message=entry.message;p.conflict_student=entry.conflict_student||null}
     }
     completed+=group.length;consecutiveErrors=0;
    }catch(e){
     consecutiveErrors++;
     for(const item of group){
      const p=preview.find(entry=>entry.source_row===item.source_row);
      if(p){p.status='uncertain';p.message='ยังไม่ยืนยันผลจากเซิร์ฟเวอร์'+(e.httpStatus?' HTTP '+e.httpStatus:'')+': '+e.message+
       (e.requestId?' • รหัสตรวจสอบ '+e.requestId:'')+
       ' • ระบบจะตรวจข้อมูลเดิมก่อนบันทึกซ้ำเมื่อกดดำเนินการต่อ'}
     }
     if([500,502,503,504].includes(e.httpStatus)||consecutiveErrors>=3){
      pausedDueToServer=true;
      // Stop on first 5xx: repeated writes make diagnosis difficult and
      // may make a request's commit result uncertain.
      break;
     }
    }
    if(completed%10===0||completed===selected.length||consecutiveErrors){
     const added=preview.filter(x=>x.status==='imported').length;
     const updated=preview.filter(x=>x.status==='updated').length;
     const invalidNow=preview.filter(x=>['error','skipped'].includes(x.status)).length;
     phase='ประมวลผล '+completed+' / '+selected.length+
      ' • เพิ่ม '+added+' • อัปเดต '+updated+' • ข้าม '+invalidNow;
     showPreview(container);
    }
   }
   const added=preview.filter(x=>x.status==='imported').length;
   const updated=preview.filter(x=>x.status==='updated').length;
   const skipped=preview.filter(x=>['error','skipped'].includes(x.status)).length;
   const uncertain=preview.filter(x=>x.status==='uncertain').length;
   const pending=preview.filter(x=>['ready','update'].includes(x.status)).length;
   if(completed===selected.length&&uncertain===0){
    // Do not retain source passwords in memory after a completed import.
    rows=[];
    phase='เสร็จสิ้น • เพิ่ม '+added+' • อัปเดต '+updated+' • ข้าม '+skipped+
     ' รายการ (ดูเหตุผลในตาราง)';
    // Refresh school rosters only once after the entire file is processed.
    await onSuccess?.();
   }else phase=(pausedDueToServer?'หยุดหลังพบข้อผิดพลาด Worker/Pages • ':'ดำเนินการแล้วบางส่วน • ')+
      'เพิ่ม '+added+' • อัปเดต '+updated+
      ' • ข้าม '+skipped+' • รอดำเนินการ/ตรวจสอบ '+(pending+uncertain)+
      (pausedDueToServer&&accountMode==='with_accounts'?' • หากเกิด 502 ซ้ำ แนะนำเลือกโหมดทะเบียนอย่างเดียวแล้วตรวจสอบไฟล์ใหม่ (ไม่สร้างบัญชี)':' • ตรวจ Worker Logs หากเกิด HTTP 502 แล้วค่อยดำเนินการต่อ');
  }finally{busy=false;if(cancel?.isConnected)cancel.hidden=true;showPreview(container)}
 }

 function render(container){
  if(!container)return;
  container.innerHTML=`<section class="card stack"><h3>นำเข้านักเรียนและบัญชีจากทุกห้องในไฟล์เดียว</h3>
   <p class="muted">ไฟล์มาตรฐาน 6 คอลัมน์: classroom,roll_no,student_no,full_name,username,password • ใช้รหัสนักเรียนอัปเดตข้อมูลเดิมในห้องเดิมได้ทันที • แถวผิดพลาดจะข้ามและแสดงเหตุผล</p>
   <p class="row rd-import-file-links"><button type="button" class="button secondary" id="downloadUnifiedExcel">ดาวน์โหลดไฟล์ตัวอย่าง Excel (.xlsx) ฟอนต์ไทยที่แก้ไขแล้ว</button> <a href="./templates/student-all-rooms-import.csv" download>ดาวน์โหลดตัวอย่าง CSV UTF-8 สำหรับ Excel (.csv)</a></p>
   <form id="unifiedForm" class="stack">
     <div class="field"><label>เลือกไฟล์ Excel .xlsx หรือ CSV .csv</label><input name="file" type="file" accept=".xlsx,.csv,text/csv"></div>
     <div class="field"><label>รหัสภาษาไทยของไฟล์ CSV</label><select name="encoding">
      <option value="auto">ตรวจจับอัตโนมัติ (แนะนำ)</option>
      <option value="utf-8">UTF-8 (CSV UTF-8)</option>
      <option value="windows-874">Windows-874 / TIS-620 (CSV จาก Excel รุ่นเก่า)</option>
     </select></div>
     <div class="field"><label>หรือวาง CSV ตามรูปแบบไฟล์ตัวอย่าง</label>
      <textarea name="csv" rows="3" placeholder="classroom,roll_no,student_no,full_name,username,password"></textarea></div>
     <p class="muted">ระบุห้องเรียนตรงกับที่มีในระบบ เช่น ม.1/1 และ ม.2/3 • รหัสนักเรียนและ Username ที่มี 0 นำหน้า ให้ตั้งคอลัมน์ Excel เป็น Text • บัญชีเดิมเว้น Password ว่างได้ • เปลี่ยนห้องต้องใช้เมนูย้ายห้อง</p>
     <p class="muted">ไฟล์ CSV ที่บันทึกจาก Excel บางเครื่องใช้รหัสภาษาไทย Windows-874/TIS-620 ระบบจะอ่านให้อัตโนมัติ หากชื่อกลายเป็น � ให้ใช้ไฟล์ต้นฉบับหรือบันทึกใหม่เป็น CSV UTF-8</p>
     <p class="warn">Password ขั้นต่ำ 4 ตัวตามที่ตั้งค่าไว้ แต่ควรใช้รหัสผ่านยาวและไม่ซ้ำ ห้ามใช้เลขประจำตัวประชาชนเป็นรหัสผ่าน และโปรดเก็บไฟล์รหัสผ่านเป็นความลับ</p>
     <button class="button full" id="unifiedPreviewButton" type="submit">ตรวจสอบทั้งไฟล์ก่อนนำเข้า</button>
   </form>
   <div id="unifiedStatus" class="muted" role="status" aria-live="polite"></div>
   <div id="unifiedPreview"></div>
   <label class="row rd-import-account-mode"><input type="checkbox" id="unifiedRosterOnly" checked>
    <span><strong>โหมดเสถียร (แนะนำ): นำเข้าทะเบียนนักเรียนอย่างเดียว</strong>
     <span class="muted">เลือกไว้เป็นค่าเริ่มต้น: ระบบเพิ่ม/อัปเดตทะเบียนเท่านั้น ไม่สร้างบัญชี ไม่เปลี่ยน Username/Password • เอาเครื่องหมายออกเฉพาะเมื่อต้องการนำเข้าบัญชีด้วย (ใช้ CPU เพิ่ม)</span></span>
   </label>
   <button type="button" class="button secondary" id="unifiedCheckApi">ตรวจสอบการเชื่อมต่อ Worker/D1</button>
   <button type="button" class="button full" id="unifiedCommit" hidden>ยืนยันนำเข้าทั้งหมด</button>
   <button type="button" class="button secondary" id="unifiedCancel" hidden>หยุดหลังจบชุดปัจจุบัน</button>
   <p class="muted">เลือกไฟล์ได้ทั้งโรงเรียน (เช่น 1,750 คน) ระบบแบ่งตรวจครั้งละ 25 คน และบันทึกทีละคน เพื่อลดข้อผิดพลาด Cloudflare D1 โดยแยกธุรกรรม หากแถวใดผิดพลาดจะข้ามเฉพาะแถวนั้น ไม่ยกเลิกรายการอื่น และแสดงจำนวนเพิ่ม/อัปเดต/ข้าม</p>
   <p class="warn">ก่อนนำเข้า โปรดตรวจสอบความถูกต้องของข้อมูล สิทธิ์ผู้ใช้งาน และข้อกำหนด PDPA ของโรงเรียน</p>
  </section>`;
  container.querySelector('#downloadUnifiedExcel').addEventListener('click',downloadStudentExampleXlsx);
  container.querySelector('#unifiedForm').addEventListener('submit',e=>{e.preventDefault();preflight(container)});
  container.querySelector('#unifiedCheckApi').addEventListener('click',async()=>{
   if(busy)return;
   busy=true;phase='กำลังตรวจสอบ Worker และฐานข้อมูล...';showPreview(container);
   try{
    const result=await api('/api/admin/unified-import/health',{timeoutMs:15000});
    phase=result.ok?'Worker/D1 พร้อมนำเข้า • จำกัดการบันทึกทีละ 1 คน':
     'พบข้อผิดพลาดฐานข้อมูล: '+(result.issues||[]).join(', ');
   }catch(e){
    phase='การตรวจสอบไม่สำเร็จ'+(e.httpStatus?' HTTP '+e.httpStatus:'')+
     ' • '+e.message+(e.requestId?' • รหัสตรวจสอบ '+e.requestId:'')+
     ' • โปรดตรวจ Cloudflare Logs';
   }finally{busy=false;showPreview(container)}
  });
  container.querySelector('#unifiedCommit').addEventListener('click',()=>commit(container));
  container.querySelector('#unifiedRosterOnly')?.addEventListener('change',()=>{
   if(!preview.length||busy)return;
   // A change of import mode alters validation (especially for credentials).
   // Never commit stale results from a previous preview mode.
   rows=[];preview=[];previewPage=1;
   phase='เปลี่ยนโหมดนำเข้าแล้ว • กรุณากดตรวจสอบทั้งไฟล์อีกครั้งก่อนนำเข้า (ไฟล์ที่เลือกยังอยู่)';
   showPreview(container);
  });
  container.querySelector('#unifiedCancel').addEventListener('click',()=>{stopped=true;phase='กำลังหยุดหลังจบชุดที่ทำอยู่...';showPreview(container)});
  showPreview(container);
 }
 function clear(){rows=[];preview=[];filename='';phase='';stopped=true}
 return {render,clear};
}
