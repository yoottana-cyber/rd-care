// Shared teacher entry screen: multi-room student selection for conduct and merit.
export function createScoreRecording({api,mount,safeRun,toast,rooms,getRoomId,setRoomId,getTab,escapeHtml}){
 const modes={
  behavior:{picked:new Map(),query:'',results:[],students:[],rules:[],focusId:null,focusName:'',history:[],scores:{},ruleId:'',reason:''},
  good:{picked:new Map(),query:'',results:[],students:[],rules:[],focusId:null,focusName:'',history:[],scores:{},ruleId:'',reason:''}
 };
 const esc=escapeHtml;
 const mode=()=>getTab()==='good'?'good':'behavior';
 const selectedState=()=>modes[mode()];
 const roomLabel=()=>rooms().find(r=>Number(r.id)===Number(getRoomId()))?.label||'';
 const title=key=>key==='good'?'คะแนนความดี':'คะแนนพฤติกรรม';
 const actions={good:'ทำความดี',minor:'ความผิดเล็กน้อย',moderate:'ความผิดปานกลาง',
  serious:'ความผิดร้ายแรง',very_serious:'ความผิดร้ายแรงมาก',adjustment:'ปรับพฤติกรรม'};
 const studentLabel=st=>`${st.roll_no?esc(st.roll_no)+'. ':''}${esc(st.full_name)} <small>${esc(st.student_no)} · ${esc(st.classroom_label)}</small>`;
 function rememberDraft(){
  const u=selectedState();
  const rule=document.querySelector('#scoreRule'),reason=document.querySelector('#scoreReason'),query=document.querySelector('#scoreSearch');
  if(rule)u.ruleId=rule.value;
  if(reason)u.reason=reason.value;
  if(query)u.query=query.value;
 }
 function setFocus(u,item){
  u.focusId=item.id;u.focusName=item.full_name;
 }
 function addPicked(u,item){
  if(u.picked.has(item.id))return true;
  if(u.picked.size>=200){toast('เลือกนักเรียนได้สูงสุด 200 คนต่อการบันทึกหนึ่งครั้ง',true);return false}
  u.picked.set(item.id,item);
  if(!u.focusId)setFocus(u,item);
  return true;
 }
 function draw(){
  const key=mode(),u=modes[key],isGood=key==='good',count=u.picked.size;
  const filtered=u.rules.filter(r=>isGood?r.category==='good':r.category!=='good');
  const history=u.history.filter(x=>isGood?x.score_type==='good':x.score_type!=='good');
  const fromRoom=u.students.length>0&&u.students.every(x=>u.picked.has(x.id));
  const selected=[...u.picked.values()];
  const groupCount=new Set(selected.map(x=>x.classroom_id)).size;
  const points=isGood?'คะแนนความดีสะสม '+Number(u.scores.good_total||0):
   'คะแนนความผิดคงเหลือ '+Number(u.scores.behavior_remaining||0);
  mount(`<div class="stack score-entry">
   <div><h2>${title(key)}</h2><p class="muted">${isGood?
    'บันทึกความดีให้หลายคนพร้อมกัน โดยคะแนนความดีแยกจากคะแนนพฤติกรรม':
    'บันทึกความผิดตามเกณฑ์ที่โรงเรียนอนุมัติ สามารถเลือกนักเรียนจากหลายห้องพร้อมกันได้'}</p></div>
   <section class="card stack" aria-label="ค้นหาและเลือกรายชื่อนักเรียน">
    <div class="row between"><h3>1. เลือกนักเรียน</h3><span class="tag">เลือกแล้ว ${count} คน · ${groupCount} ห้อง</span></div>
    <form id="scoreSearchForm" class="score-search">
     <div class="field"><label for="scoreSearch">ค้นหาจากเลขประจำตัวนักเรียน หรือชื่อ-สกุล (ทุกห้องที่ได้รับสิทธิ์)</label>
      <input id="scoreSearch" type="search" autocomplete="off" minlength="2" maxlength="60"
       placeholder="เช่น 12345 หรือชื่อที่ต้องการค้นหา" value="${esc(u.query)}"></div>
     <button class="button" type="submit">ค้นหา</button>
     ${u.results.length||u.query?'<button class="button ghost" type="button" id="scoreSearchClear">ล้างค้นหา</button>':''}
    </form>
    ${u.results.length?`<div class="score-search-results" aria-label="ผลการค้นหา">
     <p class="muted">ผลการค้นหา ${u.results.length} คน (สูงสุด 60 คน)</p>
     ${u.results.map(st=>`<div class="score-student-row">
      <label><input type="checkbox" data-score-choice="${st.id}" ${u.picked.has(st.id)?'checked':''}>
       <span>${studentLabel(st)}</span></label>
      <button class="button ghost" type="button" data-score-focus="${st.id}">ดูประวัติ</button>
     </div>`).join('')}
    </div>`:u.query?'<p class="muted">หากยังไม่มีผลลัพธ์ ให้กดปุ่มค้นหา</p>':''}
    <div class="score-room-bar">
     <div class="field"><label for="scoreRoom">เลือกห้องเรียนเพื่อดูรายชื่อ</label>
      <select id="scoreRoom">${rooms().map(r=>`<option value="${r.id}" ${Number(r.id)===Number(getRoomId())?'selected':''}>${esc(r.label)}</option>`).join('')}</select>
     </div><button class="button secondary" id="scoreToggleRoom" type="button" ${u.students.length?'':'disabled'}>
      ${fromRoom?'ยกเลิกเลือกทั้งห้อง':'เลือกนักเรียนทั้งห้อง'}</button>
    </div>
    <div class="score-student-list" aria-label="รายชื่อนักเรียนในห้อง ${esc(roomLabel())}">
     ${u.students.length?u.students.map(st=>`<div class="score-student-row">
      <label><input type="checkbox" data-score-choice="${st.id}" ${u.picked.has(st.id)?'checked':''}>
       <span>${studentLabel(st)}</span></label>
      <button class="button ghost" type="button" data-score-focus="${st.id}">ดูประวัติ</button>
     </div>`).join(''):'<div class="empty">ห้องนี้ยังไม่มีนักเรียน</div>'}
    </div>
   </section>
   <section class="card stack" aria-label="บันทึกคะแนน">
    <div class="row between"><h3>2. เลือกเกณฑ์และบันทึก</h3>
     <button type="button" class="button ghost" id="scoreClearSelected" ${count?'':'disabled'}>ล้างรายชื่อที่เลือก</button></div>
    <div class="score-selected" aria-live="polite">
     ${selected.length?selected.map(st=>`<span class="score-selected-chip">${esc(st.full_name)} · ${esc(st.classroom_label)}
      <button type="button" data-score-remove="${st.id}" aria-label="นำ ${esc(st.full_name)} ออกจากรายการ">×</button></span>`).join(''):
      '<p class="muted">ยังไม่ได้เลือกนักเรียน สามารถติ๊กเลือกจากห้องหรือค้นหาเลขประจำตัวได้</p>'}
    </div>
    <form id="scoreForm" class="stack">
     <div class="field"><label for="scoreRule">${isGood?'เลือกเกณฑ์ความดี':'เลือกเกณฑ์คะแนนพฤติกรรม'}</label>
      <select id="scoreRule" name="rule_id" required><option value="">เลือกเกณฑ์</option>
       ${filtered.map(rule=>`<option value="${rule.id}" ${String(rule.id)===String(u.ruleId)?'selected':''}>${esc(actions[rule.category]||rule.category)} · ${esc(rule.name)} (${Number(rule.points)>0?'+':''}${Number(rule.points)})</option>`).join('')}
      </select></div>
     <div class="field"><label for="scoreReason">รายละเอียดเพิ่มเติม <span class="muted">(ไม่บังคับ)</span></label>
      <textarea id="scoreReason" name="reason" maxlength="300" placeholder="เว้นว่างได้ ระบบจะใช้ชื่อเกณฑ์เป็นเหตุผล">${esc(u.reason)}</textarea></div>
     <button class="button full" id="scoreSubmit" type="submit" ${count&&filtered.length?'':'disabled'}>
      ${isGood?'บันทึกคะแนนความดี':'บันทึกคะแนนพฤติกรรม'} ${count} คน</button>
     ${!filtered.length?'<p class="warn">ยังไม่มีเกณฑ์คะแนนหมวดนี้ที่เปิดใช้งาน</p>':''}
    </form>
   </section>
   <section class="card stack" aria-label="ประวัติคะแนนนักเรียน">
    <div class="row between"><h3>ประวัติของ ${esc(u.focusName||'นักเรียนที่เลือกดู')}</h3><span class="tag">${points}</span></div>
    ${history.length?`<div class="table-wrap"><table class="table"><thead><tr>
     <th>ประเภท</th><th>คะแนน</th><th>เหตุผล</th><th>ผู้บันทึก</th><th>เวลา</th></tr></thead><tbody>
     ${history.map(row=>`<tr><td>${esc(actions[row.affairs_category]|| (row.score_type==='good'?'ความดี':'ความผิด'))}</td>
      <td>${Number(row.points)>0?'+':''}${Number(row.points)}</td><td>${esc(row.reason)}</td>
      <td>${esc(row.teacher_name)}</td><td>${esc(row.created_at)}</td></tr>`).join('')}
     </tbody></table></div>`:'<div class="empty">ยังไม่มีประวัติในหมวดนี้</div>'}
   </section>
  </div>`);
  document.querySelector('#scoreRoom')?.addEventListener('change',e=>safeRun(async()=>{
   rememberDraft();setRoomId(Number(e.target.value));await load();
  }));
  document.querySelector('#scoreToggleRoom')?.addEventListener('click',()=>{
   rememberDraft();
   if(fromRoom){for(const st of u.students)u.picked.delete(st.id)}
   else for(const st of u.students)if(!addPicked(u,st))break;
   draw();
  });
  document.querySelector('#scoreSearchForm')?.addEventListener('submit',e=>safeRun(async()=>{
   e.preventDefault();rememberDraft();
   const q=u.query.trim();
   if(q.length<2){toast('กรุณาพิมพ์เลขประจำตัวหรือชื่ออย่างน้อย 2 ตัวอักษร',true);return}
   const match=await api('/api/affairs/behavior/students?query='+encodeURIComponent(q));
   if(getTab()!==key||u.query.trim()!==q)return;
   u.results=match.items||[];draw();
   if(!u.results.length)toast('ไม่พบนักเรียนที่ตรงกับคำค้น',true);
  }));
  document.querySelector('#scoreSearchClear')?.addEventListener('click',()=>{
   rememberDraft();u.query='';u.results=[];draw();
  });
  document.querySelectorAll('[data-score-choice]').forEach(box=>box.addEventListener('change',e=>{
   rememberDraft();const studentId=Number(e.currentTarget.dataset.scoreChoice);
   const st=u.students.find(x=>x.id===studentId)||u.results.find(x=>x.id===studentId);
   if(!st)return;
   if(e.currentTarget.checked)addPicked(u,st);
   else u.picked.delete(studentId);
   draw();
  }));
  document.querySelectorAll('[data-score-focus]').forEach(btn=>btn.addEventListener('click',()=>safeRun(async()=>{
   rememberDraft();const studentId=Number(btn.dataset.scoreFocus);
   const st=u.students.find(x=>x.id===studentId)||u.results.find(x=>x.id===studentId);
   if(st){setFocus(u,st);await loadHistory(key)}
  })));
  document.querySelectorAll('[data-score-remove]').forEach(btn=>btn.addEventListener('click',()=>{
   rememberDraft();u.picked.delete(Number(btn.dataset.scoreRemove));draw();
  }));
  document.querySelector('#scoreClearSelected')?.addEventListener('click',()=>{
   rememberDraft();u.picked.clear();draw();
  });
  document.querySelector('#scoreForm')?.addEventListener('submit',e=>safeRun(async()=>{
   e.preventDefault();rememberDraft();
   const ids=[...u.picked.keys()];
   if(!ids.length){toast('กรุณาเลือกนักเรียนก่อนบันทึก',true);return}
   if(!u.ruleId){toast('กรุณาเลือกเกณฑ์คะแนน',true);return}
   const button=document.querySelector('#scoreSubmit');
   if(button)button.disabled=true;
   try{
    const result=await api('/api/affairs/behavior/record/bulk',{method:'POST',
     body:{student_ids:ids,rule_id:Number(u.ruleId),reason:u.reason},timeoutMs:30000});
    const first=u.picked.get(ids[0]);
    if(first)setFocus(u,first);
    u.picked.clear();u.reason='';
    toast('บันทึก'+title(key)+'สำเร็จ '+Number(result.count||ids.length)+' คน');
    if(getTab()===key)await loadHistory(key);
   }finally{if(button?.isConnected)button.disabled=false}
  }));
 }
 async function loadHistory(key){
  const u=modes[key],focusId=u.focusId;
  if(!focusId){u.history=[];u.scores={};if(getTab()===key)draw();return}
  const data=await api('/api/behavior?student_id='+focusId);
  if(getTab()!==key||u.focusId!==focusId)return;
  u.history=data.items||[];u.scores=data;draw();
 }
 async function load(){
  const key=mode(),u=modes[key],roomId=getRoomId();
  if(!roomId){mount('<div class="empty">ยังไม่มีห้องเรียนที่ได้รับสิทธิ์</div>');return}
  const [students,rules]=await Promise.all([
   api('/api/students?classroom_id='+roomId),
   api('/api/affairs/behavior/rules')
  ]);
  if(mode()!==key||getRoomId()!==roomId)return;
  const label=roomLabel();
  u.students=(students.items||[]).map(st=>({...st,classroom_id:roomId,classroom_label:label}));
  u.rules=(rules.items||[]).filter(x=>x.active);
  if(!u.focusId&&u.students.length)setFocus(u,u.students[0]);
  if(u.focusId)await loadHistory(key);
  else draw();
 }
 return {load};
}
