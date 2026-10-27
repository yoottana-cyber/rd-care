// Modern period attendance hub: interactive weekly timetable + course-based reports.
// No sample student data; all counts and events come from authenticated RD CONNECT APIs.
const days=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
const shortDays=['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const utc=s=>Date.parse(s+'T12:00:00Z');
const date=millis=>new Date(millis).toISOString().slice(0,10);
const addDays=(value,days)=>date(utc(value)+days*86400000);
export const weekMonday=value=>addDays(value,-((new Date(utc(value)).getUTCDay()+6)%7));
export const lessonPeriod=slot=>(slot.end_period||slot.period)===slot.period?String(slot.period):slot.period+'-'+slot.end_period;
export function buildWeekRows(lessons,monday){
 const list=lessons.filter(x=>x.active!==0&&x.approval_status==='approved'&&x.period>=1&&x.period<=10);
 const count=list.some(x=>x.day_of_week>=6)?7:5;
 return Array.from({length:count},(_,i)=>{
  const day_of_week=i+1, day=addDays(monday,i);
  const lessonForDay=list.filter(x=>x.day_of_week===day_of_week).sort((a,b)=>a.period-b.period);
  const cells=[];
  for(let p=1;p<=10;){
   const found=lessonForDay.find(x=>x.period===p);
   const span=found?Math.min(11-p,Math.max(1,(found.end_period||found.period)-p+1)):1;
   cells.push({period:p,span,lesson:found||null});p+=span;
  }
  return {day_of_week,date:day,dayLabel:days[i],dayShort:shortDays[i],cells};
 });
}
function defaultFrom(today){return addDays(today,-29);}
function number(value){return (Number(value)||0).toLocaleString('th-TH');}
export function createPeriodCenter({api,mount,safeRun,openLesson,openEditor,toast,today}){
 let view='week',week=weekMonday(today()),lessons=[],statuses=[],report=[],
  from=defaultFrom(today()),to=today(),detailSlot=null,details=[],teachingLogs=[],detailLimited=false;
 const current=()=>today();
 const statusFor=(id,schoolDate)=>statuses.find(x=>x.timetable_id===id&&x.school_date===schoolDate);
 const activeLessons=()=>lessons.filter(x=>x.approval_status==='approved'&&x.active!==0);
 function header(){
  return `<section class="period-top"><div>
   <span class="period-eyebrow">RD CONNECT · SMART CLASSROOM</span>
   <h2>📚 เช็กชื่อรายคาบ</h2>
   <p>ตารางสอนรายสัปดาห์และรายงานรายวิชาในหน้าจอเดียว</p></div>
   <button type="button" class="button secondary" id="periodManage">⚙️ จัดการตารางสอน</button>
   </section>
   <nav class="period-tabs" aria-label="เมนูเช็กชื่อรายคาบ">
    <button type="button" data-period-view="week" class="${view==='week'?'active':''}" aria-current="${view==='week'?'page':'false'}">🗓️ ตารางสอนรายสัปดาห์</button>
    <button type="button" data-period-view="report" class="${view==='report'?'active':''}" aria-current="${view==='report'?'page':'false'}">📊 รายงานการเช็กชื่อ</button>
    <button type="button" id="periodSettingsTab">⚙️ ตั้งค่าตารางสอน</button>
   </nav>`;
 }
 function bindCommon(){
  document.querySelector('#periodManage')?.addEventListener('click',()=>openEditor());
  document.querySelector('#periodSettingsTab')?.addEventListener('click',()=>openEditor());
  document.querySelectorAll('[data-period-view]').forEach(el=>el.addEventListener('click',()=>safeRun(async()=>{
   if(el.dataset.periodView===view)return;
   view=el.dataset.periodView; await (view==='week'?loadWeek():loadReport());
  })));
 }
 async function loadWeek(){
  const selectedWeek=week;
  const [timetable,review]=await Promise.all([
   api('/api/my-timetable'),
   api('/api/my-timetable/week-status?start='+encodeURIComponent(selectedWeek))
  ]);
  if(view!=='week'||week!==selectedWeek)return;
  lessons=timetable.items;statuses=review.items;renderWeek();
 }
 function renderWeek(){
  const valid=activeLessons(),rooms=new Set(valid.map(x=>x.classroom_id)).size;
  const weekEnd=addDays(week,6),weekTitle=new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const cells=buildWeekRows(lessons,week);
  const recorded=statuses.filter(x=>Number(x.recorded)>0).length;
  mount(`<section class="period-center stack">${header()}
   <div class="period-stats">
    <div class="period-stat"><span>📘</span><div><strong>${number(valid.length)}</strong><small>วิชาที่ลงตาราง</small></div></div>
    <div class="period-stat"><span>🏫</span><div><strong>${number(rooms)}</strong><small>ห้องเรียนที่สอน</small></div></div>
    <div class="period-stat"><span>✅</span><div><strong>${number(recorded)}</strong><small>รายการที่บันทึกในสัปดาห์</small></div></div>
   </div>
   <section class="card stack period-week-panel">
    <div class="period-panel-title"><div><h3>ตารางสอนรายสัปดาห์</h3><p class="muted">คลิกวิชาในช่องคาบเพื่อเช็กชื่อนักเรียนได้ทันที</p></div>
    <div class="period-week-controls"><button type="button" class="button ghost" id="periodPrevWeek" aria-label="สัปดาห์ก่อน">‹</button>
     <strong>${esc(weekTitle.format(new Date(utc(week))))} – ${esc(weekTitle.format(new Date(utc(weekEnd))))}</strong>
     <button type="button" class="button ghost" id="periodNextWeek" aria-label="สัปดาห์ถัดไป">›</button>
     <button type="button" class="button secondary" id="periodThisWeek">สัปดาห์นี้</button>
     <label class="period-jump-label" for="periodWeekJump">เลือกวันที่ <input type="date" id="periodWeekJump" value="${esc(week)}" aria-label="เลือกวันที่เพื่อไปยังสัปดาห์นั้น"></label>
    </div></div>
    <div class="period-legend"><span><i class="period-dot done"></i> เช็กแล้ว</span><span><i class="period-dot pending"></i> ยังไม่เช็ก</span>
     <span><i class="period-dot absent"></i> มีรายการไม่เข้าคาบ</span></div>
    <div class="period-grid-scroll" role="region" aria-label="ตารางสอนรายสัปดาห์ เลื่อนดูคาบ 1 ถึง 10 ได้" tabindex="0">
     <table class="period-week-grid"><thead><tr><th scope="col">วัน / วันที่</th>${Array.from({length:10},(_,i)=>`<th scope="col">คาบ ${i+1}</th>`).join('')}</tr></thead>
     <tbody>${cells.map(row=>`<tr><th scope="row" class="period-day period-day-${row.day_of_week}">${esc(row.dayShort)}<small>${esc(row.date.slice(8))}/${esc(row.date.slice(5,7))}</small></th>
      ${row.cells.map(cell=>cell.lesson?(()=>{
       const l=cell.lesson;
       const status=statusFor(l.id,row.date),hasSaved=Number(status?.recorded||0)>0,hasAbsent=Number(status?.absent||0)>0;
       const kind=hasAbsent?'absent':hasSaved?'done':'pending';
       const allowed=utc(row.date)<=utc(current())&&utc(row.date)>=utc(addDays(current(),-14));
       return `<td colspan="${cell.span}" class="period-occupied">
        <button type="button" class="period-slot ${kind}" data-check-lesson="${l.id}" data-check-date="${row.date}" ${allowed?'':'disabled'}
         title="${esc(l.subject)} • ${esc(l.classroom_label)} • คาบ ${lessonPeriod(l)}">
         <strong>${esc(l.classroom_label)}</strong><span>${esc(l.subject)}</span>
         <small>${esc(l.subject_code||'ไม่ระบุรหัส')} · คาบ ${lessonPeriod(l)}</small>
         <em>${hasAbsent?'มีรายการไม่เข้าคาบ':hasSaved?'เช็กแล้ว':'ยังไม่เช็ก'}</em>
        </button></td>`;
      })():`<td class="period-empty"><span>–</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="muted period-hint">คาบคู่จะแสดงเป็นช่องยาวครอบคลุมทั้งสองคาบ · เปิดเช็กชื่อได้เฉพาะวันนี้และย้อนหลังไม่เกิน 14 วัน · วันที่เก่ากว่านี้ดูประวัติได้ที่รายงาน</p>
    ${!valid.length?'<div class="period-empty-state">ยังไม่มีตารางสอนที่เปิดใช้งาน <button type="button" class="button secondary" data-create-first>+ เพิ่มตารางสอน</button></div>':''}
   </section></section>`);
  bindCommon();
  document.querySelector('#periodPrevWeek')?.addEventListener('click',()=>safeRun(async()=>{week=addDays(week,-7);await loadWeek()}));
  document.querySelector('#periodNextWeek')?.addEventListener('click',()=>safeRun(async()=>{week=addDays(week,7);await loadWeek()}));
  document.querySelector('#periodThisWeek')?.addEventListener('click',()=>safeRun(async()=>{week=weekMonday(today());await loadWeek()}));
  document.querySelector('#periodWeekJump')?.addEventListener('change',event=>safeRun(async()=>{
   if(!event.target.value)return;
   week=weekMonday(event.target.value);await loadWeek();
  }));
  document.querySelector('[data-create-first]')?.addEventListener('click',()=>openEditor());
  document.querySelectorAll('[data-check-lesson]').forEach(button=>button.addEventListener('click',()=>{
   if(button.disabled)return;
   const lesson=lessons.find(x=>x.id===Number(button.dataset.checkLesson));
   if(lesson)openLesson(lesson,button.dataset.checkDate);
  }));
 }
 async function loadReport(){
  const request={from,to};
  const query=new URLSearchParams(request);
  const r=await api('/api/my-timetable/report?'+query);
  if(view!=='report'||from!==request.from||to!==request.to)return;
  report=r.items;detailSlot=null;details=[];teachingLogs=[];renderReport();
 }
 async function loadDetails(id){
  const query=new URLSearchParams({from,to,timetable_id:String(id)});
  const r=await api('/api/my-timetable/report?'+query);
  if(view!=='report')return;
  detailSlot=id;details=r.items;teachingLogs=r.teaching_logs||[];detailLimited=r.limited;renderReport();
 }
 function renderReport(){
  const lessonCount=report.length;
  const records=report.reduce((a,x)=>a+Number(x.recorded||0),0);
  const absences=report.reduce((a,x)=>a+Number(x.absent||0),0);
  const selected=report.find(x=>x.timetable_id===detailSlot);
  const statusName={absent:'ไม่เข้าคาบ',late:'มาสาย',leave:'ลา',truancy:'หนีเรียน'};
  mount(`<section class="period-center stack">${header()}
   <div class="period-stats">
    <div class="period-stat"><span>📖</span><div><strong>${number(lessonCount)}</strong><small>รายการวิชาที่สอน</small></div></div>
    <div class="period-stat"><span>🧾</span><div><strong>${number(records)}</strong><small>บันทึกนักเรียนรายคาบ</small></div></div>
    <div class="period-stat"><span>🔎</span><div><strong>${number(absences)}</strong><small>รายการไม่เข้าคาบ</small></div></div>
   </div>
   <section class="card stack period-report-panel">
    <div class="period-panel-title"><div><h3>รายงานการเช็กชื่อรายวิชา</h3>
    <p class="muted">สรุปจากข้อมูลที่ครูบันทึกจริง ไม่ถือว่ารายการที่ยังไม่ได้เช็กเป็นนักเรียนขาดเรียน</p></div></div>
    <form id="periodReportFilter" class="period-report-filters">
     <div class="field"><label for="periodReportFrom">ตั้งแต่วันที่</label><input id="periodReportFrom" type="date" value="${esc(from)}" max="${esc(today())}" required></div>
     <div class="field"><label for="periodReportTo">ถึงวันที่</label><input id="periodReportTo" type="date" value="${esc(to)}" max="${esc(today())}" required></div>
     <button class="button" type="submit">ค้นหารายงาน</button></form>
    <div class="table-wrap"><table class="table period-report-table"><thead><tr>
     <th>ห้องเรียน</th><th>รหัสวิชา / ชื่อวิชา</th><th>วัน / คาบ</th><th>วันที่เช็ก</th>
     <th>มา</th><th>ไม่เข้าคาบ (รวมหนีเรียน)</th><th>หนีเรียน</th><th>สาย</th><th>ลา</th><th>ดูรายละเอียด</th></tr></thead>
     <tbody>${report.length?report.map(x=>`<tr>
      <td><strong>${esc(x.classroom_label)}</strong></td>
      <td><strong>${esc(x.subject_code||'—')}</strong><small>${esc(x.subject)}</small></td>
      <td>${esc(days[x.day_of_week-1])} · ${lessonPeriod(x)}</td>
      <td>${number(x.dates_recorded)}</td><td>${number(x.present)}</td>
      <td><strong class="period-danger">${number(x.absent)}</strong></td><td><strong class="period-danger">${number(x.truancy)}</strong></td><td>${number(x.late)}</td><td>${number(x.leave)}</td>
      <td><button type="button" class="button secondary" data-report-lesson="${x.timetable_id}">รายชื่อ / บันทึกการสอน</button></td></tr>`).join(''):'<tr><td colspan="10" class="empty">ไม่พบวิชาที่ลงตารางในบัญชีนี้</td></tr>'}</tbody></table></div>
   </section>
   ${selected?`<section class="card stack period-report-details"><div class="period-panel-title">
    <div><h3>เหตุการณ์ที่ต้องติดตาม — ${esc(selected.classroom_label)}</h3>
     <p class="muted">${esc(selected.subject_code)} ${esc(selected.subject)} · เฉพาะรายการไม่เข้าคาบ มาสาย และลาในช่วงที่เลือก</p></div>
    <button type="button" id="closePeriodDetail" class="button ghost">ปิดรายละเอียด</button></div>
    <div class="teaching-log-history"><h4>📝 บันทึกการสอนย้อนหลัง (${teachingLogs.length} รายการ)</h4>
    ${teachingLogs.length?teachingLogs.map(log=>`<article class="teaching-log-item">
     <div><strong>${esc(log.school_date)}</strong><span class="muted">บันทึก/แก้ไขล่าสุด ${esc(log.updated_at||'')}</span></div>
     <p>${esc(log.note)}</p></article>`).join(''):'<p class="muted">ไม่มีบันทึกการสอนในช่วงวันที่เลือก (การบันทึกส่วนนี้ไม่บังคับ)</p>'}</div>
    <h4>รายชื่อนักเรียนที่ต้องติดตาม</h4>
    <div class="table-wrap"><table class="table"><thead><tr><th>วันที่</th><th>เลขที่</th><th>รหัสนักเรียน</th><th>ชื่อ-สกุล</th><th>สถานะ</th></tr></thead>
     <tbody>${details.length?details.map(x=>`<tr><td>${esc(x.school_date)}</td><td>${number(x.roll_no)}</td><td>${esc(x.student_no)}</td><td>${esc(x.full_name)}</td>
     <td><span class="period-event period-event-${esc(x.status)}">${esc(statusName[x.status]||x.status)}</span></td></tr>`).join(''):'<tr><td colspan="5" class="empty">ไม่มีรายการไม่เข้าคาบ มาสาย หรือลา ในช่วงวันที่นี้</td></tr>'}</tbody></table></div>
     ${detailLimited?'<p class="warn">รายการมีจำนวนมาก แสดงสูงสุด 500 รายการ โปรดเลือกช่วงวันที่ให้แคบลง</p>':''}</section>`:''}
   </section>`);
  bindCommon();
  document.querySelector('#periodReportFilter')?.addEventListener('submit',e=>{
   e.preventDefault();
   const f=document.querySelector('#periodReportFrom').value,t=document.querySelector('#periodReportTo').value;
   if(f>t){toast('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด',true);return}
   const count=(utc(t)-utc(f))/86400000;
   if(count>184){toast('เลือกช่วงวันที่ไม่เกิน 185 วัน',true);return}
   from=f;to=t;safeRun(loadReport);
  });
  document.querySelectorAll('[data-report-lesson]').forEach(b=>b.addEventListener('click',()=>safeRun(()=>loadDetails(Number(b.dataset.reportLesson)))));
  document.querySelector('#closePeriodDetail')?.addEventListener('click',()=>{detailSlot=null;details=[];teachingLogs=[];renderReport()});
 }
 async function load(){return view==='week'?loadWeek():loadReport()}
 return {load};
}
