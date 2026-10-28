// Admin read-only view. Teachers manage their own active timetable; no approvals.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekdays=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
const slot=t=>String(t.period)+(Number(t.end_period)>Number(t.period)?'-'+t.end_period:'');
export function createTimetableAudit({api,mount,safeRun,navigate}){
 let data=null,year=null,semester=null,query='',room='all',teacher='all',onlyConflicts=false;
 async function load({year:y=year,semester:t=semester}={}){
  const params=new URLSearchParams();
  if(y&&t){params.set('year',y);params.set('semester',t)}
  data=await api('/api/admin/timetable/audit'+(params.size?'?'+params:''));
  year=data.academic_year;semester=data.semester;
  render();
 }
 function render(){
  if(!data)return;
  const clashes=new Set((data.clashes||[]).flatMap(x=>[x.first_id,x.second_id]));
  const rooms=[...new Map(data.items.map(x=>[x.classroom_id,{id:x.classroom_id,label:x.classroom_label}])).values()];
  const teachers=[...new Map(data.items.map(x=>[x.teacher_user_id,{id:x.teacher_user_id,label:x.teacher_name}])).values()];
  const entries=data.items.filter(x=>(
   (room==='all'||String(x.classroom_id)===room)&&
   (teacher==='all'||String(x.teacher_user_id)===teacher)&&
   (!query||[x.subject,x.subject_code,x.classroom_label,x.teacher_name].some(v=>String(v).toLocaleLowerCase().includes(query.toLocaleLowerCase())))&&
   (!onlyConflicts||clashes.has(x.id))
  ));
  const keys=[data.current,...data.terms].filter((value,i,all)=>
   all.findIndex(x=>x.academic_year===value.academic_year&&x.semester===value.semester)===i);
  mount(`<div class="stack rd-timetable-audit">
    <div class="row between"><div><h2>🔍 ตรวจสอบตารางสอนและคาบซ้อน</h2>
      <p class="muted">Admin ตรวจสอบข้อมูลได้โดยไม่ต้องอนุมัติ ครูเพิ่มตารางสอนที่ไม่ซ้อนกันแล้วใช้งานได้ทันที</p>
     </div><button class="button secondary" id="timetableAuditSettings" type="button">⚙️ ตั้งค่าปีการศึกษา</button></div>
    <section class="card stack">
     <div class="rd-audit-stats">
      <div><small>คาบเรียน</small><strong>${data.items.length}</strong></div>
      <div><small>กำลังใช้งาน</small><strong>${data.items.filter(x=>Number(x.active)===1).length}</strong></div>
      <div><small>รายการที่พบคาบซ้อน</small><strong>${data.clashes.length}</strong></div>
     </div>
     <div class="rd-audit-filters">
      <div class="field"><label for="auditTerm">ปีการศึกษา / ภาคเรียน</label>
       <select id="auditTerm">${keys.map(k=>`<option value="${k.academic_year}:${k.semester}"
        ${k.academic_year===year&&k.semester===semester?'selected':''}>
        ${k.academic_year} / ภาคเรียน ${k.semester}</option>`).join('')}</select></div>
      <div class="field"><label for="auditRoom">ห้องเรียน</label>
       <select id="auditRoom"><option value="all">ทุกห้องเรียน</option>${rooms.map(r=>`<option value="${r.id}" ${room===String(r.id)?'selected':''}>${esc(r.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="auditTeacher">ครูผู้สอน</label>
       <select id="auditTeacher"><option value="all">ทุกคน</option>${teachers.map(u=>`<option value="${u.id}" ${teacher===String(u.id)?'selected':''}>${esc(u.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="auditQuery">ค้นหาวิชา / ครู</label>
       <input id="auditQuery" type="search" maxlength="80" value="${esc(query)}" placeholder="รหัสวิชา ชื่อครู ห้องเรียน"></div>
      <label class="rd-audit-checkbox"><input id="auditOnlyClashes" type="checkbox" ${onlyConflicts?'checked':''}> แสดงเฉพาะรายการคาบซ้อน</label>
     </div>
     ${data.clashes.length?`<p class="warn">พบคาบเรียนที่ชนกัน ${data.clashes.length} คู่ กรุณาตรวจสอบช่วงเวลาที่ทับกัน รายการเดิมจะไม่ถูกลบอัตโนมัติ</p>`:
      '<p class="muted">✓ ไม่พบคาบซ้อนในรายการที่ใช้งานของภาคเรียนนี้</p>'}
     ${data.truncated?'<p class="warn">ข้อมูลมากกว่า 3,000 รายการ กรุณาติดต่อผู้ดูแลเพื่อตรวจรายการส่วนที่เกินขอบเขตการแสดงผล</p>':''}
     <div class="table-wrap"><table class="table"><thead><tr><th>วัน</th><th>คาบ</th><th>ห้อง</th><th>วิชา</th><th>ครู</th><th>สถานะ</th></tr></thead><tbody>
      ${entries.map(t=>`<tr><td>${esc(weekdays[t.day_of_week-1]||'-')}</td>
       <td>${esc(slot(t))}</td><td>${esc(t.classroom_label)}</td>
       <td>${esc(t.subject_code)} · ${esc(t.subject)}</td><td>${esc(t.teacher_name)}</td>
       <td>${clashes.has(t.id)?'<strong class="warn">คาบซ้อน</strong>':Number(t.active)===1?'ใช้งาน':'ไม่ใช้งาน'}</td>
       </tr>`).join('')||'<tr><td colspan="6" class="muted">ไม่พบรายการตามเงื่อนไข</td></tr>'}
      </tbody></table></div>
    </section>
   </div>`);
  document.getElementById('timetableAuditSettings')?.addEventListener('click',()=>safeRun(()=>navigate('schoolSettings')));
  document.getElementById('auditTerm')?.addEventListener('change',e=>safeRun(()=>{
   const [y,t]=e.target.value.split(':').map(Number);
   room='all';teacher='all';return load({year:y,semester:t});
  }));
  document.getElementById('auditRoom')?.addEventListener('change',e=>{room=e.target.value;render()});
  document.getElementById('auditTeacher')?.addEventListener('change',e=>{teacher=e.target.value;render()});
  document.getElementById('auditQuery')?.addEventListener('change',e=>{query=e.target.value;render()});
  document.getElementById('auditOnlyClashes')?.addEventListener('change',e=>{onlyConflicts=e.target.checked;render()});
 }
 return {load};
}
