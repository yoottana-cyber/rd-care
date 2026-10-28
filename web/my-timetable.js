// Teacher-owned timetable editor. No privileged teacher ID is accepted from forms.
const days=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
export const periodChoices=Array.from({length:10},(_,index)=>{
 const p=index+1;
 return [String(p),...(p<10?[p+'-'+(p+1)]:[])];
}).flat();
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=x=>Number(x)||0;
const periodName=slot=>slot.period===slot.end_period?String(slot.period):slot.period+'-'+slot.end_period;
export function createMyTimetable({api,mount,toast,refreshRooms,safeRun,openPeriodAttendance}){
 let lessons=[],rooms=[],editId=null,year=null,semester=null,current=null,editable=true,terms=[];
 async function load(){
  const q=new URLSearchParams();
  if(year&&semester){q.set('year',year);q.set('semester',semester)}
  const [result,roomResult]=await Promise.all([api('/api/my-timetable'+(q.size?'?'+q:'')),api('/api/classrooms/catalog')]);
  lessons=result.items;rooms=roomResult.items;current=result.current;editable=result.editable;
  year=result.term.academic_year;semester=result.term.semester;terms=result.terms||[];
  if(!editable)editId=null;
  render();
 }
 function render(){
  const edit=lessons.find(row=>row.id===editId);
  const currentPeriod=edit?periodName(edit):'1';
  const options=periodChoices.map(value=>`<option value="${value}" ${value===currentPeriod?'selected':''}>คาบ ${value}</option>`).join('');
  mount(`<section class="stack teacher-timetable">
   <div><div class="period-return"><button type="button" class="button ghost" data-tab="periodAttendance">← กลับตารางสอนรายสัปดาห์</button></div>
    <h2>📚 ตารางสอนของฉัน</h2>
    <p class="muted">ครูเพิ่มตารางสอนด้วยตนเองแล้วเช็กชื่อรายคาบได้ทันที ไม่ต้องรออนุมัติ • ระบบตรวจคาบซ้อนภายในภาคเรียนเดียวกัน</p></div>
   <section class="card stack"><div class="row between"><strong>ปีการศึกษา ${year} • ภาคเรียน ${semester}</strong>
    <div class="field"><label for="myTeachingTerm">ดูตารางสอนภาคเรียน</label><select id="myTeachingTerm">
    ${[{academic_year:current?.academic_year,semester:current?.semester},...terms]
      .filter((t,i,all)=>all.findIndex(x=>x.academic_year===t.academic_year&&x.semester===t.semester)===i)
      .map(t=>`<option value="${t.academic_year}:${t.semester}" ${t.academic_year===year&&t.semester===semester?'selected':''}>ปี ${t.academic_year} / ${t.semester}</option>`).join('')}
    </select></div></div>
    ${editable?'<p class="muted">ภาคเรียนปัจจุบัน: เพิ่มหรือแก้คาบได้ทันที</p>':'<p class="muted">ประวัติภาคเรียนเก่า: อ่านอย่างเดียว</p>'}</section>
   ${editable?`<section class="card stack">
    <h3>${edit?'แก้ไขรายการตารางสอน':'เพิ่มรายการตารางสอน'}</h3>
    <form id="myTimetableForm" class="stack">
     <div class="grid two">
      <div class="field"><label for="teachRoom">ห้องที่สอน</label><select id="teachRoom" name="classroom_id" required>${rooms.map(r=>`<option value="${r.id}" ${r.id===(edit?.classroom_id??rooms[0]?.id)?'selected':''}>${escapeHtml(r.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="teachDay">วันสอน</label><select id="teachDay" name="day_of_week" required>${days.map((d,i)=>`<option value="${i+1}" ${i+1===(edit?.day_of_week??1)?'selected':''}>${d}</option>`).join('')}</select></div>
     </div>
     <div class="grid two">
      <div class="field"><label for="teachCode">รหัสวิชา</label><input id="teachCode" name="subject_code" maxlength="30" required placeholder="เช่น ว22103" value="${escapeHtml(edit?.subject_code||'')}"></div>
      <div class="field"><label for="teachSubject">ชื่อวิชา</label><input id="teachSubject" name="subject" maxlength="120" required placeholder="เช่น วิทยาการคำนวณ" value="${escapeHtml(edit?.subject||'')}"></div>
     </div>
     <div class="field"><label for="teachPeriod">คาบเรียน (เดี่ยวหรือคู่ต่อเนื่องจนถึงคาบ 10)</label><select id="teachPeriod" name="period_range" required>${options}</select>
       <p class="muted">ตัวอย่าง: 1, 1-2, 2, 2-3, 3 ... 9-10, 10 • ระบบตรวจคาบซ้อนของครูและห้องเรียนก่อนบันทึก</p></div>
     <div class="row"><button class="button" type="submit" ${rooms.length?'':'disabled'}>${edit?'บันทึกการแก้ไข':'เพิ่มตารางสอน'}</button>
      ${edit?'<button class="button secondary" id="cancelTimetableEdit" type="button">ยกเลิกแก้ไข</button>':''}</div>
    </form>
   </section>`:'<p class="muted">ข้อมูลย้อนหลัง เปิดดูอย่างเดียว</p>'}
   <section class="card stack"><div class="row between"><h3>ตารางสอนรายสัปดาห์ (${lessons.length} รายการ)</h3><span class="muted">เรียงตามวันและคาบ</span></div>
   ${lessons.length?`<div class="table-wrap"><table class="table"><thead><tr><th>วัน</th><th>คาบ</th><th>ห้อง</th><th>รหัสวิชา</th><th>ชื่อวิชา</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
    <tbody>${lessons.map(s=>`<tr><td>${days[s.day_of_week-1]}</td><td><strong>${periodName(s)}</strong></td><td>${escapeHtml(s.classroom_label)}</td><td>${escapeHtml(s.subject_code||'—')}</td><td>${escapeHtml(s.subject)}</td><td><span class="tag">${s.approval_status==='approved'&&s.active===1?'พร้อมเช็กชื่อ':'ยังไม่เปิดใช้ (แก้คาบซ้อน)'}</span></td><td><div class="row">
     ${editable?`<button type="button" class="button secondary" data-edit-lesson="${s.id}">แก้ไข</button>
     <button type="button" class="button ghost" data-archive-lesson="${s.id}">ลบ</button>
     <button type="button" class="button secondary" data-open-lesson="${s.id}" ${s.approval_status==='approved'&&s.active===1?'':'disabled'}>เช็กชื่อ</button>`:'<span class="muted">ย้อนหลัง</span>'}
    </div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">ยังไม่มีตารางสอน กรุณาเพิ่มวิชาที่สอนด้านบน</div>'}
    <p class="muted">บันทึกแล้วเริ่มเช็กชื่อได้ทันที • ตารางสอนเดิมที่คาบซ้อนจะยังปิดใช้งานจนกว่าจะแก้ไข • รายการที่เคยเช็กชื่อแล้วแก้หรือลบไม่ได้เพื่อรักษาประวัติ</p>
   </section>
  </section>`);
  document.querySelector('#myTeachingTerm')?.addEventListener('change',e=>safeRun(async()=>{
   const [y,t]=e.target.value.split(':').map(Number);year=y;semester=t;editId=null;await load();
  }));
  document.querySelector('#myTimetableForm')?.addEventListener('submit',event=>safeRun(async()=>{
   event.preventDefault();if(!editable)return;
   const form=event.currentTarget;
   const button=form.querySelector('button[type="submit"]');button.disabled=true;
   try{
    const data=new FormData(form),parts=String(data.get('period_range')).split('-').map(Number);
    const payload={classroom_id:id(data.get('classroom_id')),day_of_week:id(data.get('day_of_week')),
      period:parts[0],end_period:parts[1]||parts[0],
      subject_code:String(data.get('subject_code')).trim(),subject:String(data.get('subject')).trim()};
    await api(editId?'/api/my-timetable/'+editId+'/update':'/api/my-timetable',{method:'POST',body:payload});
    editId=null;
    await refreshRooms();
    await load();
    toast('บันทึกตารางสอนแล้ว พร้อมเช็กชื่อรายคาบ');
   }finally{if(button.isConnected)button.disabled=false}
  }));
  document.querySelector('#cancelTimetableEdit')?.addEventListener('click',()=>{editId=null;render()});
  document.querySelectorAll('[data-edit-lesson]').forEach(button=>button.addEventListener('click',()=>{
   editId=id(button.dataset.editLesson);render();
   document.querySelector('#myTimetableForm')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  document.querySelectorAll('[data-archive-lesson]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   const lesson=lessons.find(row=>row.id===id(button.dataset.archiveLesson));
   if(!lesson||!confirm('ลบคาบ '+periodName(lesson)+' วิชา '+lesson.subject+'? (หากเคยเช็กชื่อแล้วระบบจะไม่อนุญาต)'))return;
   button.disabled=true;
   try{
    await api('/api/my-timetable/'+lesson.id+'/archive',{method:'POST',body:{}});
    editId=null;await refreshRooms();await load();toast('ลบรายการตารางสอนแล้ว');
   }finally{if(button.isConnected)button.disabled=false}
  })));
  document.querySelectorAll('[data-open-lesson]').forEach(button=>button.addEventListener('click',()=>openPeriodAttendance(lessons.find(row=>row.id===id(button.dataset.openLesson)))));
 }
 return {load};
}
