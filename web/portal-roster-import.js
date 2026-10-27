import {readXlsxRows} from './xlsx-reader.js';
import {downloadPortalAccountExampleXlsx} from './template-xlsx.js';
import {readCsvFile} from './csv-encoding.js';
import {csvRows} from './unified-import.js';

const HEADERS=['student_no','full_name','student_username','student_password',
 'guardian_name','guardian_username','guardian_password'];
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function preparePortalRoster(raw){
 if(!Array.isArray(raw)||!raw.length)throw Error('ไฟล์ว่าง');
 const headers=raw[0].map(x=>String(x??'').trim().toLowerCase().replace(/^\uFEFF/,''));
 if(headers.join(',')!==HEADERS.join(','))
  throw Error('หัวตารางต้องเป็น '+HEADERS.join(','));
 const seen=new Set(),names=new Map(),guardians=new Map(),items=[],errors=[];
 for(let i=1;i<raw.length;i++){
  const row=raw[i];if(!row||!row.some(x=>String(x??'').trim()))continue;
  const r=Object.fromEntries(HEADERS.map((key,k)=>[key,String(row[k]??'')]));
  for(const key of HEADERS.filter(k=>!k.endsWith('_password')))
   r[key]=r[key].trim();
  r.student_username=r.student_username.toLowerCase();
  r.guardian_username=r.guardian_username.toLowerCase();
  const index=Number(row.source_row)||i+1,key=r.student_no.toLowerCase();
  let error='';
  if(row.length!==7)error='ต้องมี 7 คอลัมน์';
  else if(!r.student_no||r.student_no.length>40)error='เลขประจำตัวนักเรียนไม่ถูกต้อง';
  else if(seen.has(key))error='เลขประจำตัวนักเรียนซ้ำภายในไฟล์';
  else if(r.full_name.length>100||/[\u0000-\u001f\u007f]/.test(r.full_name))error='ชื่อนักเรียนไม่ถูกต้อง';
  else if(r.student_username&&!/^[a-z0-9._-]{3,40}$/.test(r.student_username))error='Username นักเรียนไม่ถูกต้อง';
  else if(r.guardian_username&&!/^[a-z0-9._-]{3,40}$/.test(r.guardian_username))error='Username ผู้ปกครองไม่ถูกต้อง';
  else if(!r.guardian_username&&(r.guardian_name||r.guardian_password))
   error='ต้องระบุ Username ผู้ปกครอง';
  else if(r.guardian_username&&(!r.guardian_name||r.guardian_name.length>100))
   error='ต้องระบุชื่อผู้ปกครอง';
  else if(r.student_password&&(r.student_password.length<4||r.student_password.length>128||/^\d{13}$/.test(r.student_password)))
   error='รหัสผ่านนักเรียน 4–128 ตัว ไม่ใช้เลขบัตรประชาชน';
  else if(r.guardian_password&&(r.guardian_password.length<4||r.guardian_password.length>128||/^\d{13}$/.test(r.guardian_password)))
   error='รหัสผ่านผู้ปกครอง 4–128 ตัว ไม่ใช้เลขบัตรประชาชน';
  const registeredGuardian=guardians.get(r.guardian_username);
  if(!error&&registeredGuardian&&
   ((r.guardian_name&&registeredGuardian.name&&r.guardian_name!==registeredGuardian.name)||
   (r.guardian_password&&registeredGuardian.password&&r.guardian_password!==registeredGuardian.password)))
   error='ข้อมูลผู้ปกครอง Username เดียวกันไม่ตรงกันระหว่างแถว';
  const studentName=r.student_username||key;
  const prior=names.get(studentName);
  if(!error&&prior&&(prior.role!=='student'||prior.no!==key))error='Username นักเรียนซ้ำกับบัญชีอื่น';
  if(!error&&r.guardian_username&&(r.guardian_username===studentName||
     names.get(r.guardian_username)?.role==='student'))error='Username ผู้ปกครองซ้ำกับนักเรียน';
  if(!error){
   seen.add(key);
   names.set(studentName,{role:'student',no:key});
   if(r.guardian_username){
    names.set(r.guardian_username,{role:'guardian'});
    if(!registeredGuardian)guardians.set(r.guardian_username,
     {name:r.guardian_name,password:r.guardian_password});
    else if(!registeredGuardian.password&&r.guardian_password)
     registeredGuardian.password=r.guardian_password;
   }
   items.push({...r,source_row:index});
  }else errors.push({source_row:index,student_no:r.student_no,message:error});
 }
 if(!items.length&&!errors.length)throw Error('ไม่มีรายการหลังหัวตาราง');
 return {items,errors};
}
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
export function createPortalRosterImport({api,toast,onComplete}){
 let items=[],errors=[],fileName='',running=false,stop=false,count=0,results=[];
 const $=selector=>document.querySelector(selector);
 function update(){
  const summary=$('#portalRosterStatus');
  if(summary)summary.textContent=items.length?
   'ไฟล์ '+fileName+' • ตรวจแล้ว '+(items.length+errors.length)+' แถว • ถูกต้อง '+items.length+
    ' • ผิดพลาด '+errors.length+' • นำเข้าแล้ว '+count:'เลือกไฟล์ CSV หรือ Excel เพื่อเริ่ม';
  const err=$('#portalRosterErrors');
  if(err)err.innerHTML=errors.length?
   '<strong>รายการต้องแก้ไขก่อนนำเข้า:</strong><ol>'+
    errors.slice(0,50).map(e=>'<li>แถว '+e.source_row+' ('+esc(e.student_no)+'): '+esc(e.message)+'</li>').join('')+
    '</ol>'+(errors.length>50?'<p>ยังมีข้อผิดพลาดอีก '+(errors.length-50)+' รายการ</p>':''):'';
  const progress=$('#portalRosterProgress');
  if(progress)progress.textContent=running?'กำลังนำเข้า '+count+' / '+items.length+
   ' รายการ — ระบบทำงานเป็นชุดย่อยอัตโนมัติ':
   count?'เสร็จสิ้น '+count+' / '+items.length+' รายการ':'';
  const button=$('#portalRosterCommit');
  if(button)button.disabled=running||!items.length||!!errors.length||count>0;
  const preview=$('#portalRosterPreview');
  if(preview)preview.innerHTML=items.length?
   '<p>แสดงตัวอย่าง '+Math.min(items.length,20)+' จาก '+items.length+' รายการ (ไม่แสดงรหัสผ่าน)</p>'+
   '<div class="table-wrap"><table class="table"><thead><tr><th>เลขประจำตัว</th><th>นักเรียน</th><th>บัญชีนักเรียน</th><th>ผู้ปกครอง</th></tr></thead><tbody>'+
   items.slice(0,20).map(r=>'<tr><td>'+esc(r.student_no)+'</td><td>'+esc(r.full_name)+'</td><td>'+
    esc(r.student_username||r.student_no)+'</td><td>'+esc(r.guardian_username)+'</td></tr>').join('')+
   '</tbody></table></div>':'';
 }
 async function readFile(file,encoding){
  if(!file?.size)throw Error('กรุณาเลือกไฟล์');
  if(file.size>8_000_000)throw Error('ไฟล์ใหญ่เกิน 8 MB กรุณาแบ่งเป็นไฟล์ย่อย (จำนวนแถวไม่จำกัดโดยระบบ)');
  if(/\.xlsx$/i.test(file.name))return readXlsxRows(file);
  if(/\.csv$/i.test(file.name))return csvRows((await readCsvFile(file,encoding)).text);
  throw Error('รองรับ Excel .xlsx หรือ CSV .csv');
 }
 async function preview(e){
  e.preventDefault();
  if(running)return;
  const form=e.currentTarget,file=form.querySelector('input[type="file"]').files?.[0];
  items=[];errors=[];count=0;results=[];fileName=file?.name||'';
  try{
   const raw=await readFile(file,String(new FormData(form).get('encoding')||'auto'));
   ({items,errors}=preparePortalRoster(raw));
  }catch(err){errors=[{source_row:0,student_no:'-',message:err.message}]}
  update();
 }
 async function commit(){
  if(running||!items.length||errors.length)return;
  const verified=$('#portalRosterVerified')?.checked===true;
  if(items.some(r=>r.guardian_username)&&!verified)
   throw Error('ต้องตรวจสอบตัวตนและความสัมพันธ์ก่อนเชื่อมบัญชีผู้ปกครอง');
  if(!confirm('ยืนยันนำเข้าหรืออัปเดตบัญชี '+items.length+' แถว? หากระบุรหัสผ่านใหม่ บัญชีเดิมจะถูกตั้งรหัสตามไฟล์'))return;
  running=true;stop=false;count=0;update();
  const cancel=$('#portalRosterStop');if(cancel)cancel.hidden=false;
  try{
   for(const group of chunks(items,5)){
    if(stop)break;
    const r=await api('/api/admin/portal/import',{method:'POST',
     body:{rows:group.map(({source_row,...rest})=>rest),relationships_verified:verified}});
    count+=r.imported;results.push(...(r.items||[]));update();
   }
   if(count===items.length){
    toast('นำเข้า/อัปเดตบัญชีสำเร็จ '+count+' รายการ');
    items=[];errors=[];fileName='';results=[];update();
    await onComplete?.();
   }else toast('นำเข้าแล้ว '+count+' รายการ สามารถเลือกไฟล์เดิมเพื่อนำเข้าอีกครั้งได้');
  }catch(err){
   toast('นำเข้าสำเร็จแล้ว '+count+' รายการ ก่อนพบข้อผิดพลาด: '+err.message);
   if($('#portalRosterProgress'))$('#portalRosterProgress').textContent=
    'หยุดที่รายการ '+(count+1)+' • '+err.message+' • แก้ไขข้อมูลแล้วนำเข้าไฟล์เดิมซ้ำได้';
  }finally{
   running=false;if(cancel)cancel.hidden=true;
   // Do not preserve raw passwords in a persisted preview after a successful import.
   if(count===items.length)items=[];
  }
 }
 function render(container){
  if(!container)return;
  container.innerHTML=`<section class="card stack">
   <h3>นำเข้าบัญชีนักเรียนและผู้ปกครองทั้งโรงเรียน</h3>
   <p class="muted">เลือกไฟล์เดียวได้ทั้งโรงเรียน ไม่จำกัดจำนวนแถวที่ต้องกดนำเข้า • ระบบทยอยบันทึกชุดละ 5 แถว เพื่อความเสถียร
   และอัปเดตบัญชีเดิมโดยจับคู่ <strong>เลขประจำตัวนักเรียน</strong></p>
   <div class="row" style="flex-wrap:wrap;gap:8px">
    <button type="button" id="portalDownloadXlsx" class="button secondary">ดาวน์โหลดตัวอย่าง Excel (.xlsx)</button>
    <a class="button secondary" download href="./templates/portal-accounts-import.csv">ดาวน์โหลดตัวอย่าง CSV (.csv)</a>
   </div>
   <form id="portalRosterForm" class="stack">
    <div class="field"><label>ไฟล์นำเข้า .xlsx หรือ .csv</label>
     <input type="file" name="file" accept=".xlsx,.csv,text/csv" required></div>
    <div class="field"><label>การเข้ารหัสภาษาไทยสำหรับ CSV</label><select name="encoding">
     <option value="auto">ตรวจจับอัตโนมัติ</option><option value="utf-8">UTF-8</option>
     <option value="windows-874">Windows-874 / TIS-620</option></select></div>
    <p class="muted">หัวตาราง: student_no,full_name,student_username,student_password,guardian_name,guardian_username,guardian_password
    • เลขประจำตัวต้องอยู่ในทะเบียนนักเรียนก่อน • ตั้งค่าคอลัมน์เลขประจำตัวเป็น Text เพื่อรักษาเลข 0 นำหน้า</p>
    <p class="muted">บัญชีใหม่ต้องมี Password ในไฟล์ • บัญชีที่มีอยู่แล้วเว้น Password ว่างได้เพื่อรักษารหัสเดิม
    • หากกรอกรหัสใหม่ ระบบจะเปลี่ยนรหัสตามไฟล์ • ไม่บังคับเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งแรก</p>
    <button class="button secondary" type="submit">อ่านและตรวจสอบไฟล์</button>
   </form>
   <div id="portalRosterStatus" role="status" aria-live="polite"></div>
   <div id="portalRosterErrors" class="warn"></div>
   <div id="portalRosterPreview"></div>
   <label class="row"><input type="checkbox" id="portalRosterVerified">
    ยืนยันว่าโรงเรียนตรวจสอบตัวตนและความสัมพันธ์ผู้ปกครองตามเอกสารที่ได้รับก่อนนำเข้า</label>
   <button type="button" class="button full" id="portalRosterCommit" disabled>นำเข้า/อัปเดตทั้งไฟล์</button>
   <button type="button" class="button secondary" id="portalRosterStop" hidden>หยุดหลังจบชุดปัจจุบัน</button>
   <div id="portalRosterProgress" role="status" aria-live="polite"></div>
   <p class="warn">ไฟล์มีรหัสผ่านและข้อมูลผู้เรียน โปรดเก็บไว้ในพื้นที่ปลอดภัย ไม่ส่งเข้ากลุ่มสาธารณะ
    นำเข้าโดยใช้การเชื่อมต่อ HTTPS และตรวจสอบสิทธิ์ Admin ทุกคำขอ</p>
   </section>`;
  container.querySelector('#portalDownloadXlsx')?.addEventListener('click',downloadPortalAccountExampleXlsx);
  container.querySelector('#portalRosterForm')?.addEventListener('submit',preview);
  container.querySelector('#portalRosterCommit')?.addEventListener('click',()=>commit().catch(err=>toast(err.message)));
  container.querySelector('#portalRosterStop')?.addEventListener('click',()=>{stop=true});
  update();
 }
 return{render};
}
