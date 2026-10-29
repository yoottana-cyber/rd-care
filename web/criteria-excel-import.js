// Excel management of SCHOOL score criteria (not individual pupil scores).
import {readXlsxRows} from './xlsx-reader.js';
import {downloadCriteriaExampleXlsx} from './template-xlsx.js';

const escape=v=>String(v??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));
const CHUNK=15,MAX=500,PAGE=30;
const LABELS={good:'ความดี',minor:'เล็กน้อย',moderate:'ปานกลาง',serious:'ร้ายแรง',very_serious:'ร้ายแรงมาก'};
const belongs=(category,mode)=>mode==='good'?category==='good':category!=='good';

export function parseCriteriaExcelRows(raw,mode){
 if(!['good','behavior'].includes(mode)||!Array.isArray(raw)||!raw.length)
  throw Error('ไม่พบข้อมูล Excel หรือประเภทเกณฑ์ไม่ถูกต้อง');
 const cols=raw[0].slice(0,5).map(x=>String(x??'').trim().toLowerCase()).join(',');
 if(cols!=='rule_id,category,name,points,active'||
  raw[0].slice(5).some(x=>String(x??'').trim()))
  throw Error('หัวตารางต้องเป็น rule_id,category,name,points,active ตามไฟล์ตัวอย่าง');
 if(raw.length===1)throw Error('ไม่มีรายการเกณฑ์ใน Excel');
 if(raw.length-1>MAX)throw Error('ไฟล์มีเกิน '+MAX+' รายการ กรุณาแบ่งไฟล์');
 const names=new Set(),ids=new Set();
 return raw.slice(1).map((r,i)=>{
  const row_no=Number(r.source_row)||i+2;
  const idText=String(r[0]??'').trim();
  const rule_id=idText?Number(idText):null;
  const category=String(r[1]??'').trim().toLowerCase();
  const name=String(r[2]??'').trim();
  const scoreText=String(r[3]??'').trim();
  const points=scoreText===''?NaN:Number(scoreText);
  const activeText=String(r[4]??'').trim();
  const active=activeText==='0'?0:activeText==='1'?1:null;
  const key=category+':'+name.toLocaleLowerCase('th');
  let error='';
  if(r.slice(5).some(x=>String(x??'').trim()))error='ไฟล์มีข้อมูลเกิน 5 คอลัมน์';
  else if(rule_id!==null&&(!Number.isSafeInteger(rule_id)||rule_id<1))error='รหัสเกณฑ์ไม่ถูกต้อง';
  else if(!Object.hasOwn(LABELS,category)||!belongs(category,mode))error='หมวดเกณฑ์ไม่ตรงกับหน้าปัจจุบัน';
  else if(name.length<2||name.length>120||/[\u0000-\u001f\u007f]/.test(name))error='ชื่อเกณฑ์ต้องมี 2–120 ตัวอักษร';
  else if(!Number.isSafeInteger(points)||points===0||Math.abs(points)>50||
   (mode==='good'&&points<0)||(mode==='behavior'&&points>0))
   error='คะแนนไม่ถูกต้อง (ความดี +1 ถึง +50 / ความผิด -1 ถึง -50)';
  else if(active===null)error='active ต้องเป็น 1 หรือ 0';
  else if(names.has(key)||(rule_id!==null&&ids.has(rule_id)))error='ชื่อหรือรหัสเกณฑ์ซ้ำในไฟล์';
  names.add(key);if(rule_id!==null)ids.add(rule_id);
  return {row_no,rule_id,category,name,points,active,error};
 });
}

export function createCriteriaExcelImport({api,toast}){
 const states={
  good:{filename:'',rows:[],preview:[],importId:null,busy:false,done:0,status:'',page:1,filter:'all',completed:false},
  behavior:{filename:'',rows:[],preview:[],importId:null,busy:false,done:0,status:'',page:1,filter:'all',completed:false}
 };
 let currentRules=[];
 let currentRefresh=async()=>{};
 const state=mode=>states[mode];
 function markup(mode){
  if(!['good','behavior'].includes(mode))return '';
  const st=state(mode),errors=st.preview.filter(x=>x.error).length;
  const shown=st.filter==='errors'?st.preview.filter(x=>x.error):st.preview;
  const pages=Math.max(1,Math.ceil(shown.length/PAGE)),page=Math.min(st.page,pages);
  st.page=page;
  const visible=shown.slice((page-1)*PAGE,page*PAGE);
  return `<div class="rd-criteria-import-block">
   <div class="row between">
    <h4>📄 นำเข้าเกณฑ์${mode==='good'?'ความดี':'ความผิด'}จาก Excel</h4>
    <button type="button" class="button secondary" id="affairsCriteriaDownload">
     ⬇️ ดาวน์โหลดไฟล์ Excel ตัวอย่าง</button>
   </div>
   <p class="muted">นำเข้า <strong>เกณฑ์คะแนนของโรงเรียน</strong> ไม่ใช่คะแนนนักเรียนรายบุคคล
    • Excel .xlsx • คอลัมน์ rule_id, category, name, points, active • สูงสุด ${MAX} แถวต่อไฟล์</p>
   <p class="muted">ดาวน์โหลดไฟล์ตัวอย่างเพื่อดูประเภทความผิดหรือความดี และแผ่น Existing rules สำหรับอัปเดตเกณฑ์ที่มีอยู่แล้ว</p>
   <div class="field"><label for="affairsCriteriaFile">เลือกไฟล์ Excel เพื่อตรวจสอบข้อมูล</label>
    <input type="file" id="affairsCriteriaFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
     ${st.busy?'disabled':''}></div>
   ${st.preview.length?`<div class="rd-criteria-import-summary">
    <strong>${escape(st.filename)}</strong>
    <span>ทั้งหมด ${st.preview.length} • เพิ่มใหม่ ${st.preview.filter(x=>x.status==='create').length}
    • อัปเดต ${st.preview.filter(x=>x.status==='update').length}
    • ข้อผิดพลาด ${errors} • บันทึกแล้ว ${st.done}</span></div>
    <div class="row rd-criteria-import-tools">
     <button type="button" class="button secondary" data-criteria-filter="all" aria-pressed="${st.filter==='all'}">ทุกแถว</button>
     <button type="button" class="button secondary" data-criteria-filter="errors" aria-pressed="${st.filter==='errors'}">เฉพาะมีปัญหา (${errors})</button>
     <span class="muted">หน้า ${page}/${pages}</span>
     <button type="button" class="button ghost" id="affairsCriteriaPrev" ${page===1?'disabled':''}>ก่อนหน้า</button>
     <button type="button" class="button ghost" id="affairsCriteriaNext" ${page===pages?'disabled':''}>ถัดไป</button>
    </div>
    <div class="table-wrap rd-criteria-import-preview"><table class="table">
     <thead><tr><th>แถว</th><th>รหัสเดิม</th><th>หมวด</th><th>ชื่อเกณฑ์</th><th>คะแนน</th><th>เปิดใช้</th><th>ผลตรวจ</th></tr></thead>
     <tbody>${visible.map(x=>`<tr class="${x.error?'rd-criteria-import-invalid':''}">
      <td>${x.row_no}</td><td>${escape(x.rule_id??'เพิ่มใหม่')}</td>
      <td>${escape(LABELS[x.category]||x.category)}</td><td>${escape(x.name)}</td>
      <td>${Number.isFinite(x.points)?(x.points>0?'+':'')+x.points:'—'}</td>
      <td>${x.active===1?'ใช่':x.active===0?'ไม่':'—'}</td>
      <td>${escape(x.error|| (x.status==='update'?'อัปเดต #'+x.target_rule_id:'เพิ่มใหม่'))}</td>
     </tr>`).join('')}</tbody></table></div>
    ${st.completed?'<p class="summary">✓ บันทึกเกณฑ์ครบทุกแถวแล้ว</p>':
     errors?'<p class="warn">มีข้อมูลผิดพลาด กรุณาแก้ Excel แล้วเลือกไฟล์ใหม่ • ยังไม่บันทึกเกณฑ์</p>':
     `<button type="button" class="button full" id="affairsCriteriaCommit"
       ${st.busy?'disabled':''}>${st.done?'ดำเนินการต่อ':'ยืนยันนำเข้าเกณฑ์'} ${st.rows.length-st.done} รายการ</button>`}
   `:''}
   <p class="muted" role="status" id="affairsCriteriaStatus">${escape(st.status)}</p>
   ${st.done&&!st.completed?'<p class="muted">หากเน็ตสะดุด กดดำเนินการต่อโดยไม่ต้องเลือกไฟล์ใหม่ ระบบป้องกันบันทึกซ้ำด้วยรหัสชุดนำเข้า</p>':''}
  </div>`;
 }
 function update(mode){
  const target=document.querySelector('#affairsCriteriaExcelArea');
  if(!target||!['good','behavior'].includes(mode))return;
  // A different category may have become active while the file was processed.
  if(target.dataset.criteriaMode!==mode)return;
  target.innerHTML=markup(mode);
  bind(mode,currentRules,currentRefresh);
 }
 async function loadFile(mode,file){
  if(!file||state(mode).busy)return;
  const st=state(mode);
  st.busy=true;st.rows=[];st.preview=[];st.done=0;st.completed=false;
  st.filename=file.name;st.status='กำลังอ่านไฟล์ Excel…';st.page=1;st.filter='all';update(mode);
  try{
   st.rows=parseCriteriaExcelRows(await readXlsxRows(file),mode);
   st.importId=crypto.randomUUID();
   const result=new Map();
   for(const x of st.rows)if(x.error)result.set(x.row_no,{...x,status:'error'});
   const correct=st.rows.filter(x=>!x.error);
   for(let i=0;i<correct.length;i+=CHUNK){
    st.status='กำลังตรวจสอบ '+Math.min(i+CHUNK,correct.length)+'/'+correct.length;
    update(mode);
    const preview=await api('/api/affairs/behavior/rules/import/preview',{
     method:'POST',body:{mode,rows:correct.slice(i,i+CHUNK)},timeoutMs:30000});
    for(const x of preview.items||[])result.set(x.row_no,x);
   }
   st.preview=st.rows.map(x=>result.get(x.row_no)||{...x,error:'ไม่ได้รับผลตรวจจากเซิร์ฟเวอร์'});
   const problems=st.preview.filter(x=>x.error).length;
   st.status=problems?'พบข้อผิดพลาด '+problems+' รายการ • กรุณาแก้ไขไฟล์':
    'ตรวจสอบ '+st.preview.length+' รายการแล้ว กรุณาตรวจสอบก่อนกดยืนยัน';
  }catch(error){
   st.rows=[];st.preview=[];st.status='ไม่สามารถอ่านไฟล์: '+error.message;
   toast(st.status,true);
  }finally{st.busy=false;update(mode)}
 }
 async function submit(mode,refresh){
  const st=state(mode);
  if(st.busy||st.completed||st.rows.length===0||st.preview.some(x=>x.error))return;
  if(!confirm('ยืนยันนำเข้าเกณฑ์'+(mode==='good'?'คะแนนความดี':'ความผิด')+
   ' '+st.rows.length+' รายการ? การเพิ่ม/อัปเดตเกณฑ์ไม่เปลี่ยนประวัติคะแนนนักเรียนที่บันทึกแล้ว'))return;
  st.busy=true;update(mode);
  try{
   while(st.done<st.rows.length){
    const batch=st.rows.slice(st.done,st.done+CHUNK);
    st.status='กำลังบันทึก '+(st.done+1)+'–'+(st.done+batch.length)+' จาก '+st.rows.length;
    update(mode);
    const answer=await api('/api/affairs/behavior/rules/import/commit',{
     method:'POST',body:{mode,import_id:st.importId,rows:batch},timeoutMs:30000});
    if(!answer.ok||Number(answer.count)!==batch.length)
     throw Error('เซิร์ฟเวอร์ยังไม่ยืนยันการบันทึกครบทุกแถว');
    st.done+=batch.length;
   }
   st.completed=true;st.status='นำเข้าเกณฑ์ทั้งหมด '+st.done+' รายการสำเร็จ';
   toast(st.status);
   await refresh();
  }catch(error){
   st.status='นำเข้าแล้ว '+st.done+'/'+st.rows.length+
    ' • '+error.message+' • กดดำเนินการต่อได้โดยไม่ต้องเลือกไฟล์ใหม่';
   toast('นำเข้าหยุดชั่วคราว กรุณาตรวจสอบและกดดำเนินการต่อ',true);
  }finally{st.busy=false;update(mode)}
 }
 function bind(mode,rules,refresh){
  currentRules=rules||currentRules;
  if(typeof refresh==='function')currentRefresh=refresh;
  document.querySelector('#affairsCriteriaDownload')?.addEventListener('click',()=>
   downloadCriteriaExampleXlsx(mode,currentRules));
  document.querySelector('#affairsCriteriaFile')?.addEventListener('change',e=>{
   void loadFile(mode,e.currentTarget.files?.[0]);
  });
  document.querySelector('#affairsCriteriaCommit')?.addEventListener('click',()=>void submit(mode,refresh));
  document.querySelectorAll('[data-criteria-filter]').forEach(el=>el.addEventListener('click',()=>{
   const st=state(mode);st.filter=el.dataset.criteriaFilter;st.page=1;update(mode);
  }));
  document.querySelector('#affairsCriteriaPrev')?.addEventListener('click',()=>{
   const st=state(mode);st.page=Math.max(1,st.page-1);update(mode);
  });
  document.querySelector('#affairsCriteriaNext')?.addEventListener('click',()=>{
   const st=state(mode);st.page++;update(mode);
  });
 }
 return {markup,bind};
}
