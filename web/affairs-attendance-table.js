// Student Affairs attendance monitoring, rendered as two real data tables.
// Only presentation and filters live here; the existing API remains authoritative.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const thaiCompare=(a,b)=>String(a).localeCompare(String(b),'th',{numeric:true});
const safeCount=value=>Math.max(0,Number(value)||0);
const percent=(checked,total)=>total?Math.round(100*Math.min(checked,total)/total):0;
export const gradeLabel=grade=>'ม.'+grade;
export const attendanceStatus=row=>{
 if(safeCount(row.checked)>=safeCount(row.students)&&safeCount(row.students)>0)return 'complete';
 return safeCount(row.checked)===0?'unstarted':'pending';
};
export function attendanceRoomRows(items){
 return (Array.isArray(items)?items:[])
  .filter(row=>safeCount(row.students)>0)
  .sort((a,b)=>Number(a.grade)-Number(b.grade)||thaiCompare(a.label,b.label)||Number(a.id)-Number(b.id));
}
export function dailyAttendanceSummary(items){
 const rooms=attendanceRoomRows(items);
 const grades=[1,2,3,4,5,6].map(grade=>{
  const group=rooms.filter(row=>Number(row.grade)===grade);
  const students=group.reduce((n,row)=>n+safeCount(row.students),0);
  const checked=group.reduce((n,row)=>n+Math.min(safeCount(row.checked),safeCount(row.students)),0);
  return {grade,rooms:group.length,complete:group.filter(x=>attendanceStatus(x)==='complete').length,
   pending:group.filter(x=>attendanceStatus(x)!=='complete').length,students,checked};
 });
 const total=grades.reduce((a,r)=>({
  rooms:a.rooms+r.rooms,complete:a.complete+r.complete,pending:a.pending+r.pending,
  students:a.students+r.students,checked:a.checked+r.checked
 }),{rooms:0,complete:0,pending:0,students:0,checked:0});
 return {grades,total};
}
function progress(checked,students,label){
 const done=Math.min(safeCount(checked),safeCount(students)),all=safeCount(students);
 return `<div class="rd-att-table-progress">
  <progress value="${done}" max="${Math.max(1,all)}" aria-label="${esc(label)}"></progress>
  <span>${percent(done,all)}%</span></div>`;
}
export function dailyAttendanceSummaryTable(items){
 const {grades,total}=dailyAttendanceSummary(items);
 const tableRow=(r,label,overall=false)=>`<tr${overall?' class="rd-att-summary-total"':''}>
  <th scope="row">${esc(label)}</th>
  <td class="rd-att-num">${r.rooms}</td>
  <td class="rd-att-num rd-att-good">${r.complete}</td>
  <td class="rd-att-num ${r.pending?'rd-att-warn':''}">${r.pending}</td>
  <td class="rd-att-num">${r.checked} / ${r.students}</td>
  <td>${progress(r.checked,r.students,'การเช็กชื่อ '+label)}</td>
 </tr>`;
 return `<div class="rd-affairs-table-scroll" role="region" aria-label="ตารางตรวจสอบการเช็กชื่อรายวัน" tabindex="0">
 <table class="rd-affairs-attendance-table rd-affairs-summary-table">
  <thead><tr><th scope="col">ระดับชั้น</th><th scope="col">ห้องทั้งหมด</th>
   <th scope="col">เช็กครบ</th><th scope="col">ยังไม่ครบ</th>
   <th scope="col">นักเรียนที่เช็ก / ทั้งหมด</th><th scope="col">ความคืบหน้า</th>
  </tr></thead>
  <tbody>${grades.map(r=>tableRow(r,gradeLabel(r.grade))).join('')}</tbody>
  <tfoot>${tableRow(total,'รวมทุกระดับชั้น',true)}</tfoot>
 </table></div>`;
}
export function filterAttendanceRooms(items,{query='',grade='all',status='all'}={}){
 const search=String(query||'').trim().toLocaleLowerCase('th');
 return attendanceRoomRows(items).filter(row=>{
  if(grade!=='all'&&Number(row.grade)!==Number(grade))return false;
  if(status!=='all'&&attendanceStatus(row)!==status)return false;
  const advisors=[row.advisor_name,row.advisor2_name].filter(Boolean).join(' ');
  return !search||[row.label,advisors,gradeLabel(row.grade)].some(
   field=>String(field??'').toLocaleLowerCase('th').includes(search));
 });
}
export function attendanceRoomTable(items,reminders=[],options={}){
 const {date='',today='',query='',grade='all',status='all',pageSize='25',page=1}=options;
 const selected=filterAttendanceRooms(items,{query,grade,status});
 const count=selected.length;
 const limit=pageSize==='all'?Math.max(1,count):[10,25,50].includes(Number(pageSize))?Number(pageSize):25;
 const pages=Math.max(1,Math.ceil(count/limit));
 const current=Math.min(Math.max(1,Number(page)||1),pages);
 const visible=selected.slice((current-1)*limit,current*limit);
 const remindersByRoom=new Map((Array.isArray(reminders)?reminders:[]).map(x=>[Number(x.classroom_id),x]));
 const manualRooms=new Set((Array.isArray(reminders)?reminders:[]).filter(x=>x.kind==='manual')
  .map(x=>Number(x.classroom_id)));
 const stateLabels={sent:'ส่งถึงอุปกรณ์แล้ว',no_subscription:'ยังไม่ได้สมัครรับ Push',
  failed:'ส่งไม่สำเร็จ',queued:'รอส่ง',already_queued:'เคยแจ้งแล้ว',
  not_needed:'เช็กชื่อครบ/ยังไม่มีครูที่ปรึกษา'};
 const rows=visible.map(row=>{
  const state=attendanceStatus(row),total=safeCount(row.students);
  const checked=Math.min(total,safeCount(row.checked)),remaining=total-checked;
  const advisorNames=[row.advisor_name,row.advisor2_name].filter(Boolean).join(' / ');
  const reminder=remindersByRoom.get(Number(row.id));
  const hasTeacher=Boolean(row.advisor_user_id||row.advisor2_user_id);
  const canNotify=state!=='complete'&&hasTeacher&&date===today;
  const action=!hasTeacher?
   '<span class="rd-att-muted">ยังไม่กำหนดครู</span>':
   canNotify?`<button type="button" class="button secondary rd-att-remind-btn"
    data-affairs-remind="${Number(row.id)}" ${manualRooms.has(Number(row.id))?'disabled':''}>
    ${manualRooms.has(Number(row.id))?'✓ แจ้งเตือนแล้ว':'🔔 แจ้งเตือนครู'}</button>`:
   '<span class="rd-att-muted">—</span>';
  const statusText=state==='complete'?'✓ ครบแล้ว':state==='unstarted'?'ยังไม่เริ่ม':'กำลังเช็ก';
  const pushStatus=reminder?
   `<span class="rd-att-reminder-detail">${esc(stateLabels[reminder.state]||reminder.state||'')} (${safeCount(reminder.delivered)} เครื่อง)</span>`:null;
  return `<tr class="rd-att-row rd-att-row-${state}">
   <th scope="row" class="rd-att-room">${esc(row.label)}</th>
   <td class="rd-att-advisors">${advisorNames?esc(advisorNames):'<span class="rd-att-muted">ยังไม่กำหนด</span>'}</td>
   <td class="rd-att-num">${total}</td>
   <td class="rd-att-num">${checked}</td>
   <td class="rd-att-num ${remaining?'rd-att-warn':''}">${remaining}</td>
   <td>${progress(checked,total,'ห้อง '+row.label)}</td>
   <td><span class="rd-affairs-state ${state==='complete'?'ready':'pending'}">${statusText}</span></td>
   <td class="rd-att-action-cell">${action}${pushStatus||''}</td>
  </tr>`;
 });
 return `<div class="rd-att-table-result" role="status">
  <strong>แสดง ${count?(current-1)*limit+1:0}–${Math.min(current*limit,count)} จาก ${count} ห้อง</strong>
  <span>เรียงตามระดับชั้นและเลขห้อง</span>
 </div>
 <div class="rd-affairs-table-scroll" role="region" aria-label="ตารางติดตามการเช็กชื่อรายห้องเรียน" tabindex="0">
 <table class="rd-affairs-attendance-table rd-affairs-rooms-table">
  <thead><tr><th scope="col">ห้องเรียน</th><th scope="col">ครูที่ปรึกษา</th>
   <th scope="col">ทั้งหมด</th><th scope="col">เช็กแล้ว</th><th scope="col">คงเหลือ</th>
   <th scope="col">ความคืบหน้า</th><th scope="col">สถานะ</th><th scope="col">การแจ้งเตือน</th>
  </tr></thead>
  <tbody>${rows.join('')||'<tr><td colspan="8" class="rd-att-empty">ไม่พบห้องเรียนที่ตรงกับเงื่อนไข</td></tr>'}</tbody>
 </table></div>
 <div class="rd-att-pagination"><span class="rd-att-muted">หน้า ${current} / ${pages}</span>
  <button type="button" class="button secondary" data-att-page="prev" ${current===1?'disabled':''}>ก่อนหน้า</button>
  <button type="button" class="button secondary" data-att-page="next" ${current>=pages?'disabled':''}>ถัดไป</button>
 </div>`;
}
