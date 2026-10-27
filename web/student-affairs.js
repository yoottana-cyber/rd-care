// RD CONNECT • Student Affairs workbench. Only the existing staff/admin role
// opens this workspace; backend independently checks every action.
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const thDate=v=>v?new Intl.DateTimeFormat('th-TH',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'})
 .format(new Date(v+'T00:00:00Z')):'';
const bangkokToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const types={good:'การทำความดี',minor:'ความผิดเล็กน้อย',moderate:'ความผิดปานกลาง',
 serious:'ความผิดร้ายแรง',very_serious:'ความผิดร้ายแรงมาก',adjustment:'การปรับคะแนน'};
const formatScore=n=>Number(n)>0?'+'+Number(n):String(Number(n)||0);
export function createStudentAffairs({api,mount,safeRun,toast,rooms}){
 const state={tab:'attendance',date:bangkokToday(),attendance:null,people:null,rules:null,
  selectedStudent:null,studentMatches:[],cases:[],score:null,ruleEdit:null,search:'',
  grade:0,monitorQuery:'',scoreSummary:[]};
 const bind=(selector,event,fn)=>document.querySelectorAll(selector).forEach(node=>
  node.addEventListener(event,e=>safeRun(()=>fn(e,node))));
 const frame=(body)=>{
  const tabs=[['attendance','📋','ติดตามเช็กชื่อ'],['people','👥','หัวหน้าระดับ/ที่ปรึกษา'],
   ['rules','⭐','เกณฑ์พฤติกรรม'],['monitor','📊','ติดตามคะแนน'],['cases','📑','ภาคทัณฑ์/ทัณฑ์บน']];
  mount(`<section class="rd-affairs">
   <header class="rd-affairs-hero"><div><span>RD CONNECT • STUDENT AFFAIRS</span>
    <h2>ฝ่ายกิจการนักเรียน</h2>
    <p>ติดตาม สนับสนุนการทำงานของครู และดูแลข้อมูลนักเรียนตามสิทธิ์</p></div>
    <span aria-hidden="true" class="rd-affairs-hero-icon">🏫</span></header>
   <nav class="rd-affairs-tabs" aria-label="ส่วนงานฝ่ายกิจการนักเรียน">
    ${tabs.map(([id,icon,name])=>`<button type="button" data-affairs-tab="${id}"
      class="${state.tab===id?'active':''}" aria-current="${state.tab===id?'page':'false'}">${icon} ${name}</button>`).join('')}
   </nav><div class="rd-affairs-content">${body}</div></section>`);
  bind('[data-affairs-tab]','click',(_,btn)=>load(btn.dataset.affairsTab));
 };
 async function load(tab=state.tab){
  state.tab=tab;
  if(tab==='attendance')return attendance();
  if(tab==='people')return people();
  if(tab==='rules')return rules();
  if(tab==='monitor')return monitor();
  if(tab==='cases')return cases();
 }
 function reminderLabel(value){return ({sent:'ส่งถึงอุปกรณ์แล้ว',no_subscription:'ยังไม่ได้สมัครรับ Push',
  failed:'ส่งไม่สำเร็จ',queued:'รอส่ง',already_queued:'เคยแจ้งแล้ว',not_needed:'เช็กชื่อครบ/ยังไม่มีครูที่ปรึกษา'})[value]||value}
 async function attendance(){
  const [result,daysOff]=await Promise.all([
   api('/api/affairs/attendance?date='+encodeURIComponent(state.date)),
   api('/api/affairs/closed-days')
  ]);
  state.attendance=result;
  const r=result.summary,settings=result.setting,days=String(settings.weekdays||'1,2,3,4,5').split(',').map(Number);
  const weekdays=['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
  const teachers=result.items.filter(x=>x.students>0);
  frame(`<section class="card stack"><div class="row between"><div><h3>ตรวจสอบการเช็กชื่อรายวัน</h3>
    <p class="muted">ห้องที่ครบหมายถึงนักเรียนที่ใช้งานอยู่ในห้องมีข้อมูลเช็กชื่อครบทุกคน</p></div>
    <button class="button secondary" id="affairsRefresh">↻ อัปเดตข้อมูล</button></div>
   <div class="field"><label for="affairsDate">วันที่ติดตาม</label>
    <input id="affairsDate" type="date" value="${esc(state.date)}" max="${bangkokToday()}"></div>
   <div class="rd-affairs-metrics">
    <div><span>ห้องที่มีนักเรียน</span><strong>${r.rooms}</strong></div>
    <div class="good"><span>เช็กครบแล้ว</span><strong>${r.complete}</strong></div>
    <div class="warn-metric"><span>ยังไม่ครบ</span><strong>${r.pending}</strong></div>
   </div></section>
   <section class="card stack"><div><h3>ตั้งค่าเตือนอัตโนมัติ</h3>
    <p class="muted">ตรวจทุก 5 นาทีผ่าน Cloudflare Cron • ทำงานเฉพาะวันที่ตั้งไว้และหลังเวลาที่กำหนด • ส่งให้ครูที่ปรึกษาที่สมัครรับ Push เท่านั้น (สูงสุด 1 รอบอัตโนมัติต่อห้องต่อวัน)</p></div>
    <form id="affairsReminderSettings" class="stack">
     <label class="row"><input type="checkbox" name="auto_enabled" ${settings.auto_enabled?'checked':''}>
      <strong>เปิดระบบแจ้งเตือนอัตโนมัติ</strong></label>
     <div class="field"><label for="affairsReminderTime">เริ่มแจ้งเตือนเวลา (ประเทศไทย)</label>
      <input id="affairsReminderTime" name="reminder_time" type="time" required value="${esc(settings.reminder_time)}"></div>
     <div class="rd-affairs-weekdays">
      ${weekdays.map((day,i)=>`<label><input type="checkbox" name="weekday" value="${i+1}" ${days.includes(i+1)?'checked':''}>${day}</label>`).join('')}
     </div>
     <button class="button" type="submit">บันทึกเวลาและวันแจ้งเตือน</button>
    </form>
    <p class="muted">วันหยุดพิเศษหรือวันที่โรงเรียนไม่มีเรียน สามารถเพิ่มในส่วนกำหนดวันหยุดด้านล่าง (ระบบจะไม่ส่งเตือนอัตโนมัติในวันเหล่านั้น)</p>
    <form id="affairsHoliday" class="row">
     <div class="field"><label>วันที่ไม่มีการเรียนการสอน</label><input type="date" name="date" required></div>
     <div class="field"><label>สาเหตุ/ชื่อวันหยุด</label><input name="label" maxlength="100" placeholder="เช่น กิจกรรมพิเศษ" required></div>
     <button type="submit" class="button secondary">บันทึกวันหยุด</button></form>
    ${(daysOff.items||[]).length?`<div class="rd-affairs-holidays">
     <h4>วันที่ยกเว้นการแจ้งเตือนอัตโนมัติ</h4>
     ${daysOff.items.map(day=>`<div class="row between rd-affairs-holiday">
      <span>${esc(thDate(day.school_date))} • ${esc(day.label)}</span>
      <button type="button" class="button ghost" data-affairs-holiday-remove="${esc(day.school_date)}">ลบวันที่ยกเว้น</button>
     </div>`).join('')}</div>`:''}
   </section>
   <section class="card stack"><div class="row between"><div><h3>ติดตามรายห้องเรียน</h3>
     <p class="muted">แสดงห้องที่มีนักเรียน • การส่งแจ้งเตือนด้วยตนเองจำกัด 1 ครั้งต่อห้องต่อวัน</p></div>
    <span class="tag">${esc(thDate(state.date))}</span></div>
    <div class="rd-affairs-attendance-grid">
     ${teachers.map(row=>{
      const reminder=(result.reminders||[]).find(x=>x.classroom_id===row.id);
      return `<article class="rd-affairs-attendance-item">
       <div class="row between"><strong>${esc(row.label)}</strong>
        <span class="rd-affairs-state ${row.complete?'ready':'pending'}">${row.complete?'✓ ครบแล้ว':'◷ ยังไม่ครบ'}</span></div>
       <p>ครูที่ปรึกษา: <strong>${esc(row.advisor_name||'ยังไม่กำหนด')}</strong></p>
       <progress class="rd-affairs-progress" value="${row.checked}" max="${row.students}"
        aria-label="การเช็กชื่อห้อง ${esc(row.label)}"></progress>
       <p class="muted">เช็กชื่อแล้ว ${row.checked}/${row.students} คน • คงเหลือ ${row.missing} คน</p>
       ${reminder?`<p class="muted">การเตือนล่าสุด: ${esc(reminderLabel(reminder.state))} (${reminder.delivered||0} เครื่อง)</p>`:''}
       ${!row.complete&&row.advisor_user_id&&state.date===bangkokToday()?
         `<button type="button" class="button secondary full" data-affairs-remind="${row.id}"
          ${result.reminders.some(x=>x.classroom_id===row.id&&x.kind==='manual')?'disabled':''}>
          🔔 ${result.reminders.some(x=>x.classroom_id===row.id&&x.kind==='manual')?'แจ้งเตือนแล้ว':'แจ้งเตือนครูที่ปรึกษา'}</button>`:
         !row.advisor_user_id?'<span class="muted">กำหนดครูที่ปรึกษาก่อนจึงแจ้งเตือนได้</span>':''}
      </article>`;
     }).join('')||'<p class="empty">วันนี้ไม่พบห้องที่มีนักเรียนตามทะเบียน</p>'}
    </div>
   </section>`);
  bind('#affairsDate','change',async(_,el)=>{state.date=el.value;await attendance()});
  bind('#affairsRefresh','click',attendance);
  bind('[data-affairs-remind]','click',async(_,el)=>{
   const room=Number(el.dataset.affairsRemind);el.disabled=true;
   const result=await api('/api/affairs/remind',{method:'POST',body:{classroom_id:room}});
   toast('ผลการแจ้งเตือน: '+reminderLabel(result.state));
   await attendance();
  });
  bind('#affairsReminderSettings','submit',async e=>{
   e.preventDefault();const form=e.currentTarget,f=new FormData(form);
   const weekdays=f.getAll('weekday').map(Number);
   await api('/api/affairs/settings',{method:'POST',body:{
    auto_enabled:f.get('auto_enabled')==='on',
    reminder_time:String(f.get('reminder_time')),weekdays}});
   toast('บันทึกกำหนดการแจ้งเตือนแล้ว');await attendance();
  });
  bind('[data-affairs-holiday-remove]','click',async(_,el)=>{
   const date=el.dataset.affairsHolidayRemove;
   if(!confirm('ยกเลิกการยกเว้นการแจ้งเตือนอัตโนมัติในวันที่ '+date+'?'))return;
   await api('/api/affairs/closed-days/remove',{method:'POST',body:{date}});
   toast('ยกเลิกวันที่ยกเว้นแล้ว');await attendance();
  });
  bind('#affairsHoliday','submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget);
   await api('/api/affairs/closed-days',{method:'POST',body:{date:String(f.get('date')),label:String(f.get('label'))}});
   toast('บันทึกวันหยุดแล้ว');await attendance();
  });
 }
 async function people(){
  const p=await api('/api/affairs/people');state.people=p;
  const teachers=p.teachers.filter(x=>x.active),headFor=grade=>p.heads.find(x=>x.grade===grade);
  const option=(selected,empty='ยังไม่กำหนด')=>`<option value="">${empty}</option>`+teachers.map(t=>
   `<option value="${t.id}" ${Number(t.id)===Number(selected)?'selected':''}>${esc(t.display_name)}</option>`).join('');
  frame(`<section class="card stack"><h3>หัวหน้าระดับชั้น ม.1–ม.6</h3>
    <p class="muted">กำหนดบุคลากรครูที่ทำหน้าที่หัวหน้าระดับ โดยไม่เปลี่ยนสิทธิ์ผู้ดูแลระบบ</p>
    <div class="rd-affairs-people-grid">
     ${[1,2,3,4,5,6].map(grade=>`<form class="rd-affairs-person" data-affairs-head="${grade}">
      <strong>ระดับชั้นมัธยมศึกษาปีที่ ${grade}</strong>
      <select name="teacher_user_id" aria-label="หัวหน้าระดับ ม.${grade}">${option(headFor(grade)?.teacher_user_id)}</select>
      <button type="submit" class="button secondary">บันทึกหัวหน้าระดับ</button>
     </form>`).join('')}
    </div></section>
    <section class="card stack"><h3>จัดการครูที่ปรึกษาประจำห้อง</h3>
     <p class="muted">การแก้ไขนี้ปรับข้อมูลครูที่ปรึกษาที่ใช้กับเช็กชื่อรายวันและ Push ตามระบบเดิม</p>
     <div class="rd-affairs-people-grid">
      ${p.rooms.map(room=>`<form class="rd-affairs-person" data-affairs-advisor="${room.id}">
       <strong>${esc(room.label)}</strong><select name="teacher_user_id" aria-label="ครูที่ปรึกษาห้อง ${esc(room.label)}">
        ${option(room.advisor_user_id)}</select><button class="button secondary" type="submit">บันทึกครูที่ปรึกษา</button>
      </form>`).join('')}
     </div></section>`);
  bind('[data-affairs-head]','submit',async(e,el)=>{
   e.preventDefault();const value=new FormData(el).get('teacher_user_id');
   await api('/api/affairs/heads',{method:'POST',body:{grade:Number(el.dataset.affairsHead),teacher_user_id:value?Number(value):null}});
   toast('บันทึกหัวหน้าระดับแล้ว');await people();
  });
  bind('[data-affairs-advisor]','submit',async(e,el)=>{
   e.preventDefault();const value=new FormData(el).get('teacher_user_id');
   await api('/api/affairs/advisor',{method:'POST',body:{classroom_id:Number(el.dataset.affairsAdvisor),teacher_user_id:value?Number(value):null}});
   toast('บันทึกครูที่ปรึกษาแล้ว');await people();
  });
 }
 async function rules(){
  const data=await api('/api/affairs/behavior/rules');state.rules=data.items;
  const selected=data.items.find(x=>x.id===state.ruleEdit);
  frame(`<section class="card stack">
    <h3>เกณฑ์คะแนนพฤติกรรม</h3>
    <p class="muted">กำหนดคะแนนตามระเบียบของโรงเรียนจริงก่อนเริ่มใช้งาน ไม่กำหนดคะแนนความผิดให้โดยอัตโนมัติ
     การเปลี่ยนเกณฑ์มีผลกับการบันทึกใหม่เท่านั้น ไม่แก้คะแนนย้อนหลัง</p>
    <form id="affairsRuleForm" class="stack">
     <div class="field"><label>ชื่อพฤติกรรม / รายการคะแนน</label>
      <input name="name" maxlength="120" required value="${esc(selected?.name||'')}" placeholder="เช่น ช่วยงานส่วนรวม"></div>
     <div class="grid two"><div class="field"><label>ประเภท</label><select name="category">
      ${Object.entries(types).filter(([key])=>key!=='adjustment').map(([k,v])=>
        `<option value="${k}" ${selected?.category===k?'selected':''}>${v}</option>`).join('')}
      </select></div><div class="field"><label>คะแนน (+/-)</label>
       <input name="points" type="number" min="-50" max="50" required value="${selected?.points||''}" placeholder="+5 หรือ -5"></div></div>
     <label class="row"><input name="active" type="checkbox" ${!selected||selected.active?'checked':''}> เปิดใช้งานเกณฑ์นี้</label>
     <div class="row"><button type="submit" class="button">${selected?'บันทึกแก้ไขเกณฑ์':'เพิ่มเกณฑ์คะแนน'}</button>
      ${selected?'<button type="button" class="button secondary" id="affairsRuleCancel">ยกเลิกการแก้ไข</button>':''}</div>
    </form></section>
    <section class="card stack"><h3>รายการเกณฑ์ที่กำหนด</h3>
     <div class="rd-affairs-rule-grid">${data.items.map(rule=>`
      <article class="rd-affairs-rule ${rule.active?'':'inactive'}">
       <div class="row between"><strong>${esc(rule.name)}</strong><b>${formatScore(rule.points)}</b></div>
       <p class="muted">${esc(types[rule.category])} • ${rule.active?'ใช้งาน':'ปิดใช้งาน'}</p>
       <button type="button" class="button secondary" data-affairs-rule-edit="${rule.id}">แก้ไขเกณฑ์</button>
      </article>`).join('')||'<p class="empty">ยังไม่กำหนดเกณฑ์คะแนนของโรงเรียน</p>'}</div>
    </section>`);
  bind('[data-affairs-rule-edit]','click',(_,el)=>{state.ruleEdit=Number(el.dataset.affairsRuleEdit);return rules()});
  bind('#affairsRuleCancel','click',()=>{state.ruleEdit=null;return rules()});
  bind('#affairsRuleForm','submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget);
   const b={...(state.ruleEdit?{id:state.ruleEdit}:{}),name:String(f.get('name')),
    category:String(f.get('category')),points:Number(f.get('points')),active:f.get('active')==='on'};
   await api('/api/affairs/behavior/rules',{method:'POST',body:b});
   state.ruleEdit=null;toast('บันทึกเกณฑ์คะแนนแล้ว');await rules();
  });
 }
 async function monitor(refresh=true){
  if(refresh){
   const data=await api('/api/affairs/behavior/summary?date='+encodeURIComponent(bangkokToday()));
   state.scoreSummary=data.items||[];
  }
  const all=state.scoreSummary;
  const byGrade=state.grade?all.filter(x=>Number(x.grade)===state.grade):all;
  const query=state.monitorQuery.trim().toLocaleLowerCase('th-TH');
  const visible=byGrade.filter(x=>!query||String(x.full_name||'').toLocaleLowerCase('th-TH').includes(query)||
    String(x.student_no||'').toLocaleLowerCase('th-TH').includes(query)||
    String(x.classroom_label||'').toLocaleLowerCase('th-TH').includes(query));
  const sum=key=>byGrade.reduce((n,x)=>n+Number(x[key]||0),0);
  frame(`<section class="card stack">
   <div class="row between"><div><h3>ติดตามคะแนนพฤติกรรม</h3>
    <p class="muted">ข้อมูลนักเรียนตามทะเบียนที่ใช้งาน • จัดเรียงตามห้องเรียน ไม่จัดอันดับหรือตัดสินโทษอัตโนมัติ</p></div>
    <button class="button secondary" type="button" id="affairsMonitorRefresh">↻ อัปเดต</button></div>
   <div class="row"><div class="field smallbox"><label for="affairsGradeSelect">เลือกระดับชั้น</label>
    <select id="affairsGradeSelect"><option value="0">ทุกระดับชั้น</option>
     ${[1,2,3,4,5,6].map(i=>`<option value="${i}" ${state.grade===i?'selected':''}>ม.${i}</option>`).join('')}
    </select></div>
    <div class="field smallbox"><label for="affairsMonitorQuery">ค้นหานักเรียน / รหัส / ห้อง</label>
     <input type="search" id="affairsMonitorQuery" value="${esc(state.monitorQuery)}" placeholder="พิมพ์เพื่อกรองข้อมูล">
    </div></div>
   <div class="rd-affairs-metrics">
    <div><span>นักเรียนในระดับที่เลือก</span><strong>${byGrade.length}</strong></div>
    <div class="good"><span>คะแนนเพิ่มรวม</span><strong>+${sum('earned')}</strong></div>
    <div class="warn-metric"><span>คะแนนที่ถูกหักรวม</span><strong>-${sum('deducted')}</strong></div>
   </div>
   <p class="muted">มีประวัติการบันทึก ${sum('events')} ครั้ง • คะแนนรวมเป็นผลตามรายการจริง ไม่ใช่การจัดกลุ่มผู้เรียนตามความเสี่ยง</p>
  </section>
  <section class="card stack"><div class="row between"><h3>ทะเบียนคะแนนพฤติกรรม</h3>
   <span class="tag">พบ ${visible.length} คน</span></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>ห้อง</th><th>นักเรียน</th>
    <th>เพิ่ม</th><th>หัก</th><th>คะแนนสุทธิ</th><th>รายการ</th></tr></thead><tbody>
    ${visible.slice(0,150).map(row=>`<tr><td>${esc(row.classroom_label)}</td>
      <td>${esc(row.full_name)}<div class="muted">${esc(row.student_no)}</div></td>
      <td>+${Number(row.earned)||0}</td><td>-${Number(row.deducted)||0}</td>
      <td><strong>${formatScore(row.total)}</strong></td><td>${Number(row.events)||0}</td>
    </tr>`).join('')||'<tr><td colspan="6">ยังไม่มีนักเรียนที่ตรงกับตัวกรอง</td></tr>'}
   </tbody></table></div>
   ${visible.length>150?'<p class="muted">แสดง 150 คนแรก กรุณาเลือกระดับชั้นหรือใช้คำค้นหาให้แคบลง</p>':''}
  </section>`);
  bind('#affairsGradeSelect','change',(_,el)=>{state.grade=Number(el.value);return monitor(false)});
  bind('#affairsMonitorQuery','change',(_,el)=>{state.monitorQuery=el.value;return monitor(false)});
  bind('#affairsMonitorRefresh','click',()=>monitor(true));
 }
 const studentPicker=()=>`<section class="card stack"><h3>ค้นหานักเรียน</h3>
   <form id="affairsStudentSearch" class="row">
    <div class="field rd-affairs-search-wide"><label for="affairsStudentQuery">รหัสหรือชื่อ–สกุล</label>
     <input id="affairsStudentQuery" name="query" minlength="2" maxlength="70"
      required value="${esc(state.search)}" placeholder="ค้นหาอย่างน้อย 2 ตัวอักษร"></div>
    <button type="submit" class="button">ค้นหา</button></form>
   ${state.studentMatches.length?`<div class="rd-affairs-search-results">
    ${state.studentMatches.map(x=>`<button type="button" data-affairs-student="${x.id}" class="rd-affairs-search-person">
     <strong>${esc(x.full_name)}</strong><small>${esc(x.student_no)} • ${esc(x.classroom_label)}</small>
    </button>`).join('')}</div>`:''}
  </section>`;
 async function loadCasesData(){
  if(!state.selectedStudent){state.cases=[];state.score=null;return}
  const sid=state.selectedStudent.id;
  const [cases,score]=await Promise.all([
   api('/api/affairs/cases?student_id='+sid),api('/api/behavior?student_id='+sid)]);
  state.cases=cases.items;state.score=score;
 }
 async function cases(){
  await loadCasesData();
  const student=state.selectedStudent;
  frame(`${studentPicker()}
    ${student?`<section class="card stack">
      <div class="row between"><div><h3>ข้อมูลพฤติกรรม: ${esc(student.full_name)}</h3>
       <p class="muted">${esc(student.student_no)} • ${esc(student.classroom_label)}</p></div>
       <span class="tag">คะแนนสะสม ${formatScore(state.score?.total)}</span></div>
      <div class="grid two"><form id="affairsAdjustment" class="stack">
       <h3>ปรับคะแนนพฤติกรรม</h3>
       <p class="muted">สำหรับฝ่ายกิจการนักเรียนเท่านั้น บันทึกประวัติและเหตุผลทุกครั้ง</p>
       <div class="field"><label>คะแนนที่ปรับ (+/-)</label><input type="number" name="points" min="-50" max="50" required></div>
       <div class="field"><label>เหตุผลที่ปรับคะแนน</label><textarea name="reason" maxlength="300" required></textarea></div>
       <button type="submit" class="button secondary">บันทึกการปรับคะแนน</button>
      </form><form id="affairsNewCase" class="stack"><h3>บันทึกภาคทัณฑ์ / ทัณฑ์บน</h3>
       <div class="field"><label>มาตรการ</label><select name="measure">
        <option value="reprimand">ภาคทัณฑ์</option><option value="probation">ทัณฑ์บน</option></select></div>
       <div class="field"><label>วันที่เกิดเหตุ</label><input type="date" name="school_date" max="${bangkokToday()}" value="${bangkokToday()}" required></div>
       <div class="field"><label>เหตุการณ์ที่ตรวจสอบแล้ว</label><textarea name="details" maxlength="2000" required></textarea></div>
       <div class="field"><label>เงื่อนไข/ข้อตกลง</label><textarea name="conditions" maxlength="2000"></textarea></div>
       <div class="field"><label>วันที่แจ้งผู้ปกครอง (ถ้ามี)</label><input type="date" name="guardian_informed_date" max="${bangkokToday()}"></div>
       <div class="field"><label>วันที่ผู้ปกครองรับทราบ (ถ้ามี)</label><input type="date" name="guardian_ack_date" max="${bangkokToday()}"></div>
       <button type="submit" class="button">บันทึกมาตรการ</button>
      </form></div>
     </section>
     <section class="card stack"><h3>ทะเบียนภาคทัณฑ์และทัณฑ์บน</h3>
      ${state.cases.map(c=>`<article class="rd-affairs-case">
       <div class="row between"><strong>${c.measure==='probation'?'ทัณฑ์บน':'ภาคทัณฑ์'}</strong><span class="tag">${esc(c.state)}</span></div>
       <p>${esc(thDate(c.school_date))} • ${esc(c.details)}</p>
       ${c.conditions?`<p class="muted">เงื่อนไข: ${esc(c.conditions)}</p>`:''}
       <p class="muted">ผู้บันทึก: ${esc(c.recorder_name)} • แจ้งผู้ปกครอง: ${esc(c.guardian_informed_date||'ยังไม่บันทึก')}
        • รับทราบ: ${esc(c.guardian_ack_date||'ยังไม่บันทึก')}</p>
       <form class="stack" data-affairs-review="${c.id}">
        <div class="row"><div class="field"><label>สถานะ</label><select name="state">
         ${[['active','ดำเนินการอยู่'],['resolved','เสร็จสิ้น'],['cancelled','ยกเลิก']].map(([v,label])=>
           `<option value="${v}" ${c.state===v?'selected':''}>${label}</option>`).join('')}</select></div>
         <div class="field"><label>วันที่แจ้งผู้ปกครอง</label><input type="date" name="guardian_informed_date" max="${bangkokToday()}" value="${esc(c.guardian_informed_date||'')}"></div>
         <div class="field"><label>วันที่รับทราบ</label><input type="date" name="guardian_ack_date" max="${bangkokToday()}" value="${esc(c.guardian_ack_date||'')}"></div></div>
        <div class="field"><label>หมายเหตุการติดตาม/ผลการดำเนินการ</label><textarea name="resolution" maxlength="1000">${esc(c.resolution||'')}</textarea></div>
        <button type="submit" class="button secondary">บันทึกการติดตาม</button>
       </form>
      </article>`).join('')||'<div class="empty">ยังไม่มีการบันทึกภาคทัณฑ์หรือทัณฑ์บน</div>'}
     </section>
     <section class="card stack"><h3>ประวัติคะแนนพฤติกรรม</h3>
      ${(state.score?.items||[]).map(e=>`<div class="rd-affairs-score">
       <strong>${formatScore(e.points)}</strong><span>${esc(e.reason)}</span><small>${esc(e.created_at)}</small></div>`).join('')||'<p class="empty">ยังไม่มีการบันทึกคะแนน</p>'}
     </section>`:''}`);
  bind('#affairsStudentSearch','submit',async e=>{
   e.preventDefault();const query=String(new FormData(e.currentTarget).get('query')).trim();
   state.search=query;state.studentMatches=(await api('/api/affairs/students?query='+encodeURIComponent(query))).items;await cases();
  });
  bind('[data-affairs-student]','click',(_,el)=>{
   state.selectedStudent=state.studentMatches.find(x=>x.id===Number(el.dataset.affairsStudent));return cases();
  });
  bind('#affairsAdjustment','submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget);
   await api('/api/affairs/behavior/adjust',{method:'POST',body:{
    student_id:student.id,points:Number(f.get('points')),reason:String(f.get('reason'))}});
   toast('บันทึกการปรับคะแนนพร้อมประวัติแล้ว');await cases();
  });
  bind('#affairsNewCase','submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget);
   await api('/api/affairs/cases',{method:'POST',body:{student_id:student.id,
    measure:String(f.get('measure')),school_date:String(f.get('school_date')),
    details:String(f.get('details')),conditions:String(f.get('conditions')),
    guardian_informed_date:f.get('guardian_informed_date')||null,
    guardian_ack_date:f.get('guardian_ack_date')||null}});
   toast('บันทึกมาตรการและประวัติเรียบร้อย');await cases();
  });
  bind('[data-affairs-review]','submit',async(e,el)=>{
   e.preventDefault();const f=new FormData(el);
   await api('/api/affairs/cases/'+Number(el.dataset.affairsReview)+'/review',{method:'POST',body:{
    state:String(f.get('state')),resolution:String(f.get('resolution')),
    guardian_informed_date:f.get('guardian_informed_date')||null,
    guardian_ack_date:f.get('guardian_ack_date')||null}});
   toast('อัปเดตสถานะการติดตามแล้ว');await cases();
  });
 }
 return {load};
}
