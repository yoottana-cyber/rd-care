import {readXlsxRows} from './xlsx-reader.js';
import {downloadScoreImportExampleXlsx} from './template-xlsx.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHUNK=20,MAX_ROWS=500,PAGE_SIZE=40;

export function parseScoreExcelRows(raw){
 if(!Array.isArray(raw)||!raw.length)throw Error('ไม่พบหัวตารางใน Excel');
 const head=raw[0].slice(0,3).map(v=>String(v??'').trim().toLowerCase()).join(',');
 if(head!=='student_no,rule_id,reason'||
   raw[0].slice(3).some(x=>String(x??'').trim()))
  throw Error('แถวแรกต้องเป็น student_no,rule_id,reason ตามไฟล์ตัวอย่าง');
 if(raw.length<2)throw Error('ไฟล์ Excel ยังไม่มีรายการนักเรียน');
 if(raw.length-1>MAX_ROWS)throw Error('นำเข้าได้สูงสุด '+MAX_ROWS+' แถวต่อไฟล์ กรุณาแบ่งไฟล์');
 const duplicates=new Set();
 return raw.slice(1).map((row,i)=>{
  const row_no=Number(row.source_row)||i+2;
  const student_no=String(row[0]??'').trim();
  const rule_id=Number(String(row[1]??'').trim());
  const reason=String(row[2]??'').trim();
  const other=row.slice(3).some(x=>String(x??'').trim());
  const key=student_no.toLowerCase()+':'+rule_id;
  let error='';
  if(other)error='พบข้อมูลเกิน 3 คอลัมน์';
  else if(!student_no||student_no.length>40||/[\u0000-\u001f\u007f]/.test(student_no))
   error='กรุณาระบุเลขประจำตัวนักเรียนที่ถูกต้อง';
  else if(!Number.isSafeInteger(rule_id)||rule_id<1)
   error='รหัสเกณฑ์ต้องเป็นตัวเลขจากแผ่น Rules';
  else if(reason.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason))
   error='รายละเอียดต้องไม่เกิน 300 ตัวอักษร';
  else if(duplicates.has(key))error='นักเรียน + รหัสเกณฑ์ซ้ำกันในไฟล์';
  duplicates.add(key);
  return {row_no,student_no,rule_id,reason,error};
 });
}
export function createScoreExcelImport({api,toast,render}){
 const states={
  good:{name:'',rows:[],items:[],importId:'',phase:'',done:0,busy:false,completed:false,filter:'all',page:1},
  behavior:{name:'',rows:[],items:[],importId:'',phase:'',done:0,busy:false,completed:false,filter:'all',page:1}
 };
 const get=mode=>states[mode==='good'?'good':'behavior'];
 function markup(mode,rules=[]){
  const st=get(mode),issues=st.items.filter(r=>r.error).length;
  const displayed=st.filter==='errors'?st.items.filter(r=>r.error):st.items;
  const pages=Math.max(1,Math.ceil(displayed.length/PAGE_SIZE));
  st.page=Math.min(st.page,pages);
  const start=(st.page-1)*PAGE_SIZE,visible=displayed.slice(start,start+PAGE_SIZE);
  const canSubmit=st.items.length>0&&!issues&&!st.completed&&!st.busy;
  const available=rules.filter(x=>x.active&&Number(x.automatic)!==1&&
   (mode==='good'?x.category==='good':x.category!=='good'));
  return `<section class="card stack score-excel-import" aria-label="นำเข้าคะแนนจาก Excel">
   <div class="row between"><h3>3. นำเข้าจากไฟล์ Excel</h3>
    <button id="scoreExcelExample" type="button" class="button secondary">⬇️ ดาวน์โหลดไฟล์ Excel ตัวอย่าง</button></div>
   <p class="muted">รองรับ .xlsx แผ่นงานแรก: <code>student_no, rule_id, reason</code> •
    บันทึกคะแนนตามเกณฑ์ที่โรงเรียนอนุมัติเท่านั้น (ไม่รับคะแนนที่ใส่เอง) • สูงสุด ${MAX_ROWS} แถวต่อไฟล์</p>
   <p class="muted">ไฟล์ตัวอย่างมีแผ่น <strong>Rules</strong> แสดงรหัสเกณฑ์ที่ใช้งานอยู่
    ${available.length?'จำนวน '+available.length+' เกณฑ์':'• ยังไม่มีเกณฑ์หมวดนี้ กรุณาให้ฝ่ายกิจการตั้งเกณฑ์ก่อน'}</p>
   <div class="field"><label for="scoreExcelFile">เลือกไฟล์ Excel เพื่อดูตัวอย่างก่อนบันทึก</label>
    <input id="scoreExcelFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
     ${st.busy?'disabled':''}></div>
   ${st.items.length?`<div class="score-excel-summary">
    <strong>${esc(st.name)}</strong>
    <span>ทั้งหมด ${st.items.length} แถว • ผิดพลาด ${issues} • ยืนยันแล้ว ${st.done} แถว</span></div>
    <div class="row score-excel-controls">
     <button type="button" class="button secondary" data-score-excel-filter="all" aria-pressed="${st.filter==='all'}">ทั้งหมด</button>
     <button type="button" class="button secondary" data-score-excel-filter="errors" aria-pressed="${st.filter==='errors'}">มีปัญหา (${issues})</button>
     <span class="muted">หน้า ${st.page}/${pages}</span>
     <button type="button" class="button ghost" id="scoreExcelPrev" ${st.page===1?'disabled':''}>ก่อนหน้า</button>
     <button type="button" class="button ghost" id="scoreExcelNext" ${st.page===pages?'disabled':''}>ถัดไป</button>
    </div>
    <div class="table-wrap score-excel-preview"><table class="table">
     <thead><tr><th>แถว</th><th>เลขประจำตัว</th><th>ชื่อ/ห้อง</th><th>เกณฑ์</th><th>คะแนน</th><th>รายละเอียด/ผลตรวจ</th></tr></thead>
     <tbody>${visible.map(x=>`<tr class="${x.error?'score-excel-bad':''}">
      <td>${x.row_no}</td><td>${esc(x.student_no)}</td>
      <td>${esc(x.full_name||'—')}<small>${esc(x.classroom_label||'')}</small></td>
      <td>${esc(x.rule_name||x.rule_id)}</td><td>${x.points===undefined||x.points===null?'—':Number(x.points)}</td>
      <td>${esc(x.error||x.reason||'ใช้ชื่อเกณฑ์เป็นรายละเอียด')}</td>
     </tr>`).join('')}</tbody></table></div>
    ${st.completed?'<p class="ok">✓ นำเข้าครบทุกแถวเรียบร้อยแล้ว</p>':
     issues?'<p class="warn">พบข้อมูลผิดพลาด กรุณาแก้ Excel แล้วเลือกไฟล์ใหม่ ระบบยังไม่บันทึกรายการเหล่านี้</p>':
     `<button type="button" id="scoreExcelCommit" class="button full" ${canSubmit?'':'disabled'}>
      ${st.done?'ดำเนินการต่อ':'ยืนยันนำเข้า'} ${st.items.length-st.done} แถว</button>`}
    `:'<p class="muted">ขั้นตอน: ดาวน์โหลดตัวอย่าง → ใส่เลขนักเรียนและรหัสเกณฑ์ → เลือกไฟล์ → ตรวจสอบ → ยืนยัน</p>'}
   <p class="muted" role="status" id="scoreExcelStatus">${esc(st.phase)}</p>
   ${st.done&&!st.completed?'<p class="warn">หากการเชื่อมต่อสะดุด สามารถกด “ดำเนินการต่อ” ได้ โดยระบบกันบันทึกซ้ำด้วยรหัสชุดนำเข้าเดิม</p>':''}
  </section>`;
 }
 async function fileSelected(mode,file){
  if(!file)return;
  const st=get(mode);
  if(st.busy)return;
  st.busy=true;st.items=[];st.rows=[];st.done=0;st.completed=false;st.name=file.name;st.phase='กำลังอ่าน Excel…';st.filter='all';st.page=1;
  render();
  try{
   const raw=await readXlsxRows(file);
   st.rows=parseScoreExcelRows(raw);
   st.importId=crypto.randomUUID();
   const preview=new Map();
   for(const row of st.rows)if(row.error)preview.set(row.row_no,row);
   const valid=st.rows.filter(x=>!x.error);
   for(let start=0;start<valid.length;start+=CHUNK){
    st.phase='กำลังตรวจสอบข้อมูลกับฐานนักเรียน '+Math.min(start+CHUNK,valid.length)+'/'+valid.length;
    render();
    const checked=await api('/api/affairs/behavior/import/preview',{method:'POST',
     body:{mode,rows:valid.slice(start,start+CHUNK)},timeoutMs:30000});
    for(const row of checked.items||[])preview.set(row.row_no,row);
   }
   st.items=st.rows.map(x=>preview.get(x.row_no)||{...x,error:'ไม่พบผลตรวจจากเซิร์ฟเวอร์'});
   const errors=st.items.filter(x=>x.error).length;
   st.phase=errors?'พบข้อมูลต้องแก้ไข '+errors+' แถว • ยังไม่บันทึกคะแนน':
    'ตรวจสอบผ่าน '+st.items.length+' แถว • กรุณาทบทวนก่อนยืนยันบันทึก';
  }catch(error){
   st.items=[];st.rows=[];st.phase='เปิดไฟล์ไม่สำเร็จ: '+error.message;
   toast(st.phase,true);
  }finally{st.busy=false;render()}
 }
 async function commit(mode){
  const st=get(mode);
  if(st.busy||st.completed||!st.rows.length||st.items.some(x=>x.error))return;
  if(!confirm('ยืนยันบันทึก'+(mode==='good'?'คะแนนความดี':'คะแนนความผิด')+
   'จาก Excel '+st.rows.length+' แถว? การนำเข้านี้จะเพิ่มประวัติคะแนนใหม่ ไม่แก้ไขรายการเดิม'))return;
  st.busy=true;render();
  try{
   for(;st.done<st.rows.length;){
    const batch=st.rows.slice(st.done,st.done+CHUNK);
    st.phase='กำลังบันทึก '+(st.done+1)+'–'+(st.done+batch.length)+' จาก '+st.rows.length;
    render();
    const result=await api('/api/affairs/behavior/import/commit',{method:'POST',
     body:{mode,import_id:st.importId,rows:batch},timeoutMs:30000});
    if(!result.ok||Number(result.count)!==batch.length)throw Error('เซิร์ฟเวอร์ไม่ยืนยันครบทุกแถว');
    st.done+=batch.length;
   }
   st.completed=true;st.phase='บันทึกสำเร็จ '+st.done+' แถว';
   toast('นำเข้าคะแนนสำเร็จ '+st.done+' แถว');
  }catch(error){
   st.phase='หยุดที่ '+st.done+'/'+st.rows.length+' แถว: '+error.message+
    ' • กดดำเนินการต่อเพื่อส่งชุดเดิมอีกครั้ง ไม่ต้องเลือกไฟล์ใหม่';
   toast('นำเข้าหยุดชั่วคราว สามารถดำเนินการต่อได้',true);
  }finally{st.busy=false;render()}
 }
 function bind(mode,rules){
  document.querySelector('#scoreExcelExample')?.addEventListener('click',()=>downloadScoreImportExampleXlsx(mode,rules));
  document.querySelector('#scoreExcelFile')?.addEventListener('change',event=>{
   const file=event.currentTarget.files?.[0];
   void fileSelected(mode,file);
  });
  document.querySelector('#scoreExcelCommit')?.addEventListener('click',()=>void commit(mode));
  document.querySelectorAll('[data-score-excel-filter]').forEach(el=>
   el.addEventListener('click',()=>{const st=get(mode);st.filter=el.dataset.scoreExcelFilter;st.page=1;render()}));
  document.querySelector('#scoreExcelPrev')?.addEventListener('click',()=>{
   const st=get(mode);st.page=Math.max(1,st.page-1);render();
  });
  document.querySelector('#scoreExcelNext')?.addEventListener('click',()=>{
   const st=get(mode);st.page++;render();
  });
 }
 return {markup,bind};
}
