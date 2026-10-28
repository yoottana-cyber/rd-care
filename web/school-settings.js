// Admin-only school configuration console; all writes are validated again by Worker.
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const displayDate=value=>{
 if(!value)return 'ยังไม่กำหนด';
 const [y,m,d]=value.split('-').map(Number);
 return new Intl.DateTimeFormat('th-TH',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'})
  .format(new Date(Date.UTC(y,m-1,d)));
};
const dateTime=value=>{
 if(!value)return '';
 const date=new Date(value.replace(' ','T')+'Z');
 return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('th-TH',{
  timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',
  hour:'2-digit',minute:'2-digit',hour12:false
 }).format(date):String(value);
};
export function createSchoolSettings({api,mount,safeRun,toast,navigate}){
 let current=null,history=[],busy=false;
 const field=(name,label,value,type='text',attrs='')=>
  `<div class="field"><label for="schoolSetting_${name}">${label}</label>
   <input id="schoolSetting_${name}" name="${name}" type="${type}"
    value="${escape(value??'')}" ${attrs}></div>`;
 function render(){
  if(!current)return;
  const s=current;
  mount(`<div class="rd-school-settings stack">
   <section class="card rd-school-settings-intro">
    <div><span class="rd-school-settings-kicker">RD CONNECT • SCHOOL CONFIGURATION</span>
     <h2>⚙️ ตั้งค่าระบบโรงเรียน</h2>
     <p>กำหนดข้อมูลโรงเรียน ภาคเรียน และเวลาที่ใช้ลงชื่อมาสายจากส่วนกลาง โดยผู้ดูแลระบบเท่านั้น</p></div>
    <div class="rd-school-settings-facts">
     <div><span>ปีการศึกษา</span><strong>${escape(s.academic_year)}</strong></div>
     <div><span>ภาคเรียน</span><strong>${escape(s.semester)}</strong></div>
     <div><span>เริ่มมาสายหลัง</span><strong>${escape(s.late_cutoff_time)} น.</strong></div>
    </div>
   </section>
   <form id="schoolSettingsForm" class="stack">
    <section class="card stack">
     <h3>🏫 ข้อมูลโรงเรียน</h3>
     <p class="muted">ข้อมูลอ้างอิงสำหรับการบริหารระบบ ไม่แก้ชื่อที่ปรากฏในโลโก้หรือเอกสารเดิมโดยอัตโนมัติ</p>
     ${field('school_name','ชื่อสถานศึกษา',s.school_name,'text','minlength="2" maxlength="100" required')}
    </section>
    <section class="card stack">
     <h3>📅 ปีการศึกษาและภาคเรียน</h3>
     <p class="muted">ใช้เก็บภาคเรียนปัจจุบันและวันเปิด–ปิดภาคเรียน ยังไม่เปลี่ยนประวัติเช็กชื่อหรือตารางสอนย้อนหลัง</p>
     <div class="rd-school-settings-grid">
      ${field('academic_year','ปีการศึกษา (พ.ศ.)',s.academic_year,'number','min="2500" max="2700" step="1" required')}
      <div class="field"><label for="schoolSetting_semester">ภาคเรียน</label>
       <select id="schoolSetting_semester" name="semester" required>
        <option value="1" ${Number(s.semester)===1?'selected':''}>ภาคเรียนที่ 1</option>
        <option value="2" ${Number(s.semester)===2?'selected':''}>ภาคเรียนที่ 2</option>
       </select></div>
      ${field('semester_start_date','วันเปิดภาคเรียน',s.semester_start_date,'date')}
      ${field('semester_end_date','วันสิ้นสุดภาคเรียน',s.semester_end_date,'date')}
     </div>
     <p class="muted">วันที่เปิดและสิ้นสุดภาคเรียนจะเว้นว่างทั้งคู่ได้ แต่หากกำหนดต้องกรอกทั้งสองช่อง</p>
    </section>
    <section class="card stack">
     <h3>⏰ เวลาเรียนและการลงชื่อมาสาย</h3>
     <p class="muted">เวลาทั้งหมดอ้างอิงประเทศไทย (Asia/Bangkok)</p>
     <div class="rd-school-settings-grid">
      ${field('school_start_time','เวลาเริ่มเรียน',s.school_start_time,'time','required')}
      ${field('late_cutoff_time','เวลาเริ่มนับว่ามาสาย (หลังเวลานี้)',s.late_cutoff_time,'time','required')}
     </div>
     <div class="rd-school-settings-notice">
      <strong>มีผลทันทีหลังบันทึก</strong>
      <p>ค่า “เริ่มนับว่ามาสาย” ใช้ตรวจสิทธิ์สแกน QR มาสายของนักเรียนและ QR แบบหมุน
       หากเปลี่ยนเวลา นักเรียนจะสแกนได้หลังเวลาใหม่เท่านั้น
       ส่วนการเช็กชื่อรายวัน/รายคาบเดิมไม่ได้ถูกเปลี่ยนย้อนหลัง</p>
     </div>
    </section>
    <div class="rd-school-settings-actions">
     <button type="submit" class="button" ${busy?'disabled':''}>
      ${busy?'กำลังบันทึก...':'บันทึกการตั้งค่าโรงเรียน'}</button>
     <button type="button" class="button secondary" id="schoolSettingsReload">โหลดค่าล่าสุด</button>
    </div>
   </form>
   <section class="card stack">
    <h3>📘 ทะเบียนและตารางสอนตามภาคเรียน</h3>
    <p class="muted">ตรวจสอบรายชื่อและตารางสอนของแต่ละภาคเรียน และบันทึกข้อมูลอ้างอิงโดยไม่แก้ประวัติเช็กชื่อเดิม</p>
    <button type="button" class="button secondary" data-school-jump="termSnapshots">ดูข้อมูลทะเบียนและตารางสอนตามภาคเรียน</button>
   </section>
   <section class="card stack">
    <h3>🔗 เมนูตั้งค่าที่มีอยู่แล้ว</h3>
    <p class="muted">การแจ้งเตือนและวันหยุดใช้ข้อมูลชุดเดียวกับฝ่ายกิจการนักเรียน ไม่สร้างการตั้งค่าซ้ำ</p>
    <div class="rd-school-settings-links">
     <button type="button" class="button secondary" data-school-jump="studentAffairs">🏫 เวลาแจ้งเตือน · วันหยุด · เกณฑ์คะแนน</button>
     <button type="button" class="button secondary" data-school-jump="admin">👥 บัญชีบุคลากร · ครูที่ปรึกษา · ตารางสอน</button>
    </div>
   </section>
   <section class="card stack">
    <h3>🕘 ประวัติเปลี่ยนแปลงการตั้งค่า</h3>
    <p class="muted">บันทึกผู้แก้ไข วันเวลา และค่าก่อน–หลัง เพื่อให้ตรวจสอบย้อนหลังได้</p>
    <div class="table-wrap"><table class="table rd-school-settings-history">
     <thead><tr><th>วันที่แก้ไข</th><th>ผู้แก้ไข</th><th>สิ่งที่เปลี่ยน</th></tr></thead>
     <tbody>${history.map(record=>`<tr><td>${escape(dateTime(record.created_at))}</td>
      <td>${escape(record.actor_name)}</td><td>${escape(changedDetails(record))}</td></tr>`).join('')||
       '<tr><td colspan="3" class="muted">ยังไม่มีรายการแก้ไข</td></tr>'}</tbody></table></div>
   </section>
  </div>`);
  document.getElementById('schoolSettingsForm')?.addEventListener('submit',event=>{
   event.preventDefault();
   safeRun(()=>save(event.currentTarget));
  });
  document.getElementById('schoolSettingsReload')?.addEventListener('click',()=>safeRun(load));
  document.querySelectorAll('[data-school-jump]').forEach(button=>
   button.addEventListener('click',()=>safeRun(()=>navigate(button.dataset.schoolJump))));
 }
 const names={school_name:'ชื่อโรงเรียน',academic_year:'ปีการศึกษา',semester:'ภาคเรียน',
  semester_start_date:'วันเปิดภาคเรียน',semester_end_date:'วันสิ้นสุดภาคเรียน',
  school_start_time:'เวลาเริ่มเรียน',late_cutoff_time:'เวลาเริ่มมาสาย'};
 function changedDetails(record){
  return Object.entries(names).filter(([key])=>record.previous?.[key]!==record.next?.[key])
   .map(([key,label])=>label+': '+(record.previous?.[key]??'—')+' → '+(record.next?.[key]??'—'))
   .join(' • ')||'ไม่มีค่าเปลี่ยน';
 }
 async function save(form){
  if(busy)return;
  const data=new FormData(form);
  const values=Object.fromEntries(data.entries());
  values.semester_start_date=values.semester_start_date||null;
  values.semester_end_date=values.semester_end_date||null;
  values.academic_year=Number(values.academic_year);
  values.semester=Number(values.semester);
  if(Boolean(values.semester_start_date)!==Boolean(values.semester_end_date)){
   toast('กรุณากรอกวันเปิดและปิดภาคเรียนทั้งสองช่อง หรือเว้นว่างทั้งคู่',true);return;
  }
  if(values.semester_start_date&&values.semester_end_date&&values.semester_end_date<values.semester_start_date){
   toast('วันสิ้นสุดภาคเรียนต้องไม่ก่อนวันเปิดภาคเรียน',true);return;
  }
  if(values.late_cutoff_time<values.school_start_time){
   toast('เวลาเริ่มนับว่ามาสายต้องไม่ก่อนเวลาเริ่มเรียน',true);return;
  }
  if(values.late_cutoff_time!==current.late_cutoff_time&&
   !window.confirm('เวลาเริ่มมาสายจะเปลี่ยนจาก '+current.late_cutoff_time+
    ' เป็น '+values.late_cutoff_time+' น. และมีผลต่อการสแกน QR มาสายทันที ยืนยันบันทึก?'))return;
  busy=true;
  const button=form.querySelector('button[type="submit"]');
  if(button)button.disabled=true;
  try{
   const saved=await api('/api/admin/school-settings',{method:'POST',body:values});
   toast(saved.unchanged?'ไม่มีค่าที่เปลี่ยนแปลง':'บันทึกการตั้งค่าโรงเรียนสำเร็จ');
   await load();
  }finally{
   busy=false;
   if(button?.isConnected)button.disabled=false;
  }
 }
 async function load(){
  const response=await api('/api/admin/school-settings');
  current=response.settings;
  history=response.history||[];
  render();
 }
 return {load};
}
