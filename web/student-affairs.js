import {scoreHistoryTables} from './score-history.js';
// RD CONNECT • Student Affairs workbench. Only the existing staff/admin role
// opens this workspace; backend independently checks every action.
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const thDate=v=>v?new Intl.DateTimeFormat('th-TH',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'})
 .format(new Date(v+'T00:00:00Z')):'';
const bangkokToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const types={good:'คะแนนความดี',minor:'ความผิดเล็กน้อย',moderate:'ความผิดปานกลาง',
 serious:'ความผิดร้ายแรง',very_serious:'ความผิดร้ายแรงมาก',adjustment:'ปรับพฤติกรรม'};
const formatScore=n=>Number(n)>0?'+'+Number(n):String(Number(n)||0);
export function createStudentAffairs({api,mount,safeRun,toast,rooms}){
 const state={tab:'attendance',date:bangkokToday(),attendance:null,people:null,rules:null,
  selectedStudent:null,studentMatches:[],cases:[],score:null,ruleEdit:null,search:'',
  grade:0,monitorQuery:'',monitorLimit:100,monitorStudent:null,monitorScore:null,monitorCases:[],scoreSummary:[],ruleKind:'behavior',adjustmentRules:[],adjustmentGrade:0,adjustmentStatus:'all',adjustmentQuery:''};
 const bind=(selector,event,fn)=>document.querySelectorAll(selector).forEach(node=>
  node.addEventListener(event,e=>safeRun(()=>fn(e,node))));
 const frame=(body)=>{
  const tabs=[['attendance','📋','ติดตามเช็กชื่อ'],['people','👥','หัวหน้าระดับ/ที่ปรึกษา'],
   ['rules','⭐','เกณฑ์พฤติกรรม'],['monitor','📊','ติดตามคะแนน'],['adjustments','📈','ติดตามการปรับพฤติกรรม'],['cases','📑','ภาคทัณฑ์/ทัณฑ์บน']];
  mount(`<section class="rd-affairs">
   <header class="rd-affairs-hero"><div><span>RD CONNECT • STUDENT AFFAIRS</span>
    <h2>ฝ่ายกิจการนักเรียน</h2>
    <p>ติดตาม สนับสนุนการทำงานของครู และดูแลข้อมูลนักเรียนตามสิทธิ์</p></div>
    <span aria-hidden="true" class="rd-affairs-hero-icon">🏫</span></header>
   <nav class="rd-affairs-tabs" aria-label="ส่วนงานฝ่ายกิจการนักเรียน">
    ${tabs.map(([id,icon,name])=>`<button type="button" data-affairs-tab="${id}"
      class="${state.tab===id?'active':''}" aria-current="${state.tab===id?'page':'false'}">${icon} ${name}</button>`).join('')}
   </nav><div class="rd-affairs-content">${body}</div></section>`);
  document.body.classList.toggle('rd-affairs-modal-open',Boolean(document.getElementById('affairsStudentOverlay')));
  bind('[data-affairs-tab]','click',(_,btn)=>load(btn.dataset.affairsTab));
  bindMonitorDialog();
 };
 async function load(tab=state.tab){
  if(tab!==state.tab){
   state.monitorStudent=null;state.monitorScore=null;state.monitorCases=[];
  }
  state.tab=tab;
  if(tab==='attendance')return attendance();
  if(tab==='people')return people();
  if(tab==='rules')return rules();
  if(tab==='monitor')return monitor();
  if(tab==='adjustments')return trackAdjustments();
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
  const [data,adjustments]=await Promise.all([
   api('/api/affairs/behavior/rules'),
   api('/api/affairs/behavior/adjustment-rules')
  ]);
  state.rules=data.items||[];state.adjustmentRules=adjustments.items||[];
  const kind=state.ruleKind,isAdjustment=kind==='adjustment',isGood=kind==='good';
  const items=isAdjustment?state.adjustmentRules:
   state.rules.filter(rule=>isGood?rule.category==='good':rule.category!=='good');
  const selected=items.find(x=>x.id===state.ruleEdit);
  const title=isAdjustment?'เกณฑ์ปรับพฤติกรรม':isGood?'เกณฑ์คะแนนความดี':'เกณฑ์คะแนนความผิด';
  frame(`<section class="card stack">
    <h3>กำหนดเกณฑ์คะแนนโรงเรียน</h3>
    <p class="muted">คะแนนความดีเป็นยอดสะสมอิสระจากคะแนนพฤติกรรม
     และคะแนนความผิดที่บันทึกไว้จะลดลงได้เฉพาะผ่านเกณฑ์ปรับพฤติกรรมเท่านั้น
     การเปลี่ยนเกณฑ์ไม่เปลี่ยนประวัติเดิม</p>
    <div class="rd-affairs-rule-tabs" role="group" aria-label="หมวดเกณฑ์คะแนน">
     ${[['behavior','ความผิด 4 ระดับ'],['good','คะแนนความดี'],['adjustment','ปรับพฤติกรรม']].map(([k,n])=>`
      <button type="button" class="button ${kind===k?'':'secondary'}" data-affairs-rule-kind="${k}"
       aria-pressed="${kind===k}">${n}</button>`).join('')}
    </div>
    <h3>${title}</h3>
    <p class="muted">${isAdjustment?'ตัวอย่าง: ปรับพฤติกรรม 5 คะแนน หรือ 10 คะแนน กำหนดตามระเบียบที่ฝ่ายกิจการนักเรียนอนุมัติ':
      isGood?'คะแนนความดีใช้สะสมและแสดงผลแยก ไม่สามารถล้างคะแนนความผิด':
      'กรุณากำหนดคะแนนหักสำหรับความผิดเล็กน้อย ปานกลาง ร้ายแรง และร้ายแรงมาก'}</p>
    <form id="affairsRuleForm" class="stack">
     <div class="field"><label>ชื่อรายการ / ชื่อเกณฑ์</label>
      <input name="name" maxlength="120" required value="${esc(selected?.name||'')}"
       placeholder="${isAdjustment?'เช่น ปรับพฤติกรรม 5 คะแนน':isGood?'เช่น จิตอาสาช่วยงานโรงเรียน':'ระบุพฤติกรรมที่ไม่พึงประสงค์'}"></div>
     <div class="grid two">
      ${!isAdjustment&&!isGood?`<div class="field"><label>ระดับความผิด</label><select name="category">
      ${Object.entries(types).filter(([key])=>!['good','adjustment'].includes(key)).map(([k,v])=>
       `<option value="${k}" ${selected?.category===k?'selected':''}>${v}</option>`).join('')}
      </select></div>`:''}
      <div class="field"><label>${isAdjustment?'คะแนนปรับพฤติกรรม (+)':isGood?'คะแนนความดี (+)':'คะแนนความผิดที่หัก (-)'}</label>
       <input name="points" type="number" ${isAdjustment||isGood?'min="1" max="50"':'min="-50" max="-1"'} required
        value="${selected?.points||''}" placeholder="${isAdjustment?'5 หรือ 10':isGood?'5':'-5'}"></div>
     </div>
     <label class="row"><input name="active" type="checkbox" ${!selected||selected.active?'checked':''}> เปิดใช้งานเกณฑ์นี้</label>
     <div class="row"><button type="submit" class="button">${selected?'บันทึกแก้ไขเกณฑ์':'เพิ่มเกณฑ์คะแนน'}</button>
      ${selected?'<button type="button" class="button secondary" id="affairsRuleCancel">ยกเลิกการแก้ไข</button>':''}</div>
    </form>
   </section>
   <section class="card stack"><h3>รายการ${title}</h3>
    <div class="rd-affairs-rule-grid">${items.map(rule=>`
     <article class="rd-affairs-rule ${rule.active?'':'inactive'}">
      <div class="row between"><strong>${esc(rule.name)}</strong><b>${formatScore(rule.points)}</b></div>
      <p class="muted">${esc(isAdjustment?'ลดคะแนนความผิดคงเหลือ':types[rule.category])}
       • ${rule.active?'ใช้งาน':'ปิดใช้งาน'}</p>
      <button type="button" class="button secondary" data-affairs-rule-edit="${rule.id}">แก้ไขเกณฑ์</button>
     </article>`).join('')||'<p class="empty">ยังไม่ได้ตั้งเกณฑ์ในหมวดนี้</p>'}</div>
   </section>`);
  bind('[data-affairs-rule-kind]','click',(_,el)=>{
   state.ruleKind=el.dataset.affairsRuleKind;state.ruleEdit=null;return rules();
  });
  bind('[data-affairs-rule-edit]','click',(_,el)=>{state.ruleEdit=Number(el.dataset.affairsRuleEdit);return rules()});
  bind('#affairsRuleCancel','click',()=>{state.ruleEdit=null;return rules()});
  bind('#affairsRuleForm','submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget);
   const points=Number(f.get('points')),payload={
    ...(state.ruleEdit?{id:state.ruleEdit}:{}),name:String(f.get('name')),
    points,active:f.get('active')==='on'
   };
   if(!isAdjustment)payload.category=isGood?'good':String(f.get('category'));
   await api(isAdjustment?'/api/affairs/behavior/adjustment-rules':'/api/affairs/behavior/rules',
    {method:'POST',body:payload});
   state.ruleEdit=null;toast('บันทึกเกณฑ์แล้ว');await rules();
  });
 }
 const monitorDetailModal=()=>`${state.monitorStudent?`<div class="rd-affairs-modal-overlay" id="affairsStudentOverlay">
   <section class="card stack rd-affairs-modal-dialog" id="affairsMonitorDetail" role="dialog" aria-modal="true" aria-labelledby="affairsDialogHeading" tabindex="-1">
   <div class="row between"><div><h3 id="affairsDialogHeading">รายละเอียดนักเรียน: ${esc(state.monitorStudent.full_name)}</h3>
     <p class="muted">เลขประจำตัว ${esc(state.monitorStudent.student_no)} • ห้อง ${esc(state.monitorStudent.classroom_label)}</p></div>
     <button class="rd-affairs-modal-x" type="button" id="affairsMonitorClose" aria-label="ปิดรายละเอียดนักเรียน" title="ปิดรายละเอียด">×</button></div>
   <div class="rd-affairs-metrics">
    <div class="good"><span>คะแนนความดีสะสม</span><strong>+${Number(state.monitorScore?.good_total)||0}</strong></div>
    <div><span>ความผิดรวม / ปรับแล้ว</span><strong>${Number(state.monitorScore?.behavior_deducted)||0} / ${Number(state.monitorScore?.behavior_adjusted)||0}</strong></div>
    <div class="warn-metric"><span>คะแนนความผิดคงเหลือ</span><strong>${Number(state.monitorScore?.behavior_remaining)||0}</strong></div>
   </div>
   ${scoreHistoryTables({items:state.monitorScore?.items||[],mode:'all',esc})}
   ${state.monitorScore?.has_more?'<button class="button secondary" type="button" id="affairsMonitorMore">ดูรายการคะแนนเพิ่มเติม</button>':''}
   <h4>มาตรการภาคทัณฑ์และทัณฑ์บน</h4>
   ${state.monitorCases.length?state.monitorCases.map(c=>`<article class="rd-affairs-case">
    <div class="row between"><strong>${c.measure==='probation'?'ทัณฑ์บน':'ภาคทัณฑ์'}</strong>
     <span class="tag">${esc(c.state)}</span></div>
    <p>วันที่ ${esc(thDate(c.school_date))} • รายละเอียด: ${esc(c.details)}</p>
    ${c.conditions?`<p>เงื่อนไข: ${esc(c.conditions)}</p>`:''}
    ${c.resolution?`<p>ผลติดตาม: ${esc(c.resolution)}</p>`:''}
    <p class="muted">ผู้บันทึก ${esc(c.recorder_name)} • แจ้งผู้ปกครอง ${esc(c.guardian_informed_date||'ยังไม่บันทึก')}
    • ผู้ปกครองรับทราบ ${esc(c.guardian_ack_date||'ยังไม่บันทึก')}</p>
   </article>`).join(''):'<p class="empty">ยังไม่มีมาตรการภาคทัณฑ์หรือทัณฑ์บน</p>'}
  </section></div>`:''}`;
 async function redrawScorePage(){
  return state.tab==='adjustments'?trackAdjustments(false):monitor(false);
 }
 function closeMonitorDialog(){
  const selectedId=state.monitorStudent?.student_id;
  state.monitorStudent=null;state.monitorScore=null;state.monitorCases=[];
  return redrawScorePage().then(()=>{
   const button=document.querySelector('[data-monitor-detail="'+Number(selectedId)+'"]');
   if(button)button.focus();
  });
 }
 function bindMonitorDialog(){
  bind('[data-monitor-detail]','click',async(_,el)=>{
   const student=state.scoreSummary.find(x=>Number(x.student_id)===Number(el.dataset.monitorDetail));
   if(!student)return;
   state.monitorStudent=student;await loadMonitorStudentDetail();await redrawScorePage();
   document.getElementById('affairsMonitorClose')?.focus();
  });
  bind('#affairsMonitorClose','click',()=>closeMonitorDialog());
  bind('#affairsStudentOverlay','click',(event,el)=>{if(event.target===el)return closeMonitorDialog()});
  bind('#affairsMonitorDetail','keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();return closeMonitorDialog()}
   if(event.key!=='Tab')return;
   const dialog=event.currentTarget;
   const items=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')];
   if(!items.length){event.preventDefault();dialog.focus();return}
   const first=items[0],last=items[items.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
  bind('#affairsMonitorMore','click',async()=>{
   await loadMonitorStudentDetail({more:true});await redrawScorePage();
   document.getElementById('affairsMonitorClose')?.focus();
  });
  bind('#affairsMonitorDetail [data-score-delete]','click',async(_,el)=>{
   const recordId=Number(el.dataset.scoreDelete);
   if(!window.confirm('ยืนยันลบเฉพาะรายการคะแนนที่คุณบันทึกเอง? ระบบจะเก็บหลักฐานการลบ'))return;
   await api('/api/behavior/records/'+recordId+'/delete',{method:'POST',body:{}});
   toast('ลบรายการและคำนวณคะแนนใหม่แล้ว');
   await redrawScorePageWithRefresh();
  });
 }
 async function redrawScorePageWithRefresh(){
  return state.tab==='adjustments'?trackAdjustments(true):monitor(true);
 }
 async function loadMonitorStudentDetail({more=false}={}){
  const student=state.monitorStudent;
  if(!student)return;
  const id=Number(student.student_id);
  const offset=more?Number(state.monitorScore?.next_offset||0):0;
  const [score,cases]=await Promise.all([
   api('/api/behavior?student_id='+id+'&offset='+offset),
   more?Promise.resolve(null):api('/api/affairs/cases?student_id='+id)
  ]);
  if(Number(state.monitorStudent?.student_id)!==id)return;
  state.monitorScore=more?{...score,items:[...(state.monitorScore?.items||[]),...(score.items||[])]}:score;
  if(cases)state.monitorCases=cases.items||[];
 }
 async function monitor(refresh=true){

  if(refresh){
   const data=await api('/api/affairs/behavior/summary?date='+encodeURIComponent(bangkokToday()));
   state.scoreSummary=data.items||[];
   if(state.monitorStudent){
    const found=state.scoreSummary.find(x=>x.student_id===state.monitorStudent.student_id);
    state.monitorStudent=found||null;
    if(found)await loadMonitorStudentDetail();
    else{state.monitorScore=null;state.monitorCases=[]}
   }
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
    </div>
    <div class="field smallbox"><label for="affairsMonitorLimit">แสดงรายชื่อ</label>
      <select id="affairsMonitorLimit">
       ${[['50','50 คน'],['100','100 คน'],['200','200 คน'],['0','ทั้งหมด']].map(([value,text])=>
        `<option value="${value}" ${Number(value)===state.monitorLimit?'selected':''}>${text}</option>`).join('')}
      </select>
    </div></div>
   <div class="rd-affairs-metrics">
    <div><span>นักเรียนในระดับที่เลือก</span><strong>${byGrade.length}</strong></div>
    <div class="good"><span>คะแนนความดีสะสม</span><strong>+${sum('good_total')}</strong></div>
    <div class="warn-metric"><span>คะแนนความผิดคงเหลือ</span><strong>${sum('behavior_remaining')}</strong></div>
   </div>
   <p class="muted">บันทึก ${sum('events')} ครั้ง • ความผิดรวม ${sum('behavior_deducted')} คะแนน • ปรับพฤติกรรมแล้ว ${sum('behavior_adjusted')} คะแนน • ความดีไม่หักล้างความผิด</p>
  </section>
  <section class="card stack"><div class="row between"><h3>ทะเบียนคะแนนพฤติกรรม</h3>
   <span class="tag">พบ ${visible.length} คน</span></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>ห้อง</th><th>นักเรียน</th>
    <th>ความดี</th><th>ความผิด</th><th>ปรับแล้ว</th><th>ความผิดคงเหลือ</th><th>รายละเอียด</th></tr></thead><tbody>
    ${visible.slice(0,state.monitorLimit||visible.length).map(row=>`<tr><td>${esc(row.classroom_label)}</td>
      <td><button type="button" class="rd-monitor-student-link" data-monitor-detail="${row.student_id}">${esc(row.full_name)}</button><div class="muted">${esc(row.student_no)}</div></td>
      <td>+${Number(row.good_total)||0}</td><td>${Number(row.behavior_deducted)||0}</td>
      <td>${Number(row.behavior_adjusted)||0}</td><td><strong>${Number(row.behavior_remaining)||0}</strong></td>
      <td><button class="button secondary" type="button" data-monitor-detail="${row.student_id}">ดูรายละเอียด</button></td>
    </tr>`).join('')||'<tr><td colspan="7">ยังไม่มีนักเรียนที่ตรงกับตัวกรอง</td></tr>'}
   </tbody></table></div>
   ${state.monitorLimit&&visible.length>state.monitorLimit?'<p class="muted">สามารถเปลี่ยนจำนวนแถวเป็นทั้งหมดเพื่อดูนักเรียนที่เหลือ</p>':''}
  </section>
  ${monitorDetailModal()}`);
  bind('#affairsGradeSelect','change',(_,el)=>{state.grade=Number(el.value);return monitor(false)});
  bind('#affairsMonitorQuery','change',(_,el)=>{state.monitorQuery=el.value;return monitor(false)});
  bind('#affairsMonitorRefresh','click',()=>monitor(true));
  bind('#affairsMonitorLimit','change',(_,el)=>{state.monitorLimit=Number(el.value);return monitor(false)});

 }

 const improvementStatus=row=>{
  if(Number(row.behavior_deducted)<=0)return 'none';
  if(Number(row.behavior_remaining)<=0)return 'completed';
  return Number(row.behavior_adjusted)>0?'progress':'pending';
 };
 const improvementLabels={pending:'ยังไม่บันทึกการปรับ',progress:'ปรับแล้วบางส่วน',completed:'ปรับครบตามคะแนน'};
 async function trackAdjustments(refresh=true){
  if(refresh){
   const data=await api('/api/affairs/behavior/summary?date='+encodeURIComponent(bangkokToday()));
   state.scoreSummary=data.items||[];
   if(state.monitorStudent){
    const found=state.scoreSummary.find(row=>Number(row.student_id)===Number(state.monitorStudent.student_id));
    state.monitorStudent=found||null;
    if(found)await loadMonitorStudentDetail();
    else{state.monitorScore=null;state.monitorCases=[]}
   }
  }
  const items=state.scoreSummary.filter(row=>Number(row.behavior_deducted)>0);
  const byGrade=state.adjustmentGrade?items.filter(row=>Number(row.grade)===state.adjustmentGrade):items;
  const query=state.adjustmentQuery.trim().toLocaleLowerCase('th-TH');
  const visible=byGrade.filter(row=>{
   if(state.adjustmentStatus!=='all'&&improvementStatus(row)!==state.adjustmentStatus)return false;
   return !query||[row.full_name,row.student_no,row.classroom_label].some(value=>
    String(value||'').toLocaleLowerCase('th-TH').includes(query));
  });
  const sum=key=>byGrade.reduce((n,row)=>n+Number(row[key]||0),0);
  frame(`<section class="card stack">
   <div class="row between"><div><h3>ติดตามการปรับพฤติกรรม</h3>
    <p class="muted">สรุปความคืบหน้าการปรับคะแนนสำหรับนักเรียนที่มีประวัติความผิด
     สถานะเป็นเพียงข้อมูลคะแนน ไม่ใช่คำตัดสินพฤติกรรมนักเรียน</p></div>
    <button id="affairsAdjustmentRefresh" type="button" class="button secondary">↻ อัปเดต</button></div>
   <div class="rd-affairs-metrics">
    <div><span>นักเรียนที่มีประวัติความผิด</span><strong>${byGrade.length}</strong></div>
    <div class="good"><span>คะแนนปรับพฤติกรรมรวม</span><strong>${sum('behavior_adjusted')}</strong></div>
    <div class="warn-metric"><span>คะแนนความผิดคงเหลือรวม</span><strong>${sum('behavior_remaining')}</strong></div>
   </div>
   <div class="row">
    <div class="field smallbox"><label for="affairsAdjustmentGrade">ระดับชั้น</label>
     <select id="affairsAdjustmentGrade"><option value="0">ทุกระดับชั้น</option>
      ${[1,2,3,4,5,6].map(i=>`<option value="${i}" ${state.adjustmentGrade===i?'selected':''}>ม.${i}</option>`).join('')}
     </select></div>
    <div class="field smallbox"><label for="affairsAdjustmentStatus">สถานะ</label>
     <select id="affairsAdjustmentStatus">
      ${Object.entries({all:'ทุกสถานะ',...improvementLabels}).map(([key,label])=>
       `<option value="${key}" ${state.adjustmentStatus===key?'selected':''}>${label}</option>`).join('')}
     </select></div>
    <div class="field smallbox"><label for="affairsAdjustmentQuery">ค้นหาชื่อ รหัส หรือห้อง</label>
     <input id="affairsAdjustmentQuery" type="search" value="${esc(state.adjustmentQuery)}" placeholder="พิมพ์ค้นหา"></div>
   </div>
  </section>
  <section class="card stack">
   <div class="row between"><h3>ทะเบียนติดตามการปรับพฤติกรรม</h3><span class="tag">พบ ${visible.length} คน</span></div>
   <div class="table-wrap"><table class="table"><thead><tr>
    <th>ห้อง</th><th>นักเรียน / เลขประจำตัว</th><th>ความผิดรวม</th><th>ปรับแล้ว</th>
    <th>คงเหลือ</th><th>สถานะ</th><th>รายละเอียด</th></tr></thead><tbody>
    ${visible.map(row=>`<tr>
     <td>${esc(row.classroom_label)}</td>
     <td><button type="button" class="rd-monitor-student-link" data-monitor-detail="${row.student_id}">${esc(row.full_name)}</button>
      <div class="muted">${esc(row.student_no)}</div></td>
     <td>${Number(row.behavior_deducted)||0}</td><td>${Number(row.behavior_adjusted)||0}</td>
     <td><strong>${Number(row.behavior_remaining)||0}</strong></td>
     <td><span class="tag">${improvementLabels[improvementStatus(row)]}</span></td>
     <td><button type="button" class="button secondary" data-monitor-detail="${row.student_id}">ดูรายละเอียด</button></td>
    </tr>`).join('')||'<tr><td colspan="7">ไม่มีนักเรียนที่ตรงกับเงื่อนไข</td></tr>'}
    </tbody></table></div>
  </section>
  ${monitorDetailModal()}`);
  bind('#affairsAdjustmentRefresh','click',()=>trackAdjustments(true));
  bind('#affairsAdjustmentGrade','change',(_,el)=>{state.adjustmentGrade=Number(el.value);return trackAdjustments(false)});
  bind('#affairsAdjustmentStatus','change',(_,el)=>{state.adjustmentStatus=el.value;return trackAdjustments(false)});
  bind('#affairsAdjustmentQuery','change',(_,el)=>{state.adjustmentQuery=el.value;return trackAdjustments(false)});
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
  const [cases,score,adjustments]=await Promise.all([
   api('/api/affairs/cases?student_id='+sid),api('/api/behavior?student_id='+sid),
   api('/api/affairs/behavior/adjustment-rules')]);
  state.cases=cases.items;state.score=score;state.adjustmentRules=adjustments.items||[];
 }
 async function cases(){
  await loadCasesData();
  const student=state.selectedStudent;
  frame(`${studentPicker()}
    ${student?`<section class="card stack">
      <div class="row between"><div><h3>ข้อมูลพฤติกรรม: ${esc(student.full_name)}</h3>
       <p class="muted">${esc(student.student_no)} • ${esc(student.classroom_label)}</p></div>
       <div class="stack"><span class="tag">คะแนนความดี ${Number(state.score?.good_total)||0}</span>
        <span class="tag">คะแนนความผิดคงเหลือ ${Number(state.score?.behavior_remaining)||0}</span></div></div>
      <div class="grid two"><form id="affairsAdjustment" class="stack">
       <h3>ปรับพฤติกรรมตามเกณฑ์</h3>
       <p class="muted">ลดเฉพาะคะแนนความผิดคงเหลือ • ความดีไม่ถูกนำมาหักลบ • ต้องเลือกเกณฑ์ที่กำหนดโดยฝ่ายกิจการนักเรียน</p>
       <div class="field"><label>เกณฑ์ปรับพฤติกรรมที่เปิดใช้งาน</label>
        <select name="adjustment_rule_id" required><option value="">เลือกเกณฑ์ปรับพฤติกรรม</option>
         ${state.adjustmentRules.filter(r=>r.active).map(r=>`<option value="${r.id}"
          ${Number(r.points)>Number(state.score?.behavior_remaining||0)?'disabled':''}>
          ${esc(r.name)} (${Number(r.points)} คะแนน)</option>`).join('')}
        </select></div>
       <div class="field"><label>หลักฐานและรายละเอียดการปรับพฤติกรรม</label><textarea name="reason" maxlength="300" required></textarea></div>
       <button type="submit" class="button secondary" ${!state.adjustmentRules.some(r=>r.active&&r.points<=Number(state.score?.behavior_remaining||0))?'disabled':''}>บันทึกการปรับพฤติกรรม</button>
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
     <section class="card stack"><h3>ประวัติคะแนนพฤติกรรมและการปรับพฤติกรรม</h3>
      ${(state.score?.items||[]).filter(e=>e.score_type!=='good').map(e=>`<div class="rd-affairs-score">
       <strong>${formatScore(e.points)}</strong><span>${esc(e.score_type==='adjustment'?'ปรับพฤติกรรม':'ความผิด')} • ${esc(e.reason)}</span><small>${esc(e.created_at)}</small></div>`).join('')||'<p class="empty">ยังไม่มีรายการ</p>'}
     </section>
     <section class="card stack"><h3>ประวัติคะแนนความดี (แยกต่างหาก)</h3>
      ${(state.score?.items||[]).filter(e=>e.score_type==='good').map(e=>`<div class="rd-affairs-score">
       <strong>+${Number(e.points)}</strong><span>${esc(e.reason)}</span><small>${esc(e.created_at)}</small></div>`).join('')||'<p class="empty">ยังไม่มีรายการความดี</p>'}
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
    student_id:student.id,adjustment_rule_id:Number(f.get('adjustment_rule_id')),reason:String(f.get('reason'))}});
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
