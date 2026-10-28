// Admin-only timetable review. No approval buttons or timetable mutations.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekdays=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
export function createTimetableAudit({api,mount,safeRun}){
 let data=null,room='all',teacher='all',term='',onlyClashes=false;
 async function load(){
  data=await api('/api/admin/timetable/audit');render();
 }
 function render(){
  if(!data)return;
  const clashes=new Set(data.clashes.flatMap(x=>[x.first_id,x.second_id]));
  const rooms=[...new Map(data.items.map(x=>[x.classroom_id,{id:x.classroom_id,name:x.classroom_label}])).values()];
  const teachers=[...new Map(data.items.map(x=>[x.teacher_user_id,{id:x.teacher_user_id,name:x.teacher_name}])).values()];
  const rows=data.items.filter(x=>(room==='all'||String(x.classroom_id)===room)&&
   (teacher==='all'||String(x.teacher_user_id)===teacher)&&
   (!term||[x.subject,x.subject_code,x.teacher_name,x.classroom_label].some(v=>String(v).toLocaleLowerCase().includes(term.toLocaleLowerCase())))&&
   (!onlyClashes||clashes.has(x.id)));
  mount(`<div class="stack rd-school-timetable-audit">
    <div><h2>🔍 ตรวจสอบตารางสอนและคาบซ้อน</h2>
     <p class="muted">ครูเพิ่มตารางสอนเองได้ทันทีโดยไม่ต้องรอ Admin อนุมัติ
      ระบบตรวจการซ้อนของคาบเรียนทั้งครูและห้องเรียนก่อนบันทึก ส่วนหน้านี้ใช้ตรวจสอบแบบอ่านอย่างเดียว</p></div>
    <section class="card stack">
      <div class="rd-school-audit-stats">
        <div><small>รายการตารางสอนทั้งหมด</small><strong>${data.items.length}</strong></div>
        <div><small>เปิดใช้งาน</small><strong>${data.items.filter(x=>Number(x.active)===1).length}</strong></div>
        <div><small>คู่รายการคาบซ้อน</small><strong>${data.clashes.length}</strong></div>
      </div>
      <div class="rd-school-audit-filters">
       <div class="field"><label for="auditRoom">ห้องเรียน</label><select id="auditRoom">
        <option value="all">ทุกห้องเรียน</option>
        ${rooms.map(r=>`<option value="${r.id}" ${String(r.id)===room?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div>
       <div class="field"><label for="auditTeacher">ครูผู้สอน</label><select id="auditTeacher">
        <option value="all">ครูทุกคน</option>
        ${teachers.map(r=>`<option value="${r.id}" ${String(r.id)===teacher?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div>
       <div class="field"><label for="auditSearch">ค้นหาวิชา / ห้อง / ครู</label>
        <input type="search" id="auditSearch" value="${esc(term)}" maxlength="80" placeholder="ค้นหาข้อมูลตารางสอน"></div>
       <label class="rd-school-audit-toggle"><input type="checkbox" id="auditClashesOnly" ${onlyClashes?'checked':''}>
        เฉพาะรายการคาบซ้อน</label>
      </div>
      ${data.clashes.length?
       `<p class="warn">พบรายการคาบเรียนซ้อน ${data.clashes.length} คู่ (อาจเป็นรายการเก่าก่อนเพิ่มการตรวจสอบ)
        โปรดตรวจสอบตามวันและช่วงคาบ</p>`:
       '<p class="muted">✓ ไม่พบคาบซ้อนในตารางสอนที่เปิดใช้งาน</p>'}
      ${data.truncated?'<p class="warn">แสดงรายการสูงสุด 3,000 รายการ กรุณาตรวจส่วนเกินผ่านรายงานเพิ่มเติม</p>':''}
      <div class="table-wrap"><table class="table"><thead><tr>
       <th>วัน</th><th>คาบ</th><th>ห้อง</th><th>รายวิชา</th><th>ครู</th><th>สถานะ</th>
      </tr></thead><tbody>
      ${rows.map(x=>`<tr>
       <td>${esc(weekdays[x.day_of_week-1]||'—')}</td>
       <td>${esc(x.period)}${x.end_period>x.period?'-'+esc(x.end_period):''}</td>
       <td>${esc(x.classroom_label)}</td>
       <td>${esc(x.subject_code)} · ${esc(x.subject)}</td>
       <td>${esc(x.teacher_name)}</td>
       <td>${clashes.has(x.id)?'<strong class="warn">คาบซ้อน</strong>':Number(x.active)===1?'ใช้งาน':'ไม่ใช้งาน'}</td>
      </tr>`).join('')||'<tr><td colspan="6">ไม่พบข้อมูลตามเงื่อนไข</td></tr>'}
      </tbody></table></div>
      <button class="button secondary" id="auditReload" type="button">↻ โหลดข้อมูลตารางสอนอีกครั้ง</button>
    </section>
   </div>`);
  document.querySelector('#auditRoom')?.addEventListener('change',e=>{room=e.target.value;render()});
  document.querySelector('#auditTeacher')?.addEventListener('change',e=>{teacher=e.target.value;render()});
  document.querySelector('#auditSearch')?.addEventListener('change',e=>{term=e.target.value;render()});
  document.querySelector('#auditClashesOnly')?.addEventListener('change',e=>{onlyClashes=e.target.checked;render()});
  document.querySelector('#auditReload')?.addEventListener('click',()=>safeRun(load));
 }
 return {load};
}
