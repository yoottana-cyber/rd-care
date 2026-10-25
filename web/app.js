import {API_BASE_URL} from './config.js';
import {runSafely} from './run-safely.js';
import {createRequestCache} from './request-cache.js';
import {createUnifiedImport} from './unified-import.js';
import {createPortalUi} from './portal-ui.js';
import {createPortalAdmin} from './portal-admin.js';
const $=(selector)=>document.querySelector(selector);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const state={token:sessionStorage.getItem('rd_token')||'',user:null,tab:'dashboard',rooms:[],users:[],roomId:null,date:dateToday(),kind:'daily',slotId:null,slots:[],students:[],statuses:{},savedCount:0,stats:null,alerts:[],lates:[],selfLates:[],behaviors:[],behaviorTotal:0};
const referenceCache=createRequestCache();
const adminStudentState={roomId:null,items:[],editId:null};
const unifiedImport=createUnifiedImport({api,rooms:state.rooms,onSuccess:async()=>{referenceCache.clear();await loadAdminStudents()}});
const adminTransferState={studentId:null,items:[],history:[]};
let adminEditUserId=null;
const names={present:'มา',absent:'ขาด',late:'สาย',leave:'ลา'};
const roles={admin:'ผู้ดูแลระบบ',teacher:'ครู',staff:'ฝ่ายกิจการนักเรียน'};
let toastTimer;
const portalUi=createPortalUi({root:$('#app'),onStaffLogin:()=>renderLogin()});
function dateToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function timeNow(){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}
function toast(message,bad=false){const el=$('#toast');el.textContent=message;el.className='toast show'+(bad?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',4200);}
async function api(path,{method='GET',body,auth=true}={}){
 if(API_BASE_URL.includes('REPLACE-WITH'))throw Error('กรุณาตั้งค่า API_BASE_URL ใน web/config.js ก่อน');
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(API_BASE_URL+path,{method,headers:{'Content-Type':'application/json',...(auth&&state.token?{Authorization:`Bearer ${state.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){if(response.status===401&&auth){referenceCache.clear();state.token='';state.user=null;sessionStorage.removeItem('rd_token');renderLogin();}throw Error(data.error||`HTTP ${response.status}`)}
  return data;
 }catch(e){if(e.name==='AbortError')throw Error('การเชื่อมต่อล่าช้า กรุณาลองใหม่');throw e}
 finally{clearTimeout(timer)}
}
function safeRun(job){return runSafely(job,e=>toast(e?.message||String(e),true));}
function loginPage(){
 return `<div class="login-wrap"><section class="card login-card">
 <div class="login-head"><div class="brand-icon">RD</div><h1>RD Care</h1><p>ระบบเช็กชื่อและดูแลช่วยเหลือนักเรียน</p></div>
 <form id="loginForm"><div class="field"><label for="username">ชื่อผู้ใช้งาน</label><input id="username" name="username" required autocomplete="username" placeholder="เช่น teacher01"></div>
 <div class="field"><label for="password">รหัสผ่าน</label><input id="password" name="password" type="password" required autocomplete="current-password"></div>
 <button class="button full" type="submit">เข้าสู่ระบบ</button></form>
 <div class="grid two" style="margin-top:12px">
 <button id="portalStudentLogin" type="button" class="button secondary full">นักเรียนเข้าสู่ระบบ</button>
 <button id="portalGuardianLogin" type="button" class="button secondary full">ผู้ปกครองเข้าสู่ระบบ</button></div>
 <button id="studentLateEntry" type="button" class="button secondary full" style="margin-top:12px">นักเรียนแจ้งมาสาย</button>
 <p class="muted" style="text-align:center">รุ่นทดลอง • ยังไม่เปิดใช้งานการแจ้งเตือนผู้ปกครอง</p></section></div>`;
}
function renderLogin(){ $('#app').innerHTML=loginPage();$('#loginForm').addEventListener('submit',e=>safeRun(async()=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const data=await api('/api/auth/login',{method:'POST',auth:false,body:{username:$('#username').value,password:$('#password').value}});state.token=data.token;state.user=data.user;sessionStorage.setItem('rd_token',data.token);await boot();toast('เข้าสู่ระบบสำเร็จ');}finally{button.disabled=false}}));$('#studentLateEntry').addEventListener('click',renderStudentLate);$('#portalStudentLogin').addEventListener('click',()=>portalUi.showLogin('student'));$('#portalGuardianLogin').addEventListener('click',()=>portalUi.showLogin('guardian')); }
function renderStudentLate(){
 $('#app').innerHTML=`<div class="login-wrap"><section class="card login-card stack">
 <div class="login-head"><div class="brand-icon">RD</div><h1>แจ้งมาสายด้วยตนเอง</h1><p>ระบบทดลอง • ต้องใช้รหัสชั่วคราวที่ครูเวรออกให้สำหรับนักเรียนแต่ละคน</p></div>
 <form class="stack" id="studentLateForm">
  <div class="field"><label for="studentNumber">รหัสประจำตัวนักเรียน</label><input id="studentNumber" name="student_no" maxlength="40" required autocomplete="off" placeholder="เช่น DEMO1001"></div>
  <div class="field"><label for="studentLateCode">รหัสยืนยันจากครูเวร</label><input id="studentLateCode" name="code" pattern="[a-fA-F0-9]{24}" maxlength="24" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="รหัส 24 ตัวอักษร"></div>
  <div class="field"><label for="studentLateReason">สาเหตุ (ไม่บังคับ)</label><textarea id="studentLateReason" name="reason" maxlength="300" placeholder="ระบุเหตุผลตามที่ต้องการแจ้ง"></textarea></div>
  <button type="submit" class="button full">ส่งคำขอให้ครูเวรตรวจสอบ</button>
 </form>
 <p id="lateSelfFeedback" class="muted" aria-live="polite">ระบบบันทึกเวลาเข้าถึงเซิร์ฟเวอร์อัตโนมัติ เมื่อครูเวรยืนยันจึงนับเป็นรายการมาสายที่ตรวจสอบแล้ว</p>
 <button type="button" class="button secondary full" id="backToStaffLogin">กลับหน้าเข้าสู่ระบบครู</button>
 </section></div>`;
 $('#backToStaffLogin').addEventListener('click',renderLogin);
 $('#studentLateForm').addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');
  const body=Object.fromEntries(new FormData(form));
  button.disabled=true;
  try{
   const result=await api('/api/student/late/report',{method:'POST',body,auth:false});
   form.reset();form.hidden=true;$('#lateSelfFeedback').textContent=result.message;
   toast('ส่งคำขอมาสายแล้ว รอครูเวรตรวจสอบ');
  }finally{if(button.isConnected)button.disabled=false}
 }));
}
async function boot(){
 const [me,rooms]=await Promise.all([api('/api/auth/me'),api('/api/classrooms')]);state.user=me.user;state.rooms=rooms.items;
 if(!state.rooms.some(r=>r.id===state.roomId))state.roomId=state.rooms[0]?.id||null;
 await showTab('dashboard');
}
function roleName(){return roles[state.user?.role]||state.user?.role;}
function chrome(content){
 const navs=[['dashboard','ภาพรวม','▦'],['attendance','เช็กชื่อ','✓'],['late','มาสาย','◷'],['behavior','พฤติกรรม','★'],['alerts','ตรวจสอบขาด','!'],...(state.user?.role==='admin'?[['adminStudents','นักเรียน','♙'],['portalAccounts','บัญชีผู้เรียน/ผู้ปกครอง','♧'],['admin','ครูและระบบ','⚙']]:[])];
 return `<main class="shell"><header class="top"><div class="brand"><div class="brand-icon">RD</div><div><h1>RD Care</h1><p>Smart Student Care • รุ่นทดสอบ D1</p></div></div>
 <div class="user"><div><strong>${esc(state.user.display_name)}</strong><br><span>${esc(roleName())}</span></div><button id="logout" class="button ghost" type="button">ออก</button></div></header>
 <nav class="nav" aria-label="เมนูหลัก">${navs.map(([id,label,ico])=>`<button class="${state.tab===id?'active':''}" data-tab="${id}" type="button">${ico} ${label}</button>`).join('')}</nav>
 ${content}<footer class="foot">RD Care v0.1 • ทดลองกับข้อมูลจำลองก่อนใช้งานจริง • ไม่เปิด Push ผู้ปกครองในรุ่นนี้</footer></main>`;
}
function mount(content){$('#app').innerHTML=chrome(content);$$('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>safeRun(()=>showTab(btn.dataset.tab))));$('#logout').addEventListener('click',()=>safeRun(logout));}
function $$(sel){return [...document.querySelectorAll(sel)]}
async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch{}referenceCache.clear();state.token='';state.user=null;sessionStorage.removeItem('rd_token');renderLogin();}
function roomOptions(){return state.rooms.map(r=>`<option value="${r.id}" ${r.id===state.roomId?'selected':''}>${esc(r.label)}</option>`).join('');}
function filters({date=true}={}){return `<div class="row"><div class="field smallbox"><label for="room">ห้องเรียน</label><select id="room">${roomOptions()}</select></div>${date?`<div class="field smallbox"><label for="day">วันที่</label><input id="day" type="date" value="${state.date}" max="${dateToday()}"></div>`:''}</div>`;}
function bindFilters(onChange){$('#room')?.addEventListener('change',e=>safeRun(async()=>{state.roomId=Number(e.target.value);state.slotId=null;await onChange()}));$('#day')?.addEventListener('change',e=>safeRun(async()=>{state.date=e.target.value;state.slotId=null;await onChange()}));}
async function showTab(tab){state.tab=tab;
 if(tab!=='adminStudents')unifiedImport.clear();
 if(tab==='dashboard')return loadDashboard();
 if(tab==='attendance')return loadAttendance();
 if(tab==='late')return loadLate();
 if(tab==='behavior')return loadBehavior();
 if(tab==='alerts')return loadAlerts();
 if(tab==='admin')return loadAdmin();
 if(tab==='adminStudents')return loadAdminStudents();
 if(tab==='portalAccounts')return createPortalAdmin({api,mount,toast,rooms:state.rooms,safeRun}).load();
}
async function loadDashboard(){state.stats=await api('/api/dashboard?date='+encodeURIComponent(state.date));renderDashboard();}
function renderDashboard(){const s=state.stats||{};mount(`<section class="stack"><div><h2>ภาพรวมการดูแลนักเรียน</h2><p class="muted">สถิติจากข้อมูลที่บันทึกแล้ว • ${esc(state.date)}</p></div>
 <div class="card">${filters()}</div><div class="grid four">${[['ห้องเรียน',s.rooms],['นักเรียน',s.students],['รายการเช็กชื่อประจำวัน',s.daily],['รายการเช็กชื่อรายคาบ',s.period]].map(([name,n])=>`<div class="card stats"><small>${name}</small><strong>${Number(n||0).toLocaleString('th-TH')}</strong></div>`).join('')}</div>
 <div class="grid three">${[['พบขาดรายคาบ',s.absent_period],['รอตรวจสอบ',s.alerts],['รายการมาสาย',s.late]].map(([name,n])=>`<div class="card stats"><small>${name}</small><strong>${Number(n||0).toLocaleString('th-TH')}</strong></div>`).join('')}</div>
 <div class="warn">การขาดรายคาบหมายถึง “ไม่พบการเข้าชั้นเรียน” ยังไม่ใช่ข้อสรุปว่านักเรียนหนีเรียน ต้องให้ครูที่ปรึกษาตรวจสอบก่อน</div></section>`);
 bindFilters(loadDashboard);
}
async function loadAttendance(){
 if(!state.roomId){mount(`<div class="card empty">ยังไม่มีห้องเรียนที่ได้รับสิทธิ์</div>`);return}
 const roomId=state.roomId,date=state.date;
 // Independent lookups run in parallel; repeat switches use a short memory-only cache.
 const [students,slots]=await Promise.all([
  referenceCache.get('students:'+roomId+':'+date,()=>api(`/api/students?classroom_id=${roomId}&date=${date}`)),
  referenceCache.get('timetable:'+roomId+':'+date,()=>api(`/api/timetable?date=${date}&classroom_id=${roomId}`))
 ]);
 if(state.tab!=='attendance'||state.roomId!==roomId||state.date!==date)return;
 state.students=students.items;state.slots=slots.items;
 if(!state.slots.some(s=>s.id===state.slotId))state.slotId=state.slots[0]?.id||null;
 const kind=state.kind,slotId=state.slotId;
 let entries=[];
 if(kind==='daily'||slotId){
  const q=`?kind=${kind}&classroom_id=${roomId}&date=${date}`+(kind==='period'?`&timetable_id=${slotId}`:'');
  entries=(await api('/api/attendance'+q)).items;
 }
 // Drop responses from a previous room/date/period to avoid a stale form render.
 if(state.tab!=='attendance'||state.roomId!==roomId||state.date!==date||state.kind!==kind||state.slotId!==slotId)return;
 state.savedCount=entries.length;
 state.statuses=Object.fromEntries(state.students.map(s=>[s.id,'present']));
 for(const a of entries)state.statuses[a.student_id]=a.status;
 renderAttendance();
}
function statusCounts(){return Object.fromEntries(['present','absent','late','leave'].map(s=>[s,Object.values(state.statuses).filter(x=>x===s).length]));}
function statusSummary(){const c=statusCounts();return `มา ${c.present} • ขาด ${c.absent} • สาย ${c.late} • ลา ${c.leave}`;}
function renderAttendance(){
 const slotOptions=state.slots.map(s=>`<option value="${s.id}" ${s.id===state.slotId?'selected':''}>คาบ ${s.period} • ${esc(s.subject)} (${esc(s.teacher_name)})</option>`).join('');
 const students=state.students.map(s=>`<div class="student" data-id="${s.id}"><div><div class="student-name">${s.roll_no}. ${esc(s.full_name)}</div><div class="student-sub">รหัส ${esc(s.student_no)}</div></div><div class="pills">${Object.keys(names).map(status=>`<button type="button" data-student="${s.id}" data-status="${status}" class="pill ${state.statuses[s.id]===status?status:''}" aria-pressed="${state.statuses[s.id]===status}">${names[status]}</button>`).join('')}</div></div>`).join('');
 mount(`<section class="stack"><div><h2>เช็กชื่อนักเรียน</h2><p class="muted">แตะเฉพาะนักเรียนที่ขาด สาย หรือลา แล้วกดบันทึกทั้งห้อง</p></div><div class="card stack">${filters()}
  <div class="row"><button class="button ${state.kind==='daily'?'':'secondary'}" data-kind="daily">ประจำวัน</button><button class="button ${state.kind==='period'?'':'secondary'}" data-kind="period">รายคาบ</button></div>
  ${state.kind==='period'?`<div class="field"><label>เลือกคาบเรียนตามตาราง</label><select id="slot">${slotOptions||'<option value="">ยังไม่กำหนดตารางสอนวันนี้</option>'}</select></div>`:''}
 </div><div class="card stack"><div class="row between"><div><h3>รายชื่อนักเรียน (${state.students.length} คน)</h3><span class="muted" id="counts">${statusSummary()}</span></div><button id="markAll" class="button ghost" type="button">เลือกมาทั้งหมด</button></div>
 ${state.savedCount?`<div class="ok">มีข้อมูลบันทึกแล้ว ${state.savedCount} คน • การกดบันทึกใหม่จะปรับสถานะล่าสุด</div>`:'<div class="warn">ข้อมูลเบื้องต้นแสดง “มา” ทุกคนเพื่อช่วยเช็กชื่อเร็วขึ้น ต้องตรวจสอบด้วยตัวเองก่อนบันทึก</div>'}
 <div class="attendance-list">${students||'<div class="empty">ยังไม่มีนักเรียนในห้องนี้</div>'}</div>
 <button id="saveAttendance" class="button full" ${!state.students.length||state.kind==='period'&&!state.slotId?'disabled':''}>✓ ยืนยันและบันทึกทั้งห้อง</button></div></section>`);
 bindFilters(loadAttendance);
 $$('[data-kind]').forEach(btn=>btn.addEventListener('click',()=>safeRun(async()=>{state.kind=btn.dataset.kind;await loadAttendance()})));
 $('#slot')?.addEventListener('change',e=>safeRun(async()=>{state.slotId=Number(e.target.value)||null;await loadAttendance()}));
 $$('[data-student]').forEach(btn=>btn.addEventListener('click',()=>{state.statuses[Number(btn.dataset.student)]=btn.dataset.status;updateAttendanceControls()}));
 $('#markAll')?.addEventListener('click',()=>{for(const s of state.students)state.statuses[s.id]='present';updateAttendanceControls()});
 $('#saveAttendance')?.addEventListener('click',()=>safeRun(saveAttendance));
}
function updateAttendanceControls(){for(const el of $$('[data-student]')){const chosen=state.statuses[Number(el.dataset.student)]===el.dataset.status;el.className='pill '+(chosen?el.dataset.status:'');el.setAttribute('aria-pressed',chosen)}$('#counts').textContent=statusSummary();}
async function saveAttendance(){
 if(!state.students.length)return;
 const button=$('#saveAttendance');button.disabled=true;
 try{const result=await api('/api/attendance',{method:'POST',body:{kind:state.kind,date:state.date,classroom_id:state.roomId,timetable_id:state.slotId,entries:state.students.map(s=>({student_id:s.id,status:state.statuses[s.id]}))}});toast(`บันทึกสำเร็จ ${result.saved} คน`);await loadAttendance();}
 finally{button.disabled=false}
}
async function loadLate(){
 if(!state.roomId){mount('<div class="empty">ยังไม่มีห้องเรียนที่ได้รับสิทธิ์</div>');return}
 const room=state.roomId,date=state.date;
 const staff=state.user?.role==='staff'||state.user?.role==='admin';
 const [a,b,self]=await Promise.all([
   api(`/api/students?classroom_id=${room}&date=${date}`),
   api(`/api/late?classroom_id=${room}&date=${date}`),
   staff?api(`/api/late/self/requests?classroom_id=${room}&date=${date}`):Promise.resolve({items:[]})
 ]);
 if(state.tab!=='late'||state.roomId!==room||state.date!==date)return;
 state.students=a.items;state.lates=b.items;state.selfLates=self.items;
 renderLate();
}
function studentOptions(){return state.students.map(s=>`<option value="${s.id}">${s.roll_no}. ${esc(s.full_name)}</option>`).join('');}
function renderLate(){
 const staff=state.user?.role==='staff'||state.user?.role==='admin';
 const requests=state.selfLates||[];
 const pending=requests.filter(r=>r.state==='pending');
 mount(`<div class="stack"><div><h2>ระบบบันทึกนักเรียนมาสาย</h2><p class="muted">บันทึกเวลาและตรวจสอบคำขอจากนักเรียน • นักเรียนต้องใช้รหัสครั้งเดียวจากครูเวร</p></div>
 <div class="card stack">${filters()}<form id="lateForm" class="stack">
 <div class="grid two"><div class="field"><label>นักเรียน</label><select name="student_id" required>${studentOptions()}</select></div>
 <div class="field"><label>เวลามาถึง</label><input name="arrived_at" type="time" value="${timeNow()}" required></div></div>
 <div class="field"><label>สาเหตุ (ไม่บังคับ)</label><textarea name="reason" maxlength="300" placeholder="ระบุเหตุผลตามที่ได้รับแจ้ง"></textarea></div>
 <button class="button full" ${!state.students.length?'disabled':''}>บันทึกมาสายโดยครู</button></form></div>
 ${staff?`<section class="card stack"><h3>ออกรหัสให้นักเรียนแจ้งมาสาย</h3>
  <p class="muted">ครูเวรออกให้เป็นรายคน รหัสมีอายุ 10 นาที ใช้ได้ครั้งเดียว และต้องแจ้งให้นักเรียนโดยตรงเท่านั้น</p>
  <form id="lateIssueCode" class="stack"><div class="field"><label>นักเรียน</label><select name="student_id" required>${studentOptions()}</select></div>
  <button class="button secondary full" type="submit" ${!state.students.length||state.date!==dateToday()?'disabled':''}>สร้างรหัสยืนยันชั่วคราว</button></form>
  ${state.date!==dateToday()?'<p class="warn">การออกรหัสทำได้เฉพาะวันที่ปัจจุบัน กรุณาเปลี่ยนวันที่ก่อน</p>':''}
  <div id="lateIssuedCode" aria-live="polite" class="summary" hidden></div>
  <p class="muted">นักเรียนเปิดหน้าเว็บ RD Care ก่อนเข้าสู่ระบบ → “นักเรียนแจ้งมาสาย” กรอกรหัสนักเรียนและรหัสยืนยัน</p>
 </section>
 <section class="card stack"><h3>รายการแจ้งมาสายรอตรวจสอบ (${pending.length})</h3>
  ${requests.length?`<div class="table-wrap"><table class="table"><thead><tr><th>นักเรียน</th><th>เวลา</th><th>สาเหตุ</th><th>สถานะ</th><th>การตรวจสอบ</th></tr></thead>
  <tbody>${requests.map(r=>`<tr><td>${esc(r.roll_no)}. ${esc(r.full_name)}<div class="muted">${esc(r.student_no)}</div></td>
   <td>${esc(r.arrived_at)}</td><td>${esc(r.reason||'ไม่ระบุ')}</td>
   <td>${r.state==='pending'?'รอตรวจสอบ':r.state==='verified'?'ยืนยันแล้ว':'ไม่อนุมัติ'}</td>
   <td>${r.state==='pending'?`<button class="button secondary" type="button" data-review-self="${r.id}" data-result="verified">ยืนยัน</button>
    <button class="button ghost" type="button" data-review-self="${r.id}" data-result="rejected">ปฏิเสธ</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">ยังไม่มีคำขอจากนักเรียนในห้องนี้</div>'}
 </section>`:''}
 <div class="card"><h3>รายการมาสายวันที่ ${esc(state.date)}</h3>${state.lates.length?`<div class="table-wrap"><table class="table"><thead><tr><th>นักเรียน</th><th>เวลา</th><th>สถานะ</th></tr></thead><tbody>${state.lates.map(l=>`<tr><td>${esc(l.full_name)}</td><td>${esc(l.arrived_at)}</td><td>${l.state==='verified'?'ยืนยันแล้ว':l.state==='rejected'?'ไม่อนุมัติ':'รอตรวจสอบ'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">ยังไม่มีรายการมาสายที่บันทึกแล้ว</div>'}</div></div>`);
 bindFilters(loadLate);
 $('#lateForm').addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();const form=e.currentTarget,f=new FormData(form),button=form.querySelector('button');
  button.disabled=true;
  try{
   await api('/api/late',{method:'POST',body:{student_id:Number(f.get('student_id')),arrived_at:f.get('arrived_at'),reason:f.get('reason'),date:state.date}});
   toast('บันทึกมาสายสำเร็จ');await loadLate();
  }finally{if(button.isConnected)button.disabled=false}
 }));
 $('#lateIssueCode')?.addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');
  button.disabled=true;
  try{
   const id=Number(new FormData(form).get('student_id'));
   const response=await api('/api/late/self/code',{method:'POST',body:{student_id:id}});
   const box=$('#lateIssuedCode');
   if(box){box.hidden=false;box.textContent='รหัสยืนยันชั่วคราว: '+response.code+' (หมดอายุใน 10 นาที) แจ้งให้นักเรียนโดยตรง ห้ามส่งลงกลุ่มสาธารณะ';}
  }finally{if(button.isConnected)button.disabled=false}
 }));
 $$('[data-review-self]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
  const id=Number(button.dataset.reviewSelf),result=button.dataset.result;
  const request=requests.find(r=>r.id===id);
  if(!request)return;
  if(!confirm((result==='verified'?'ยืนยัน':'ปฏิเสธ')+'การแจ้งมาสายของ '+request.full_name+'?'))return;
  button.disabled=true;
  try{
   await api('/api/late/self/requests/'+id+'/review',{method:'POST',body:{state:result}});
   toast(result==='verified'?'ตรวจสอบและบันทึกมาสายแล้ว':'ปฏิเสธคำขอแล้ว');
   await loadLate();
  }finally{if(button.isConnected)button.disabled=false}
 })));
}
async function loadBehavior(){if(!state.roomId){mount('<div class="empty">ยังไม่มีห้องเรียนที่ได้รับสิทธิ์</div>');return}const a=await api(`/api/students?classroom_id=${state.roomId}`);state.students=a.items;state.studentId=state.students.some(s=>s.id===state.studentId)?state.studentId:state.students[0]?.id||null;
 if(state.studentId){const b=await api('/api/behavior?student_id='+state.studentId);state.behaviors=b.items;state.behaviorTotal=b.total;}else {state.behaviors=[];state.behaviorTotal=0}renderBehavior();}
function renderBehavior(){mount(`<div class="stack"><div><h2>คะแนนพฤติกรรมนักเรียน</h2><p class="muted">บันทึกแบบเพิ่ม/ลดคะแนน พร้อมผู้บันทึกและประวัติย้อนหลัง</p></div>
 <div class="card stack">${filters({date:false})}<form id="behaviorForm" class="stack"><div class="field"><label>นักเรียน</label><select id="behaviorStudent" name="student_id">${state.students.map(s=>`<option value="${s.id}" ${s.id===state.studentId?'selected':''}>${s.roll_no}. ${esc(s.full_name)}</option>`).join('')}</select></div>
 <div class="field"><label>คะแนน (+ เพิ่ม / - ตัด)</label><input name="points" type="number" required min="-50" max="50" value="-5"></div><div class="field"><label>เหตุผล</label><textarea name="reason" maxlength="300" required placeholder="ระบุเหตุการณ์ที่บันทึก"></textarea></div><button class="button full" ${!state.students.length?'disabled':''}>บันทึกคะแนนพฤติกรรม</button></form></div>
 <div class="card"><div class="row between"><h3>ประวัติคะแนนนักเรียน</h3><span class="tag">ยอดรวม ${Number(state.behaviorTotal)} คะแนน</span></div>${state.behaviors.length?`<div class="table-wrap"><table class="table"><thead><tr><th>คะแนน</th><th>เหตุผล</th><th>ผู้บันทึก</th><th>เวลา</th></tr></thead><tbody>${state.behaviors.map(b=>`<tr><td>${b.points>0?'+':''}${b.points}</td><td>${esc(b.reason)}</td><td>${esc(b.teacher_name)}</td><td>${esc(b.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">ยังไม่มีประวัติ</div>'}</div></div>`);
 bindFilters(loadBehavior);
 $('#behaviorStudent')?.addEventListener('change',e=>safeRun(async()=>{state.studentId=Number(e.target.value);await loadBehavior()}));
 $('#behaviorForm').addEventListener('submit',e=>safeRun(async()=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/api/behavior',{method:'POST',body:{student_id:Number(f.get('student_id')),points:Number(f.get('points')),reason:f.get('reason')}});toast('บันทึกคะแนนสำเร็จ');await loadBehavior()}));
}
async function loadAlerts(){if(!state.roomId){mount('<div class="empty">ยังไม่มีห้องเรียนที่ได้รับสิทธิ์</div>');return}try{const data=await api('/api/alerts?classroom_id='+state.roomId);state.alerts=data.items;renderAlerts()}catch(e){mount(`<div class="card"><h2>งานตรวจสอบ</h2><p class="warn">${esc(e.message)}</p><p class="muted">หน้านี้ให้ครูที่ปรึกษาและผู้ดูแลระบบเข้าถึงได้</p></div>`)} }
function renderAlerts(){mount(`<div class="stack"><div><h2>ศูนย์ตรวจสอบการขาดเรียน</h2><p class="muted">ครูที่ปรึกษายืนยันก่อนสรุปว่าไม่มีเหตุที่ได้รับอนุญาต</p></div><div class="card stack">${filters({date:false})}
 <div class="warn">รุ่นนี้ยังไม่ส่ง Push ถึงผู้ปกครอง แม้จะกดยืนยันแล้วก็ตาม</div>
 ${state.alerts.length?state.alerts.map(a=>`<div class="alert-item"><div class="row between"><div><strong>${esc(a.full_name)}</strong><p class="muted">${esc(a.school_date)} • คาบ ${a.period} • ${esc(a.subject)}</p></div><span class="tag">รอตรวจสอบ</span></div>
 <div class="row"><button class="button secondary" data-review="${a.id}" data-state="resolved">มีเหตุ/บันทึกผิด</button><button class="button" data-review="${a.id}" data-state="confirmed">ยืนยันไม่เข้าชั้นเรียน</button></div></div>`).join(''):'<div class="empty">ไม่มีรายการรอตรวจสอบ</div>'}</div></div>`);
 bindFilters(loadAlerts);
 $$('[data-review]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{if(!confirm(button.dataset.state==='confirmed'?'ยืนยันการไม่เข้าชั้นเรียน? (รุ่นทดลองไม่มีการแจ้งผู้ปกครอง)':'ยืนยันว่ามีเหตุได้รับอนุญาตหรือบันทึกผิด?'))return;await api(`/api/alerts/${button.dataset.review}/review`,{method:'POST',body:{state:button.dataset.state}});toast('บันทึกผลการตรวจสอบแล้ว');await loadAlerts()})));
}
async function loadAdmin(){if(state.user.role!=='admin')return;const data=await api('/api/admin/users');state.users=data.items;renderAdmin();}
function teacherOptions(){return state.users.filter(u=>u.role==='teacher'&&u.active).map(u=>`<option value="${u.id}">${esc(u.display_name)} (${esc(u.username)})</option>`).join('');}
function renderAdmin(){mount(`<div class="stack"><div><h2>จัดการข้อมูลระบบ</h2><p class="muted">สำหรับผู้ดูแลระบบเท่านั้น • ใช้ข้อมูลจำลองในช่วงทดลอง</p></div>
 <div class="grid two"><section class="card stack"><h3>เพิ่มบัญชีครู/บุคลากร</h3><form id="addUser" class="stack"><div class="field"><label>ชื่อเข้าสู่ระบบ (ภาษาอังกฤษ/ตัวเลข)</label><input name="username" required minlength="3" pattern="[A-Za-z0-9._-]+"></div><div class="field"><label>ชื่อที่แสดง</label><input name="display_name" required maxlength="100"></div><div class="field"><label>รหัสผ่านชั่วคราว (อย่างน้อย 12 ตัว)</label><input name="password" type="password" required minlength="12"></div><div class="field"><label>บทบาท</label><select name="role"><option value="teacher">ครู</option><option value="staff">งานกิจการนักเรียน</option></select></div><button class="button full">สร้างบัญชี</button></form></section>
 <section class="card stack"><h3>กำหนดครูที่ปรึกษา</h3><form id="assignAdvisor" class="stack"><div class="field"><label>ห้องเรียน</label><select name="classroom_id">${state.rooms.map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select></div><div class="field"><label>ครูที่ปรึกษา</label><select name="teacher_user_id">${teacherOptions()}</select></div><button class="button full" ${!teacherOptions()?'disabled':''}>บันทึกครูที่ปรึกษา</button></form></section>
 <section class="card stack"><h3>เพิ่มตารางสอนรายคาบ</h3><form id="addSlot" class="stack"><div class="field"><label>ห้องเรียน</label><select name="classroom_id">${state.rooms.map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select></div><div class="field"><label>ครูผู้สอน</label><select name="teacher_user_id">${teacherOptions()}</select></div>
 <div class="grid two"><div class="field"><label>วันในสัปดาห์</label><select name="day_of_week">${['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'].map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select></div><div class="field"><label>คาบ</label><input type="number" name="period" min="1" max="12" value="1" required></div></div><div class="field"><label>ชื่อวิชา</label><input name="subject" placeholder="วิทยาการคำนวณ" required maxlength="120"></div><button class="button full" ${!teacherOptions()?'disabled':''}>เพิ่มคาบเรียน</button></form></section>
 <section class="card stack"><h3>นำเข้านักเรียน (CSV)</h3><form id="importStudents" class="stack"><div class="field"><label>ห้องเรียน</label><select name="classroom_id">${state.rooms.map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select></div><div class="field"><label>ข้อความ CSV (ไม่เกิน 60 คนต่อครั้ง)</label><textarea name="csv" required placeholder="roll_no,student_no,full_name&#10;1,S00001,นักเรียนตัวอย่าง หนึ่ง&#10;2,S00002,นักเรียนตัวอย่าง สอง" rows="7"></textarea></div><p class="muted">ก่อนทดลองด้วยข้อมูลจริง ต้องกำหนดสิทธิ์/ฐานกฎหมายและแจ้งผู้เกี่ยวข้องตามนโยบายโรงเรียน</p><button class="button full">นำเข้ารายชื่อ</button></form></section></div>
 <section class="card stack"><h3>ครูและบุคลากร (${state.users.length} บัญชี)</h3><div class="table-wrap"><table class="table"><thead><tr><th>ชื่อ</th><th>Username</th><th>บทบาท</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
 <tbody>${state.users.map(u=>`<tr><td>${esc(u.display_name)}</td><td>${esc(u.username)}</td><td>${esc(roles[u.role])}</td><td>${u.active?'ใช้งาน':'พักบัญชี'}</td><td>${u.role==='teacher'||u.role==='staff'?`<button type="button" class="button secondary" data-edit-user="${u.id}">แก้ไข</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>
 ${(()=>{
  const person=state.users.find(u=>u.id===adminEditUserId&&(u.role==='teacher'||u.role==='staff'));
  return person?`<form id="adminPersonnelEdit" class="stack"><h3>แก้ไข ${esc(person.username)}</h3>
   <div class="grid two"><div class="field"><label>ชื่อที่แสดง</label><input name="display_name" value="${esc(person.display_name)}" required maxlength="100"></div>
   <div class="field"><label>สถานะบัญชี</label><select name="active"><option value="1" ${person.active?'selected':''}>ใช้งาน</option><option value="0" ${person.active?'':'selected'}>ระงับการใช้งาน</option></select></div></div>
   <p class="muted">การระงับบัญชีจะยกเลิกเซสชันที่ใช้งานอยู่ของครูหรือบุคลากรคนนั้นทันที แต่ไม่ลบประวัติ</p>
   <button class="button" type="submit">บันทึกข้อมูลบุคลากร</button></form>`:'<p class="muted">กด “แก้ไข” เพื่อปรับชื่อหรือสถานะครู/บุคลากร</p>';
 })()}
 </section></div>`);
 $$('[data-edit-user]').forEach(btn=>btn.addEventListener('click',()=>{
  adminEditUserId=Number(btn.dataset.editUser);renderAdmin();
 }));
 $('#adminPersonnelEdit')?.addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();const form=e.currentTarget,person=state.users.find(u=>u.id===adminEditUserId);
  if(!person)return;
  const f=new FormData(form),active=Number(f.get('active'));
  if(!active&&!confirm(`ระงับบัญชีของ ${person.display_name} และออกจากระบบทุกอุปกรณ์?`))return;
  const button=form.querySelector('button');button.disabled=true;
  try{
   await api('/api/admin/users/'+person.id,{method:'POST',body:{display_name:String(f.get('display_name')).trim(),active}});
   adminEditUserId=null;toast('บันทึกข้อมูลบุคลากรแล้ว');await loadAdmin();
  }finally{button.disabled=false}
 }));
 const formApi=(id,path,makeBody,after=loadAdmin)=>{$('#'+id).addEventListener('submit',e=>safeRun(async()=>{e.preventDefault();const f=new FormData(e.currentTarget);await api(path,{method:'POST',body:makeBody(f)});toast('บันทึกสำเร็จ');await after()}));};
 formApi('addUser','/api/admin/users',f=>({username:f.get('username'),display_name:f.get('display_name'),password:f.get('password'),role:f.get('role')}));
 formApi('assignAdvisor','/api/admin/advisor',f=>({classroom_id:Number(f.get('classroom_id')),teacher_user_id:Number(f.get('teacher_user_id'))}));
 formApi('addSlot','/api/admin/timetable',f=>({classroom_id:Number(f.get('classroom_id')),teacher_user_id:Number(f.get('teacher_user_id')),day_of_week:Number(f.get('day_of_week')),period:Number(f.get('period')),subject:f.get('subject')}));
 formApi('importStudents','/api/admin/import-students',f=>{
  const records=parseCsv(String(f.get('csv')||'').trim());
  if(records[0]?.join(',').toLowerCase()==='roll_no,student_no,full_name')records.shift();
  return {classroom_id:Number(f.get('classroom_id')),students:records.map(r=>({roll_no:Number(r[0]),student_no:r[1],full_name:r[2]}))};
 },async()=>{referenceCache.clear();await loadAdmin()});
}

async function loadAdminStudents(){
 if(state.user?.role!=='admin')return;
 if(!state.rooms.some(r=>r.id===adminStudentState.roomId))
  adminStudentState.roomId=state.rooms[0]?.id||null;
 if(!adminStudentState.roomId){mount('<div class="empty">ยังไม่มีห้องเรียน</div>');return}
 const roomId=adminStudentState.roomId;
 try{
  const data=await api('/api/admin/students?classroom_id='+roomId);
  if(state.tab!=='adminStudents'||adminStudentState.roomId!==roomId)return;
  adminStudentState.items=data.items;
  if(!data.items.some(s=>s.id===adminStudentState.editId))adminStudentState.editId=null;
  renderAdminStudents();
 }catch(e){
  if(!state.user)return;
  mount(`<section class="card stack"><h2>จัดการนักเรียน</h2><div class="warn">API จัดการนักเรียนยังไม่พร้อมใน Worker ที่เผยแพร่อยู่ (ต้อง Deploy Worker เวอร์ชันใหม่ก่อน)</div><p class="muted">${esc(e.message)}</p></section>`);
 }
}
function studentPayload(form){
 return {classroom_id:Number(form.get('classroom_id')),roll_no:Number(form.get('roll_no')),
  student_no:String(form.get('student_no')||'').trim(),full_name:String(form.get('full_name')||'').trim(),
  active:Number(form.get('active')??1)};
}
function renderAdminStudents(){
 const items=adminStudentState.items;
 const edit=items.find(s=>s.id===adminStudentState.editId);
 const rooms=(chosen)=>state.rooms.map(r=>`<option value="${r.id}" ${r.id===chosen?'selected':''}>${esc(r.label)}</option>`).join('');
 const activeCount=items.filter(s=>s.active).length;
 const rows=items.map(s=>`<tr data-admin-student-row><td>${s.roll_no}</td><td><strong>${esc(s.full_name)}</strong><div class="muted">${esc(s.student_no)}</div></td>
   <td><span class="tag">${s.active?'ใช้งาน':'พักข้อมูล'}</span></td>
   <td><button type="button" class="button secondary" data-edit-student="${s.id}">แก้ไข</button>
   <button type="button" class="button ${s.active?'ghost':'secondary'}" data-toggle-student="${s.id}">${s.active?'พักข้อมูล':'เปิดใช้งาน'}</button></td></tr>`).join('');
 mount(`<section class="stack">
  <div><h2>จัดการข้อมูลนักเรียน</h2><p class="muted">ข้อมูลจำลอง • เพิ่ม แก้ไข เปลี่ยนห้อง และพักข้อมูลโดยไม่ลบประวัติ</p></div>
  <div class="card stack"><div class="row between"><div class="field smallbox"><label for="adminStudentRoom">ห้องเรียน</label><select id="adminStudentRoom">${rooms(adminStudentState.roomId)}</select></div>
   <div><strong>${activeCount} คน</strong><p class="muted">พักข้อมูล ${items.length-activeCount} คน</p></div></div>
   <div class="field"><label for="adminStudentSearch">ค้นหารายชื่อหรือรหัสนักเรียน</label><input id="adminStudentSearch" placeholder="พิมพ์ชื่อหรือรหัสนักเรียน" type="search"></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>เลขที่</th><th>ชื่อ–สกุล / รหัสนักเรียน</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${rows||'<tr><td colspan="4">ยังไม่มีนักเรียนในห้องนี้</td></tr>'}</tbody></table></div>
  </div>
  <div class="grid two">
   <section class="card stack"><h3>เพิ่มนักเรียน</h3><form class="stack" id="adminAddStudent">
    <div class="field"><label>ห้องเรียน</label><select name="classroom_id">${rooms(adminStudentState.roomId)}</select></div>
    <div class="field"><label>เลขประจำตัวนักเรียน</label><input name="student_no" required maxlength="40" placeholder="DEMO001"></div>
    <div class="field"><label>ชื่อ–สกุล</label><input name="full_name" required maxlength="120" placeholder="นักเรียนตัวอย่าง"></div>
    <div class="field"><label>เลขที่</label><input type="number" name="roll_no" min="1" max="100" required></div>
    <input type="hidden" name="active" value="1"><button class="button full" type="submit">เพิ่มนักเรียน</button>
   </form></section>
   <section class="card stack"><h3>${edit?'แก้ไขข้อมูลนักเรียน':'เลือกนักเรียนจากตารางเพื่อแก้ไข'}</h3>
    ${edit?`<form id="adminEditStudent" class="stack"><div class="field"><label>ห้องเรียนปัจจุบัน</label><select name="classroom_id" disabled>${rooms(edit.classroom_id)}</select><input name="classroom_id" type="hidden" value="${edit.classroom_id}"></div>
     <div class="field"><label>รหัสนักเรียน</label><input name="student_no" required maxlength="40" value="${esc(edit.student_no)}"></div>
     <div class="field"><label>ชื่อ–สกุล</label><input name="full_name" required maxlength="120" value="${esc(edit.full_name)}"></div>
     <div class="field"><label>เลขที่</label><input type="number" name="roll_no" min="1" max="100" required value="${edit.roll_no}"></div>
     <div class="field"><label>สถานะ</label><select name="active"><option value="1" ${edit.active?'selected':''}>ใช้งาน</option><option value="0" ${edit.active?'':'selected'}>พักข้อมูล</option></select></div>
     <button type="submit" class="button full">บันทึกการเปลี่ยนแปลง</button>
     <p class="muted">หากต้องการย้ายห้อง ให้ใช้ส่วน “แผนย้ายห้อง” ด้านล่างเท่านั้น เพื่อรักษาประวัติการเช็กชื่อย้อนหลัง</p>
     </form>`:'<div class="empty">เลือกปุ่ม “แก้ไข” ด้านบน</div>'}
   </section>
  </div>
  ${edit?`<section class="card stack"><h3>วางแผนย้ายห้องตามปีการศึกษา</h3>
    <p class="muted">บันทึกเป็นแผนก่อนเปิดภาคเรียน ไม่เปลี่ยนห้องปัจจุบันและไม่แก้ข้อมูลเช็กชื่อย้อนหลัง</p>
    <form id="adminTransferForm" class="stack"><div class="grid two">
     <div class="field"><label>ปีการศึกษา (พ.ศ.)</label><input name="school_year" type="number" min="2500" max="2700" value="${new Date().getUTCFullYear()+543}" required></div>
     <div class="field"><label>ภาคเรียน</label><select name="term"><option value="1">1</option><option value="2">2</option></select></div></div>
     <div class="field"><label>ห้องเรียนปลายทาง</label><select name="to_classroom_id">${state.rooms.filter(r=>r.id!==edit.classroom_id).map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select></div>
     <button class="button secondary" type="submit">บันทึกแผนย้ายห้อง</button></form>
    ${adminTransferState.studentId===edit.id&&adminTransferState.items.length?
     `<div class="table-wrap"><table class="table"><thead><tr><th>ปีการศึกษา/เทอม</th><th>ห้องเดิม → ห้องแผน</th><th>สถานะ</th><th>ยืนยัน</th></tr></thead>
       <tbody>${adminTransferState.items.map(p=>`<tr><td>${p.school_year}/${p.term}</td><td>${esc(p.from_room)} → ${esc(p.to_room)}</td><td>${p.state==='planned'?'รอยืนยัน':p.state==='applied'?'ย้ายแล้ว':'ยกเลิก'}</td>
        <td>${p.state==='planned'&&p.from_classroom_id===edit.classroom_id?
         `<button type="button" class="button secondary" data-execute-transfer="${p.id}" data-target="${esc(p.to_room)}">ย้ายวันนี้</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">ยังไม่มีแผนย้ายห้องที่บันทึกไว้</p>'}
    <div class="warn">การย้ายห้องจริงมีผลตั้งแต่วันที่ยืนยันวันนี้ หากวันนี้มีข้อมูลเช็กชื่อหรือมาสาย ระบบจะปฏิเสธการย้าย กรุณาดำเนินการก่อนเริ่มเช็กชื่อ และใช้เฉพาะข้อมูลจำลอง</div>
    <h3>ประวัติการสังกัดห้อง</h3>
    ${adminTransferState.studentId===edit.id&&adminTransferState.history.length?
      `<div class="table-wrap"><table class="table"><thead><tr><th>ห้องเรียน</th><th>เลขที่</th><th>เริ่มวันที่</th><th>สิ้นสุดก่อนวันที่</th></tr></thead>
       <tbody>${adminTransferState.history.map(h=>`<tr><td>${esc(h.classroom_label)}</td><td>${h.roll_no}</td><td>${esc(h.start_date)}</td><td>${esc(h.end_date||'ปัจจุบัน')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">ยังไม่มีประวัติเก่า</p>'}
   </section>`:''}
  <div id="unifiedImportHolder"></div>
`);
 unifiedImport.render($('#unifiedImportHolder'));
 $('#adminStudentRoom').addEventListener('change',e=>safeRun(async()=>{
  adminStudentState.roomId=Number(e.target.value);adminStudentState.editId=null;adminImportState.preview=null;adminImportState.students=[];await loadAdminStudents();
 }));
 $('#adminStudentSearch').addEventListener('input',e=>{
  const q=e.target.value.trim().toLocaleLowerCase();
  for(const row of document.querySelectorAll('[data-admin-student-row]'))row.hidden=!row.textContent.toLocaleLowerCase().includes(q);
 });
 document.querySelectorAll('[data-edit-student]').forEach(btn=>btn.addEventListener('click',()=>safeRun(async()=>{
  const id=Number(btn.dataset.editStudent);
  adminStudentState.editId=id;adminTransferState.studentId=id;adminTransferState.items=[];adminTransferState.history=[];
  try{
   const [plans,history]=await Promise.all([
     api('/api/admin/transfer-plans?student_id='+id),
     api('/api/admin/enrollments?student_id='+id)
   ]);
   if(adminStudentState.editId!==id||state.tab!=='adminStudents')return;
   adminTransferState.items=plans.items;adminTransferState.history=history.items;
  }catch(error){toast('โหลดข้อมูลการย้ายห้องไม่สำเร็จ: '+error.message,true)}
  renderAdminStudents();
 })));
 document.querySelectorAll('[data-toggle-student]').forEach(btn=>btn.addEventListener('click',()=>safeRun(async()=>{
  const st=adminStudentState.items.find(s=>s.id===Number(btn.dataset.toggleStudent));
  if(!st)return;
  if(!confirm(st.active?`พักข้อมูล ${st.full_name} โดยไม่ลบประวัติ?`:`เปิดใช้งาน ${st.full_name}?`))return;
  await api('/api/admin/students/'+st.id,{method:'POST',body:{...st,active:st.active?0:1}});
  referenceCache.clear();toast('ปรับสถานะนักเรียนแล้ว');await loadAdminStudents();
 })));
 $('#adminAddStudent').addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{await api('/api/admin/students',{method:'POST',body:studentPayload(new FormData(form))});
    referenceCache.clear();toast('เพิ่มนักเรียนสำเร็จ');await loadAdminStudents();
  }finally{button.disabled=false}
 }));
 $('#adminEditStudent')?.addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();const id=adminStudentState.editId,form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{await api('/api/admin/students/'+id,{method:'POST',body:studentPayload(new FormData(form))});
    adminStudentState.editId=null;referenceCache.clear();toast('บันทึกข้อมูลนักเรียนแล้ว');await loadAdminStudents();
  }finally{button.disabled=false}
 }));
 $('#adminTransferForm')?.addEventListener('submit',e=>safeRun(async()=>{
  e.preventDefault();
  const studentId=adminStudentState.editId,form=e.currentTarget,button=form.querySelector('button');
  const data=new FormData(form);
  if(!confirm('บันทึกแผนย้ายห้องสำหรับภาคเรียนที่เลือก? ยังไม่เปลี่ยนห้องเรียนจริง'))return;
  button.disabled=true;
  try{
   await api('/api/admin/transfer-plans',{method:'POST',body:{
    student_id:studentId,school_year:Number(data.get('school_year')),
    term:Number(data.get('term')),to_classroom_id:Number(data.get('to_classroom_id'))}});
   const plans=await api('/api/admin/transfer-plans?student_id='+studentId);
   adminTransferState.studentId=studentId;adminTransferState.items=plans.items;
   toast('บันทึกแผนย้ายห้องแล้ว (ยังไม่ย้ายจริง)');renderAdminStudents();
  }finally{if(button.isConnected)button.disabled=false}
 }));
 document.querySelectorAll('[data-execute-transfer]').forEach(btn=>btn.addEventListener('click',()=>safeRun(async()=>{
  const planId=Number(btn.dataset.executeTransfer),editId=adminStudentState.editId;
  const current=adminStudentState.items.find(s=>s.id===editId);
  if(!current)return;
  const yes=confirm(`ยืนยันย้าย ${current.full_name} ไปห้อง ${btn.dataset.target} มีผลตั้งแต่วันนี้ใช่หรือไม่?\\nหลังย้าย ข้อมูลเช็กชื่อก่อนวันนี้จะยังอยู่ห้องเดิม`);
  if(!yes)return;
  btn.disabled=true;
  try{
   const result=await api('/api/admin/transfer-plans/'+planId+'/execute',{method:'POST',body:{}});
   referenceCache.clear();adminStudentState.editId=null;
   adminTransferState.items=[];adminTransferState.history=[];
   const plan=adminTransferState.studentId===editId?
       adminStudentState.items.find(s=>s.id===editId):null;
   adminTransferState.studentId=null;
   toast('ย้ายห้องสำเร็จ เลขที่ใหม่ '+result.roll_no+' (มีผล '+result.effective_date+')');
   await loadAdminStudents();
  }finally{if(btn.isConnected)btn.disabled=false}
 })));

}

function parseCsv(csv,columns=[3]){const rows=[];let row=[],col='',quoted=false;
 for(let i=0;i<csv.length;i++){const ch=csv[i];if(ch==='"'){if(quoted&&csv[i+1]==='"'){col+='"';i++}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(col);col=''}else if((ch==='\r'||ch==='\n')&&!quoted){if(ch==='\r'&&csv[i+1]==='\n')i++;row.push(col);if(row.some(x=>x.trim()))rows.push(row);row=[];col=''}else col+=ch;}
 if(quoted)throw Error('ไฟล์ CSV มีเครื่องหมายคำพูดไม่ครบ');row.push(col);if(row.some(x=>x.trim()))rows.push(row);if(rows.some(r=>!columns.includes(r.length)))throw Error('CSV ต้องมี 3 หรือ 5 คอลัมน์ ตามไฟล์ตัวอย่าง');return rows;
}
async function start(){if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});if(portalUi.hasSession()){await portalUi.resume();return}if(!state.token){renderLogin();return}try{await boot()}catch{state.token='';sessionStorage.removeItem('rd_token');renderLogin()}}
window.addEventListener('online',()=>toast('เชื่อมต่ออินเทอร์เน็ตแล้ว'));
window.addEventListener('offline',()=>toast('ออฟไลน์: ระบบจะไม่บันทึกข้อมูลจนกว่าจะเชื่อมต่อ',true));
start();
