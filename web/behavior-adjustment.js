// Dedicated, single-student improvement entry for authorized teachers and staff.
import {scoreHistoryTables} from './score-history.js';

export function createBehaviorAdjustment({api,mount,safeRun,toast,rooms,getRoomId,setRoomId,getTab,escapeHtml}){
 const esc=escapeHtml;
 const state={query:'',results:[],students:[],rules:[],student:null,history:[],
  hasMore:false,nextOffset:0,scores:{},reason:'',ruleId:''};
 const active=()=>getTab()==='adjustment';
 const roomLabel=()=>rooms().find(room=>Number(room.id)===Number(getRoomId()))?.label||'';
 const studentLabel=student=>`<span class="score-adjust-student-name">${esc(student.full_name)}
  <small>${esc(student.student_no)} · ${esc(student.classroom_label||'')}</small></span>`;
 const saveDraft=()=>{
  const query=document.querySelector('#adjustmentSearch');
  const reason=document.querySelector('#adjustmentReason');
  const rule=document.querySelector('#adjustmentRule');
  if(query)state.query=query.value;
  if(reason)state.reason=reason.value;
  if(rule)state.ruleId=rule.value;
 };
 function render(){
  if(!active())return;
  const student=state.student,remaining=Number(state.scores.behavior_remaining)||0;
  const eligible=state.rules.filter(rule=>Number(rule.points)>0&&Number(rule.points)<=remaining);
  const studentRows=(items)=>items.map(item=>`<div class="score-student-row">
   <button class="score-adjust-select ${Number(student?.id)===Number(item.id)?'chosen':''}"
    type="button" data-adjustment-student="${item.id}" aria-pressed="${Number(student?.id)===Number(item.id)}">
    ${studentLabel(item)}<span class="score-adjust-pick-label">${Number(student?.id)===Number(item.id)?'เลือกอยู่':'เลือกนักเรียน'}</span>
   </button></div>`).join('');
  mount(`<div class="stack score-entry score-adjust-page">
    <div><h2>บันทึกการปรับพฤติกรรม</h2>
     <p class="muted">เลือกนักเรียนทีละคนจากห้องที่ได้รับสิทธิ์ แล้วบันทึกตามเกณฑ์ปรับพฤติกรรมที่ฝ่ายกิจการนักเรียนกำหนด
      ระบบจะไม่ใช้คะแนนความดีมาหักล้างคะแนนความผิด</p></div>
    <section class="card stack" aria-label="ค้นหานักเรียนเพื่อปรับพฤติกรรม">
     <h3>1. เลือกนักเรียน</h3>
     <form class="score-search" id="adjustmentSearchForm">
      <div class="field"><label for="adjustmentSearch">ค้นหาเลขประจำตัว หรือชื่อ-สกุล (ทุกห้องที่ได้รับสิทธิ์)</label>
       <input id="adjustmentSearch" type="search" autocomplete="off" minlength="2" maxlength="60"
        value="${esc(state.query)}" placeholder="ระบุเลขประจำตัวหรือชื่อ"></div>
      <button class="button" type="submit">ค้นหา</button>
      ${state.query||state.results.length?'<button type="button" class="button ghost" id="adjustmentClearSearch">ล้างค้นหา</button>':''}
     </form>
     ${state.results.length?`<div class="score-search-results" aria-label="ผลการค้นหา">
      <p class="muted">พบ ${state.results.length} คน (แสดงสูงสุด 60 คน)</p>
      ${studentRows(state.results)}</div>`:state.query?'<p class="muted">กดค้นหาเพื่อแสดงรายชื่อที่ตรงกัน</p>':''}
     <div class="score-room-bar"><div class="field"><label for="adjustmentRoom">เลือกห้องเรียน</label>
      <select id="adjustmentRoom">${rooms().map(room=>`<option value="${room.id}" ${Number(room.id)===Number(getRoomId())?'selected':''}>
       ${esc(room.label)}</option>`).join('')}</select></div></div>
     <div class="score-student-list" aria-label="รายชื่อในห้อง ${esc(roomLabel())}">
      ${state.students.length?studentRows(state.students):'<div class="empty">ห้องนี้ไม่มีรายชื่อนักเรียน</div>'}
     </div>
    </section>
    <section class="card stack" aria-label="บันทึกผลปรับพฤติกรรม">
     <h3>2. บันทึกผลการปรับพฤติกรรม</h3>
     ${student?`<div class="score-adjust-selected" aria-live="polite">
      <strong>${esc(student.full_name)}</strong>
      <span>เลขประจำตัว ${esc(student.student_no)} · ห้อง ${esc(student.classroom_label||'')}</span>
      <div class="row score-adjust-summary">
       <span class="tag">ความผิดรวม ${Number(state.scores.behavior_deducted)||0}</span>
       <span class="tag">ปรับแล้ว ${Number(state.scores.behavior_adjusted)||0}</span>
       <span class="tag">ความผิดคงเหลือ ${remaining}</span>
      </div></div>`:'<p class="empty">กรุณาเลือกนักเรียนจากรายชื่อหรือค้นหาเลขประจำตัวก่อน</p>'}
     <form class="stack" id="adjustmentRecordForm">
      <div class="field"><label for="adjustmentRule">เกณฑ์ปรับพฤติกรรม</label>
       <select id="adjustmentRule" name="adjustment_rule_id" required ${student?'':'disabled'}>
        <option value="">เลือกเกณฑ์ที่โรงเรียนกำหนด</option>
        ${eligible.map(rule=>`<option value="${rule.id}" ${String(rule.id)===String(state.ruleId)?'selected':''}>
         ${esc(rule.name)} (+${Number(rule.points)} คะแนน)</option>`).join('')}
       </select></div>
      <div class="field"><label for="adjustmentReason">รายละเอียดเพิ่มเติม <span class="muted">(ไม่บังคับ)</span></label>
       <textarea id="adjustmentReason" name="reason" maxlength="300" placeholder="เว้นว่างได้ ระบบใช้ชื่อเกณฑ์เป็นเหตุผล">${esc(state.reason)}</textarea></div>
      <button class="button full" type="submit" id="adjustmentSubmit" ${!student||!eligible.length?'disabled':''}>
       บันทึกการปรับพฤติกรรม</button>
      ${!state.rules.length?'<p class="muted">ฝ่ายกิจการนักเรียนยังไม่เปิดเกณฑ์ปรับพฤติกรรม</p>':
        student&&!eligible.length?'<p class="muted">คะแนนความผิดคงเหลือไม่เพียงพอสำหรับเกณฑ์ที่เปิดใช้งาน</p>':''}
     </form>
    </section>
    <section class="card stack" aria-label="ประวัติความผิดและการปรับพฤติกรรม">
     <div class="row between"><h3>ประวัติความผิดและการปรับพฤติกรรม${student?' • '+esc(student.full_name):''}</h3>
      ${student?`<span class="tag">คงเหลือ ${remaining} คะแนน</span>`:''}</div>
     ${student?scoreHistoryTables({items:state.history,mode:'behavior',esc}):
       '<div class="empty">เลือกนักเรียนเพื่อดูประวัติ</div>'}
     ${state.hasMore?'<button type="button" class="button secondary" id="adjustmentMore">ดูประวัติเพิ่มเติม</button>':''}
    </section>
   </div>`);
  document.querySelector('#adjustmentRoom')?.addEventListener('change',event=>safeRun(async()=>{
   saveDraft();setRoomId(Number(event.target.value));await load();
  }));
  document.querySelector('#adjustmentSearchForm')?.addEventListener('submit',event=>safeRun(async()=>{
   event.preventDefault();saveDraft();
   const query=state.query.trim();
   if(query.length<2){toast('กรุณาพิมพ์เลขประจำตัวหรือชื่ออย่างน้อย 2 ตัวอักษร',true);return}
   const result=await api('/api/affairs/behavior/students?query='+encodeURIComponent(query));
   if(!active()||state.query.trim()!==query)return;
   state.results=result.items||[];render();
   if(!state.results.length)toast('ไม่พบรายชื่อนักเรียนที่ตรงกับคำค้น',true);
  }));
  document.querySelector('#adjustmentClearSearch')?.addEventListener('click',()=>{
   saveDraft();state.query='';state.results=[];render();
  });
  document.querySelectorAll('[data-adjustment-student]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   saveDraft();const id=Number(button.dataset.adjustmentStudent);
   const selected=[...state.students,...state.results].find(student=>Number(student.id)===id);
   if(!selected)return;
   state.student=selected;state.ruleId='';await loadHistory();
  })));
  document.querySelector('#adjustmentRecordForm')?.addEventListener('submit',event=>safeRun(async()=>{
   event.preventDefault();saveDraft();
   const studentId=Number(state.student?.id),ruleId=Number(state.ruleId);
   if(!studentId||!eligible.some(rule=>Number(rule.id)===ruleId)){
    toast('กรุณาเลือกนักเรียนและเกณฑ์ที่ไม่เกินคะแนนคงเหลือ',true);return;
   }
   const button=document.querySelector('#adjustmentSubmit');
   if(button)button.disabled=true;
   try{
    await api('/api/affairs/behavior/adjust',{method:'POST',
     body:{student_id:studentId,adjustment_rule_id:ruleId,reason:state.reason}});
    state.reason='';state.ruleId='';
    toast('บันทึกการปรับพฤติกรรมสำเร็จ');
    await loadHistory();
   }finally{if(button?.isConnected)button.disabled=false}
  }));
  document.querySelectorAll('[data-score-delete]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   saveDraft();
   const id=Number(button.dataset.scoreDelete);
   if(!window.confirm('ยืนยันลบรายการที่คุณบันทึกเอง? ระบบจะเก็บหลักฐานการลบไว้'))return;
   button.disabled=true;
   try{
    await api('/api/behavior/records/'+id+'/delete',{method:'POST',body:{}});
    toast('ลบรายการแล้ว และอัปเดตคะแนนคงเหลือ');
    await loadHistory();
   }finally{if(button.isConnected)button.disabled=false}
  })));
  document.querySelector('#adjustmentMore')?.addEventListener('click',()=>safeRun(async()=>{
   saveDraft();await loadHistory(true);
  }));
 }
 async function loadHistory(more=false){
  const student=state.student;
  if(!student){state.history=[];state.hasMore=false;state.scores={};render();return}
  const offset=more?state.nextOffset:0;
  const data=await api('/api/behavior?student_id='+student.id+'&offset='+offset);
  if(!active()||Number(state.student?.id)!==Number(student.id))return;
  state.history=more?[...state.history,...(data.items||[])]:data.items||[];
  state.hasMore=Boolean(data.has_more);
  state.nextOffset=Number(data.next_offset)||0;
  state.scores=data;render();
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
  if(state.student)await loadHistory();
  else render();
 }
 return {load};
}
