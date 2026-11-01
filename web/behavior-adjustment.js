// Dedicated teacher adjustment menu: multi-room, multi-student selection and popup history.
export function createBehaviorAdjustment({api,mount,safeRun,toast,rooms,getRoomId,setRoomId,getTab,escapeHtml,scorePopup}){
 const esc=escapeHtml;
 const state={query:'',results:[],students:[],rules:[],picked:new Map(),reason:'',ruleId:'',preview:null};
 const active=()=>getTab()==='adjustment';
 const roomLabel=()=>rooms().find(room=>Number(room.id)===Number(getRoomId()))?.label||'';
 const studentLabel=st=>`<span class="score-adjust-student-name">${esc(st.full_name)}
  <small>${esc(st.student_no)} · ${esc(st.classroom_label||'')}</small></span>`;
 const draft=()=>{
  const query=document.querySelector('#adjustmentSearch');
  const reason=document.querySelector('#adjustmentReason');
  const rule=document.querySelector('#adjustmentRule');
  if(query)state.query=query.value;
  if(reason)state.reason=reason.value;
  if(rule)state.ruleId=rule.value;
 };
 function add(student){
  if(state.picked.has(Number(student.id)))return true;
  if(state.picked.size>=200){toast('เลือกนักเรียนได้สูงสุด 200 คนต่อครั้ง',true);return false}
  state.picked.set(Number(student.id),student);return true;
 }
 function render(){
  if(!active())return;
  const chosen=[...state.picked.values()],count=chosen.length;
  const allRoom=state.students.length>0&&state.students.every(st=>state.picked.has(Number(st.id)));
  const selectedRule=state.rules.find(rule=>String(rule.id)===String(state.ruleId));
  const preview=state.preview;
  const selectRows=items=>items.map(st=>`<div class="score-student-row">
   <label class="score-adjust-check"><input type="checkbox" data-adjustment-student="${st.id}"
     ${state.picked.has(Number(st.id))?'checked':''}>
    ${studentLabel(st)}</label>
   <button class="button ghost" type="button" data-adjustment-history="${st.id}">ดูประวัติ</button>
  </div>`).join('');
  mount(`<div class="stack score-entry score-adjust-page">
   <div><h2>บันทึกการปรับพฤติกรรม</h2>
    <p class="muted">เลือกนักเรียนหลายคนจากหลายห้องพร้อมกันได้ ใช้เฉพาะเกณฑ์ปรับพฤติกรรมที่ฝ่ายกิจการเปิดใช้งาน
     และตรวจคะแนนความผิดคงเหลือของทุกคนก่อนบันทึก</p></div>
   <section class="card stack" aria-label="ค้นหาและเลือกนักเรียน">
    <div class="row between"><h3>1. เลือกนักเรียน</h3>
     <span class="tag">เลือกแล้ว ${count} คน · ${new Set(chosen.map(st=>st.classroom_id)).size} ห้อง</span></div>
    <form class="score-search" id="adjustmentSearchForm">
     <div class="field"><label for="adjustmentSearch">ค้นหาเลขประจำตัว หรือชื่อ-สกุล (ทุกห้องที่ได้รับสิทธิ์)</label>
      <input id="adjustmentSearch" type="search" autocomplete="off" minlength="2" maxlength="60"
       value="${esc(state.query)}" placeholder="ระบุเลขประจำตัวหรือชื่อ"></div>
     <button class="button" type="submit">ค้นหา</button>
     ${state.query||state.results.length?'<button type="button" class="button ghost" id="adjustmentClearSearch">ล้างค้นหา</button>':''}
    </form>
    ${state.results.length?`<div class="score-search-results" aria-label="ผลการค้นหา">
     <p class="muted">พบ ${state.results.length} คน (แสดงสูงสุด 60 คน)</p>
     ${selectRows(state.results)}</div>`:state.query?'<p class="muted">กดค้นหาเพื่อแสดงรายชื่อที่ตรงกัน</p>':''}
    <div class="score-room-bar"><div class="field"><label for="adjustmentRoom">เลือกห้องเรียน</label>
     <select id="adjustmentRoom">${rooms().map(room=>`<option value="${room.id}" ${Number(room.id)===Number(getRoomId())?'selected':''}>
      ${esc(room.label)}</option>`).join('')}</select></div>
     <button type="button" class="button secondary" id="adjustmentToggleRoom" ${state.students.length?'':'disabled'}>
      ${allRoom?'ยกเลิกเลือกทั้งห้อง':'เลือกนักเรียนทั้งห้อง'}</button></div>
    <div class="score-student-list" aria-label="รายชื่อในห้อง ${esc(roomLabel())}">
     ${state.students.length?selectRows(state.students):'<div class="empty">ห้องนี้ไม่มีรายชื่อนักเรียน</div>'}
    </div>
   </section>
   <section class="card stack" aria-label="บันทึกการปรับพฤติกรรม">
    <div class="row between"><h3>2. เลือกเกณฑ์และบันทึก</h3>
     <button type="button" class="button ghost" id="adjustmentClearSelected" ${count?'':'disabled'}>
      ล้างรายชื่อที่เลือก</button></div>
    <div class="score-selected" aria-live="polite">
     ${chosen.length?chosen.map(st=>`<span class="score-selected-chip">${esc(st.full_name)} · ${esc(st.classroom_label)}
      <button type="button" data-adjustment-remove="${st.id}" aria-label="นำ ${esc(st.full_name)} ออกจากรายการ">×</button>
      <button type="button" class="score-chip-history" data-adjustment-history="${st.id}">ประวัติ</button>
     </span>`).join(''):'<p class="muted">ยังไม่ได้เลือกนักเรียน สามารถค้นหาหรือเลือกจากห้องได้</p>'}
    </div>
    <form class="stack" id="adjustmentRecordForm">
     <div class="field"><label for="adjustmentRule">เกณฑ์ปรับพฤติกรรมที่เปิดใช้งาน</label>
      <select id="adjustmentRule" name="adjustment_rule_id" required>
       <option value="">เลือกเกณฑ์ที่โรงเรียนกำหนด</option>
       ${state.rules.map(rule=>`<option value="${rule.id}" ${String(rule.id)===String(state.ruleId)?'selected':''}>
        ${esc(rule.name)} (+${Number(rule.points)} คะแนน)</option>`).join('')}
      </select></div>
     <div class="field"><label for="adjustmentReason">รายละเอียดเพิ่มเติม <span class="muted">(ไม่บังคับ)</span></label>
      <textarea id="adjustmentReason" name="reason" maxlength="300"
       placeholder="เว้นว่างได้ ระบบใช้ชื่อเกณฑ์เป็นเหตุผล">${esc(state.reason)}</textarea></div>
     <button class="button full" type="submit" id="adjustmentSubmit" ${!count||!selectedRule?'disabled':''}>
      ตรวจสอบและบันทึกการปรับพฤติกรรม ${count} คน</button>
     ${!state.rules.length?'<p class="muted">ฝ่ายกิจการนักเรียนยังไม่เปิดเกณฑ์ปรับพฤติกรรม</p>':''}
    </form>
    ${preview?`<div class="score-adjust-preview" aria-live="polite">
     <h4>ผลตรวจสอบคะแนนความผิดคงเหลือ · ${preview.items.length} คน</h4>
     <p class="${preview.all_eligible?'muted':'warn'}">${preview.all_eligible?
      'นักเรียนทุกคนผ่านการตรวจสอบแล้ว': 'มีนักเรียนบางคนคะแนนความผิดคงเหลือไม่พอ ระบบยังไม่ได้บันทึกคะแนนใด ๆ'}</p>
     <div class="table-wrap"><table class="table"><thead><tr><th>นักเรียน</th><th>คงเหลือ</th><th>เกณฑ์</th><th>ผลตรวจสอบ</th></tr></thead><tbody>
      ${preview.items.map(item=>`<tr><td>${esc(item.full_name)}</td>
       <td>${Number(item.remaining)||0}</td><td>${Number(preview.rule.points)||0}</td>
       <td>${item.eligible?'เพียงพอ':'ไม่เพียงพอ'}</td></tr>`).join('')}
     </tbody></table></div></div>`:''}
   </section>
  </div>`);
  document.querySelector('#adjustmentRoom')?.addEventListener('change',event=>safeRun(async()=>{
   draft();setRoomId(Number(event.target.value));await load();
  }));
  document.querySelector('#adjustmentSearchForm')?.addEventListener('submit',event=>safeRun(async()=>{
   event.preventDefault();draft();
   const query=state.query.trim();
   if(query.length<2){toast('กรุณาพิมพ์เลขประจำตัวหรือชื่ออย่างน้อย 2 ตัวอักษร',true);return}
   const result=await api('/api/affairs/behavior/students?query='+encodeURIComponent(query));
   if(!active()||state.query.trim()!==query)return;
   state.results=result.items||[];render();
   if(!state.results.length)toast('ไม่พบรายชื่อนักเรียนที่ตรงกับคำค้น',true);
  }));
  document.querySelector('#adjustmentClearSearch')?.addEventListener('click',()=>{
   draft();state.query='';state.results=[];render();
  });
  document.querySelector('#adjustmentToggleRoom')?.addEventListener('click',()=>{
   draft();
   if(allRoom)for(const st of state.students)state.picked.delete(Number(st.id));
   else for(const st of state.students)if(!add(st))break;
   state.preview=null;render();
  });
  document.querySelectorAll('[data-adjustment-student]').forEach(box=>box.addEventListener('change',event=>{
   draft();const id=Number(event.currentTarget.dataset.adjustmentStudent);
   const st=[...state.students,...state.results].find(st=>Number(st.id)===id);
   if(!st)return;
   if(event.currentTarget.checked)add(st);
   else state.picked.delete(id);
   state.preview=null;render();
  }));
  document.querySelectorAll('[data-adjustment-remove]').forEach(button=>button.addEventListener('click',()=>{
   draft();state.picked.delete(Number(button.dataset.adjustmentRemove));state.preview=null;render();
  }));
  document.querySelector('#adjustmentClearSelected')?.addEventListener('click',()=>{
   draft();state.picked.clear();state.preview=null;render();
  });
  document.querySelector('#adjustmentRule')?.addEventListener('change',()=>{
   draft();state.preview=null;
   // A rule change must immediately update the submit button; previously the
   // disabled state only refreshed after a pupil checkbox triggered render().
   const button=document.querySelector('#adjustmentSubmit');
   if(button)button.disabled=!state.picked.size||
    !state.rules.some(rule=>String(rule.id)===String(state.ruleId));
   // A preview for the previous rule is no longer valid.
   document.querySelector('.score-adjust-preview')?.remove();
  });
  document.querySelectorAll('[data-adjustment-history]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   draft();const id=Number(button.dataset.adjustmentHistory);
   const st=state.picked.get(id)||state.students.find(st=>Number(st.id)===id)||
    state.results.find(st=>Number(st.id)===id);
   if(st)await scorePopup.open({student:st,mode:'behavior',onChange:()=>{
    state.preview=null;render();
   }});
  })));
  document.querySelector('#adjustmentRecordForm')?.addEventListener('submit',event=>safeRun(async()=>{
   event.preventDefault();draft();
   const ids=[...state.picked.keys()],ruleId=Number(state.ruleId);
   if(!ids.length||!state.rules.some(rule=>Number(rule.id)===ruleId)){
    toast('กรุณาเลือกรายชื่อและเกณฑ์ปรับพฤติกรรม',true);return;
   }
   const button=document.querySelector('#adjustmentSubmit');
   if(button)button.disabled=true;
   try{
    const preview=await api('/api/affairs/behavior/adjust/preview',
     {method:'POST',body:{student_ids:ids,adjustment_rule_id:ruleId}});
    if(!active())return;
    state.preview=preview;
    if(!preview.all_eligible){
     toast('บางคนมีคะแนนความผิดคงเหลือไม่พอ กรุณาตรวจสอบรายชื่อ',true);
     render();return;
    }
    const result=await api('/api/affairs/behavior/adjust/bulk',{method:'POST',
     body:{student_ids:ids,adjustment_rule_id:ruleId,reason:state.reason},timeoutMs:30000});
    if(!active())return;
    state.picked.clear();state.preview=null;state.reason='';
    toast('บันทึกการปรับพฤติกรรมสำเร็จ '+Number(result.count||ids.length)+' คน');
    render();
   }finally{if(button?.isConnected)button.disabled=false}
  }));
 }
 async function load(){
  const roomId=Number(getRoomId());
  if(!roomId){mount('<div class="empty">ยังไม่มีห้องเรียนที่ได้รับสิทธิ์</div>');return}
  const [students,approvals]=await Promise.all([
   api('/api/students?classroom_id='+roomId),
   api('/api/affairs/behavior/approved-adjustments')
  ]);
  if(!active()||Number(getRoomId())!==roomId)return;
  state.students=(students.items||[]).map(student=>({...student,classroom_id:roomId,classroom_label:roomLabel()}));
  state.rules=approvals.items||[];
  render();
 }
 return {load};
}
