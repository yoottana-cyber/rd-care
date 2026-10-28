// Admin-only semester references; this page never changes active timetable or attendance.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekdays=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
export function createTermSnapshots({api,mount,safeRun,toast,navigate}){
 let data=null,year=null,semester=null,roomId=0,busy=false;
 const termKey=(y,t)=>y+':'+t;
 function render(){
  if(!data)return;
  const v=data.view,rooms=v.rooms||[],room=rooms.find(r=>r.id===roomId);
  const total=key=>rooms.reduce((sum,r)=>sum+Number(r[key]||0),0);
  const terms=[data.current,...data.snapshots].filter((x,i,items)=>
   items.findIndex(other=>termKey(other.academic_year,other.semester)===termKey(x.academic_year,x.semester))===i);
  mount(`<div class="stack rd-term-page">
   <div class="row between"><div>
    <h2>📘 ทะเบียนและตารางสอนตามภาคเรียน</h2>
    <p class="muted">ดูและเก็บชุดข้อมูลแยกตามภาคเรียน โดยไม่เปลี่ยนแปลงประวัติเช็กชื่อเดิม</p>
   </div><button type="button" class="button secondary" id="termOpenSettings">⚙ ตั้งค่าปีการศึกษา</button></div>
   <section class="card stack">
    <div class="rd-term-controls">
     <div class="field"><label for="termSelect">ปีการศึกษา / ภาคเรียน</label>
      <select id="termSelect">${terms.map(t=>`<option value="${t.academic_year}:${t.semester}"
       ${t.academic_year===year&&t.semester===semester?'selected':''}>
       ปี ${t.academic_year} · ภาคเรียน ${t.semester}${t.academic_year===data.current.academic_year&&t.semester===data.current.semester?' (ปัจจุบัน)':''}
       </option>`).join('')}</select></div>
     <div class="field"><label for="termRoom">ห้องเรียน</label>
      <select id="termRoom"><option value="0">ทุกห้องเรียน</option>
       ${rooms.map(r=>`<option value="${r.id}" ${roomId===r.id?'selected':''}>${esc(r.label)}</option>`).join('')}
      </select></div>
     <button class="button secondary" type="button" id="termReload">↻ โหลดใหม่</button>
    </div>
    <div class="rd-term-stats">
     <div><small>นักเรียน</small><strong>${total('students').toLocaleString('th-TH')}</strong></div>
     <div><small>ตารางสอน</small><strong>${total('lessons').toLocaleString('th-TH')}</strong></div>
     <div><small>ห้องที่มีนักเรียน</small><strong>${rooms.filter(r=>Number(r.students)>0).length}</strong></div>
     <div><small>ข้อมูล ณ วันที่</small><strong>${esc(v.source_date)}</strong></div>
    </div>
    ${v.preview?`<div class="rd-term-status">
     <strong>ตัวอย่างข้อมูลปัจจุบัน — ยังไม่บันทึกเป็นข้อมูลอ้างอิง</strong>
     <p>รายชื่อและตารางสอนนี้เป็นข้อมูล ณ วันนี้ ไม่ใช่การคาดการณ์ในวันเปิดภาคเรียน
      สามารถบันทึกชุดข้อมูลของปี ${year} ภาคเรียน ${semester} ได้หนึ่งครั้ง โดยจะไม่เขียนทับข้อมูลเดิม</p>
     <button class="button" type="button" id="termCapture" ${busy?'disabled':''}>🔒 บันทึกชุดข้อมูลอ้างอิง</button></div>`:
     `<div class="rd-term-status"><strong>✓ บันทึกชุดข้อมูลอ้างอิงแล้ว</strong>
      <p>ผู้บันทึก ${esc(v.record.captured_by)} · วันที่ ${esc(v.record.captured_at)}
      · สามารถเปิดดูได้ภายหลังแม้จะเปลี่ยนห้องเรียนหรือตารางสอนปัจจุบัน</p></div>`}
   </section>
   <section class="card stack"><h3>🏫 สรุปห้องเรียน</h3>
    <div class="table-wrap"><table class="table"><thead><tr>
     <th>ห้อง</th><th>นักเรียน</th><th>ตารางสอน</th><th>รายละเอียด</th>
    </tr></thead><tbody>${rooms.map(r=>`<tr><td>${esc(r.label)}</td>
     <td>${Number(r.students).toLocaleString('th-TH')}</td>
     <td>${Number(r.lessons).toLocaleString('th-TH')}</td>
     <td><button class="button secondary" type="button" data-term-room="${r.id}">ดูรายชื่อ</button></td>
    </tr>`).join('')}</tbody></table></div></section>
   ${room?`<section class="card stack"><h3>👥 นักเรียนห้อง ${esc(room.label)}</h3>
     <p class="muted">เลขที่และห้องอ้างอิงตามข้อมูลวันที่ ${esc(v.source_date)}</p>
     <div class="table-wrap"><table class="table"><thead><tr><th>เลขที่</th><th>เลขประจำตัว</th><th>ชื่อ–สกุล</th></tr></thead><tbody>
      ${(v.students||[]).map(s=>`<tr><td>${esc(s.roll_no)}</td><td>${esc(s.student_no)}</td>
       <td>${esc(s.full_name)}</td></tr>`).join('')||'<tr><td colspan="3">ไม่มีรายชื่อในห้องนี้</td></tr>'}
     </tbody></table></div>
     <h3>📚 ตารางสอนห้อง ${esc(room.label)}</h3>
     <div class="table-wrap"><table class="table"><thead><tr><th>วัน</th><th>คาบ</th><th>วิชา</th><th>ครู</th></tr></thead><tbody>
      ${(v.lessons||[]).map(t=>`<tr><td>${esc(weekdays[t.day_of_week-1]||'—')}</td>
       <td>${esc(t.period)}${t.end_period!==t.period?'-'+esc(t.end_period):''}</td>
       <td>${esc(t.subject_code)} · ${esc(t.subject)}</td>
       <td>${esc(t.teacher_name)}</td></tr>`).join('')||'<tr><td colspan="4">ไม่มีคาบเรียนในชุดข้อมูลนี้</td></tr>'}
     </tbody></table></div></section>`:''}
   <section class="card stack"><h3>🛡️ รักษาประวัติการเรียน</h3>
    <p>ข้อมูลชุดนี้เป็นภาพทะเบียนและตารางสอน ณ วันที่บันทึกเท่านั้น
     ไม่ย้ายห้อง ไม่ปรับสิทธิ์ครู ไม่เปลี่ยนตารางสอนที่กำลังใช้งาน และไม่ลบประวัติเช็กชื่อ
     ก่อนเปิดใช้ตารางสอนภาคเรียนใหม่ควรตรวจสอบโครงสร้างตารางสอนของระบบเดิมอีกครั้ง</p></section>
   </div>`);
  document.querySelector('#termOpenSettings')?.addEventListener('click',()=>safeRun(()=>navigate('schoolSettings')));
  document.querySelector('#termReload')?.addEventListener('click',()=>safeRun(()=>load({year,semester,roomId})));
  document.querySelector('#termSelect')?.addEventListener('change',e=>safeRun(()=>{
   const [y,t]=e.target.value.split(':').map(Number);return load({year:y,semester:t,roomId:0});
  }));
  document.querySelector('#termRoom')?.addEventListener('change',e=>safeRun(()=>load({year,semester,roomId:Number(e.target.value)})));
  document.querySelectorAll('[data-term-room]').forEach(button=>button.addEventListener('click',
   ()=>safeRun(()=>load({year,semester,roomId:Number(button.dataset.termRoom)}))));
  document.querySelector('#termCapture')?.addEventListener('click',()=>safeRun(capture));
 }
 async function capture(){
  if(busy||!data?.view?.preview)return;
  if(!window.confirm('ยืนยันเก็บรายชื่อและตารางสอน ณ วันนี้ สำหรับปี '+year+' ภาคเรียน '+semester+
   '? เมื่อบันทึกแล้วจะไม่สามารถเขียนทับข้อมูลชุดนี้ได้'))return;
  busy=true;
  const button=document.querySelector('#termCapture');
  if(button)button.disabled=true;
  try{
   await api('/api/admin/term-snapshots',{method:'POST',
    body:{academic_year:year,semester,confirm:true}});
   toast('บันทึกข้อมูลอ้างอิงภาคเรียนเรียบร้อย');
   await load({year,semester,roomId});
  }finally{busy=false;if(button?.isConnected)button.disabled=false}
 }
 async function load({year:nextYear=year,semester:nextSemester=semester,roomId:nextRoom=roomId}={}){
  const query=new URLSearchParams();
  if(nextYear&&nextSemester){query.set('year',nextYear);query.set('semester',nextSemester)}
  if(nextRoom)query.set('classroom_id',nextRoom);
  const result=await api('/api/admin/term-snapshots'+(query.size?'?'+query:''));
  data=result;year=result.view.year;semester=result.view.semester;
  roomId=nextRoom&&result.view.rooms.some(r=>r.id===nextRoom)?nextRoom:0;
  render();
 }
 return {load};
}
