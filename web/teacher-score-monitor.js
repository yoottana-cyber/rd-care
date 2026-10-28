// Schoolwide score-monitoring page for teachers and school staff (read-only).
export function createTeacherScoreMonitor({api,mount,safeRun,toast,scorePopup,getTab,escapeHtml}){
 const esc=escapeHtml;
 const state={items:[],query:'',grade:0,limit:100,recordFilter:'all',date:null};
 const active=()=>getTab()==='scoreMonitor';
 const count=value=>Number(value)||0;
 const label=()=>state.grade?`ม.${state.grade}`:'ทุกระดับชั้น';
 function filtered(){
  const query=state.query.trim().toLocaleLowerCase('th-TH');
  return state.items.filter(row=>{
   if(state.grade&&Number(row.grade)!==state.grade)return false;
   if(state.recordFilter==='recorded'&&!count(row.events))return false;
   if(state.recordFilter==='unrecorded'&&count(row.events))return false;
   return !query||[row.student_no,row.full_name,row.classroom_label].some(value=>
    String(value||'').toLocaleLowerCase('th-TH').includes(query));
  });
 }
 function paintRows(){
  const container=document.getElementById('scoreMonitorRows');
  if(!container)return;
  const all=filtered();
  const visible=state.limit?all.slice(0,state.limit):all;
  const found=document.getElementById('scoreMonitorFound');
  if(found)found.textContent=`พบ ${all.length} คน`;
  const info=document.getElementById('scoreMonitorMoreInfo');
  if(info)info.textContent=state.limit&&all.length>state.limit?
   `แสดง ${visible.length} จาก ${all.length} คน สามารถเปลี่ยนจำนวนแถวเป็น "ทั้งหมด"`:'';
  container.innerHTML=visible.map(row=>`<tr>
   <td>${esc(row.classroom_label)}</td>
   <td><button class="rd-monitor-student-link score-monitor-name" type="button"
      data-score-monitor-detail="${row.student_id}">${esc(row.full_name)}</button>
     <div class="muted">${esc(row.student_no)}</div></td>
   <td class="score-monitor-number">+${count(row.good_total)}</td>
   <td class="score-monitor-number">${count(row.behavior_deducted)}</td>
   <td class="score-monitor-number">${count(row.behavior_adjusted)}</td>
   <td class="score-monitor-number"><strong>${count(row.behavior_remaining)}</strong></td>
   <td class="score-monitor-number">${count(row.events)}</td>
   <td><button class="button secondary" type="button"
      data-score-monitor-detail="${row.student_id}">ดูประวัติ</button></td>
  </tr>`).join('')||'<tr><td colspan="8" class="empty">ไม่พบรายชื่อนักเรียนที่ตรงกับตัวกรอง</td></tr>';
 }
 function render(){
  if(!active())return;
  const byGrade=state.items.filter(row=>!state.grade||Number(row.grade)===state.grade);
  const sum=key=>byGrade.reduce((total,row)=>total+count(row[key]),0);
  mount(`<div class="stack score-monitor-page">
   <section class="card stack">
    <div class="row between"><div><h2>ติดตามคะแนนพฤติกรรม</h2>
     <p class="muted">ครูทุกคนสามารถตรวจสอบคะแนนความดี ความผิด และการปรับพฤติกรรมของนักเรียนทุกห้อง
      เพื่อใช้ประกอบการดูแลช่วยเหลือนักเรียน โดยไม่มีสิทธิ์แก้ไขจากหน้านี้</p></div>
     <button type="button" class="button secondary" id="scoreMonitorRefresh">↻ อัปเดต</button></div>
    <div class="score-monitor-summary">
     <div><span>นักเรียน ${label()}</span><strong>${byGrade.length}</strong></div>
     <div class="score-monitor-good"><span>คะแนนความดีรวม</span><strong>+${sum('good_total')}</strong></div>
     <div><span>คะแนนความผิดรวม</span><strong>${sum('behavior_deducted')}</strong></div>
     <div class="score-monitor-adjusted"><span>ปรับพฤติกรรมแล้ว</span><strong>${sum('behavior_adjusted')}</strong></div>
     <div><span>คะแนนความผิดคงเหลือ</span><strong>${sum('behavior_remaining')}</strong></div>
    </div>
    <div class="score-monitor-notice"><span aria-hidden="true">🔒</span>
     <span>ข้อมูลภายในโรงเรียนสำหรับการดูแลช่วยเหลือนักเรียนเท่านั้น ไม่ใช่การจัดอันดับ
      หรือคำตัดสินพฤติกรรม และไม่ควรเผยแพร่ข้อมูลรายบุคคลออกสู่สาธารณะ</span></div>
   </section>
   <section class="card stack">
    <div class="row between"><h3>ทะเบียนติดตามคะแนน</h3>
     <span class="tag" id="scoreMonitorFound"></span></div>
    <div class="score-monitor-filters">
     <div class="field"><label for="scoreMonitorGrade">ระดับชั้น</label>
      <select id="scoreMonitorGrade"><option value="0">ทุกระดับชั้น</option>
       ${[1,2,3,4,5,6].map(value=>`<option value="${value}"
        ${state.grade===value?'selected':''}>ม.${value}</option>`).join('')}
      </select></div>
     <div class="field score-monitor-search"><label for="scoreMonitorQuery">ค้นหาชื่อ เลขประจำตัว หรือห้อง</label>
      <input type="search" id="scoreMonitorQuery" autocomplete="off"
       maxlength="80" value="${esc(state.query)}" placeholder="พิมพ์เพื่อค้นหานักเรียน"></div>
     <div class="field"><label for="scoreMonitorRecordFilter">รายการบันทึก</label>
      <select id="scoreMonitorRecordFilter">
       <option value="all" ${state.recordFilter==='all'?'selected':''}>ทั้งหมด</option>
       <option value="recorded" ${state.recordFilter==='recorded'?'selected':''}>มีประวัติบันทึก</option>
       <option value="unrecorded" ${state.recordFilter==='unrecorded'?'selected':''}>ยังไม่มีรายการบันทึก</option>
      </select></div>
     <div class="field"><label for="scoreMonitorLimit">แสดงหน้าละ</label>
      <select id="scoreMonitorLimit">
       ${[[50,'50 คน'],[100,'100 คน'],[200,'200 คน'],[0,'ทั้งหมด']]
        .map(([value,name])=>`<option value="${value}" ${state.limit===value?'selected':''}>${name}</option>`).join('')}
      </select></div>
    </div>
    <p class="muted">เรียงตามระดับชั้น ห้องเรียน และเลขที่ ไม่มีการจัดอันดับนักเรียนตามคะแนน</p>
    <div class="table-wrap"><table class="table score-monitor-table">
     <thead><tr><th>ห้อง</th><th>นักเรียน</th><th>ความดี</th><th>ความผิด</th>
      <th>ปรับแล้ว</th><th>คงเหลือ</th><th>รายการ</th><th>ประวัติ</th></tr></thead>
     <tbody id="scoreMonitorRows"></tbody>
    </table></div>
    <p class="muted" id="scoreMonitorMoreInfo"></p>
   </section>
  </div>`);
  paintRows();
  document.getElementById('scoreMonitorGrade')?.addEventListener('change',event=>{
   state.grade=Number(event.target.value);render();
  });
  document.getElementById('scoreMonitorQuery')?.addEventListener('input',event=>{
   state.query=event.target.value;paintRows();
  });
  document.getElementById('scoreMonitorRecordFilter')?.addEventListener('change',event=>{
   state.recordFilter=event.target.value;paintRows();
  });
  document.getElementById('scoreMonitorLimit')?.addEventListener('change',event=>{
   state.limit=Number(event.target.value);paintRows();
  });
  document.getElementById('scoreMonitorRefresh')?.addEventListener('click',()=>safeRun(()=>load()));
  document.getElementById('scoreMonitorRows')?.addEventListener('click',event=>safeRun(async()=>{
   const button=event.target.closest('[data-score-monitor-detail]');
   if(!button)return;
   const row=state.items.find(item=>Number(item.student_id)===Number(button.dataset.scoreMonitorDetail));
   if(!row)return;
   await scorePopup.open({student:{id:row.student_id,student_no:row.student_no,
    full_name:row.full_name,classroom_label:row.classroom_label},mode:'all',readOnly:true});
  }));
 }
 async function load(){
  const data=await api('/api/affairs/behavior/monitor/summary');
  if(!active())return;
  if(data.read_only!==true){toast('ไม่สามารถตรวจสอบสิทธิ์อ่านอย่างเดียวได้',true);return}
  state.items=data.items||[];state.date=data.date;render();
 }
 return {load};
}
