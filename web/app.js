import {API_BASE_URL} from './config.js';
import {runSafely} from './run-safely.js';
import {createRequestCache} from './request-cache.js';
import {createUnifiedImport} from './unified-import.js';
import {createAdvisorImport} from './advisor-import.js';
import {createAdminSettings} from './admin-settings.js';
import {createMyTimetable,periodChoices} from './my-timetable.js';
import {createLateGate} from './late-gate.js';
import {createPeriodCenter} from './period-center.js';
import {createPwaTools} from './pwa-client.js';
import {mobileMarkup,bindMobileMenu} from './mobile-nav.js';
import {createNotificationSettings} from './notification-settings.js';
import {readAuthSession,saveAuthSession,clearAuthSession,getLastLoginArea,setLastLoginArea} from './auth-session.js';
import {createPortalUi} from './portal-ui.js';
import {createPortalAdmin} from './portal-admin.js';
import {renderAttendanceCharts} from './dashboard-charts.js';
import {initTheme,bindThemeButtons} from './theme.js';
initTheme();
// Always show the emblem; retain the bundled small crest for offline/error fallback.
document.addEventListener('error',event=>{
 const img=event.target;
 if(!(img instanceof HTMLImageElement)||!img.classList.contains('rd-school-crest')||img.dataset.crestFallback)return;
 img.dataset.crestFallback='1';
 img.src='./media/ratsada-crest.webp';
},true);
const $=(selector)=>document.querySelector(selector);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const state={token:readAuthSession('rd_token'),user:null,tab:'dashboard',rooms:[],users:[],roomId:null,date:dateToday(),kind:'daily',slotId:null,slots:[],students:[],statuses:{},savedCount:0,pushFeedback:null,dailyReferences:{},teachingNote:'',teachingNoteUpdatedAt:null,stats:null,alerts:[],lates:[],selfLates:[],behaviors:[],behaviorTotal:0};
const referenceCache=createRequestCache();
const pwaTools=createPwaTools({api,toast});
const lateGate=createLateGate({api,mount,toast,safeRun});
const notificationSettings=createNotificationSettings({api,pwaTools,mount,toast,safeRun,showTab,
 getAlerts:()=>state.stats?.alerts||0});
const adminStudentState={roomId:null,items:[],editId:null};
const unifiedImport=createUnifiedImport({api,rooms:()=>state.rooms,onSuccess:async()=>{referenceCache.clear();await loadAdminStudents()}});
const advisorImporter=createAdvisorImport({api,rooms:()=>state.rooms,onSuccess:async()=>{referenceCache.clear();toast('นำเข้าครูที่ปรึกษาสำเร็จ');await loadAdmin()}});
const adminSettings=createAdminSettings({api,mount,safeRun,toast,
 getUsers:()=>state.users,getRooms:()=>state.rooms,reload:loadAdmin,
 refreshRooms:refreshClassroomList,clearStudentCache:()=>referenceCache.clear(),
 advisorImporter,parseCsv,periodChoices});
async function refreshClassroomList(){
 const result=await api('/api/classrooms');
 state.rooms=result.items;referenceCache.clear();
 if(!state.rooms.some(room=>room.id===state.roomId))state.roomId=state.rooms[0]?.id||null;
}
async function openPeriodLesson(lesson,requestedDate=null){
 if(!lesson)return;
 state.kind='period';state.slotId=lesson.id;state.roomId=lesson.classroom_id;
 const today=dateToday(), todayDow=((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)+1;
 const daysBack=(todayDow-lesson.day_of_week+7)%7;
 state.date=requestedDate||new Date(Date.parse(today+'T00:00:00Z')-daysBack*86400000).toISOString().slice(0,10);
 await showTab('periodCheckin');
}
const myTimetable=createMyTimetable({api,mount,toast,refreshRooms:refreshClassroomList,safeRun,openPeriodAttendance:lesson=>safeRun(()=>openPeriodLesson(lesson))});
const periodCenter=createPeriodCenter({api,mount,safeRun,today:dateToday,toast,
 openLesson:(lesson,lessonDate)=>safeRun(()=>openPeriodLesson(lesson,lessonDate)),
 openEditor:()=>safeRun(()=>showTab('myTimetable'))});
const adminTransferState={studentId:null,items:[],history:[]};
let adminEditUserId=null;
const names={present:'มา',absent:'ขาด',late:'สาย',leave:'ลา'};
const periodNames={...names,truancy:'หนีเรียน'};
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
  if(!response.ok){if(response.status===401&&auth){referenceCache.clear();unifiedImport.clear();advisorImporter.clear();state.token='';state.user=null;clearAuthSession('rd_token');renderLogin();}throw Error(data.error||`HTTP ${response.status}`)}
  return data;
 }catch(e){if(e.name==='AbortError')throw Error('การเชื่อมต่อล่าช้า กรุณาลองใหม่');throw e}
 finally{clearTimeout(timer)}
}
function safeRun(job){return runSafely(job,e=>toast(e?.message||String(e),true));}
function loginPage(){
 return `<div class="login-wrap"><section class="card login-card" aria-label="เข้าสู่ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา">
 <header class="login-brand">
  <span class="brand-code">RD CARE • RATSADA SCHOOL</span>
  <img class="login-crest rd-school-crest" src="https://www.ratsada.ac.th/images/symbol.png" alt="ตราโรงเรียนรัษฎา" width="200" height="185" decoding="async" fetchpriority="high">
  <h1>ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา</h1>
  <p class="brand-subtitle">ดูแล เอาใจใส่ และส่งเสริมศักยภาพผู้เรียน</p>
 </header>
 <div class="login-content">
  <div class="login-role-tabs" role="group" aria-label="ประเภทผู้เข้าใช้งาน">
   <button type="button" class="active" id="staffLoginTab" aria-pressed="true">ครู / ผู้ดูแลระบบ</button>
   <button type="button" id="portalStudentLogin" aria-pressed="false">นักเรียน / ผู้ปกครอง</button>
  </div>
  <form id="loginForm">
   <div class="field"><label for="username">ชื่อผู้ใช้งาน (Username)</label><input id="username" name="username" required autocomplete="username" maxlength="40" placeholder="กรอกชื่อผู้ใช้งาน"></div>
   <div class="field"><label for="password">รหัสผ่าน (Password)</label><input id="password" name="password" type="password" required autocomplete="current-password" placeholder="กรอกรหัสผ่าน"></div>
   <label class="remember-login"><input type="checkbox" id="rememberStaff" checked>
    <span><strong>จดจำการเข้าสู่ระบบบนอุปกรณ์นี้</strong><small>สูงสุด 30 วัน • ไม่แนะนำสำหรับคอมพิวเตอร์สาธารณะ</small></span></label>
   <button class="button full" type="submit">เข้าสู่ระบบบุคลากร</button>
  </form>
  <div class="login-links">
   <button id="portalGuardianLogin" type="button" class="button secondary">เข้าสู่ระบบผู้ปกครอง</button>
   <button id="studentLateEntry" type="button" class="button secondary">นักเรียนแจ้งมาสาย</button>
  </div>
  <div class="login-install"><button type="button" class="button secondary" id="loginInstallApp">⬇️ ติดตั้ง RD Care ลงมือถือ</button>
   <small>iPhone: ใช้ Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม</small></div>
  <div class="theme-switch-login"><button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button></div>
  <p class="login-message">Push ผู้ปกครองเปิดรับได้เฉพาะการแจ้งเหตุหนีเรียน ผ่านบัญชีที่ยืนยันและอนุญาตแล้ว</p>
 </div>
 <footer class="login-credit">พัฒนาโดย ครูยุทธนา บุญจันทร์</footer>
 </section></div>`;
}
function renderLogin(){ $('#app').innerHTML=loginPage();bindThemeButtons();$('#loginForm').addEventListener('submit',e=>safeRun(async()=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const remember=$('#rememberStaff').checked;const data=await api('/api/auth/login',{method:'POST',auth:false,body:{username:$('#username').value,password:$('#password').value,remember}});state.token=data.token;state.user=data.user;saveAuthSession('rd_token',data.token,data.expires_in,remember);setLastLoginArea('staff');await boot();toast('เข้าสู่ระบบสำเร็จ');}finally{if(button.isConnected)button.disabled=false}}));$('#studentLateEntry').addEventListener('click',renderStudentLate);$('#portalStudentLogin').addEventListener('click',()=>portalUi.showLogin('student'));$('#portalGuardianLogin').addEventListener('click',()=>portalUi.showLogin('guardian'));$('#loginInstallApp')?.addEventListener('click',()=>safeRun(()=>pwaTools.install())); }
function renderStudentLate(){
 $('#app').innerHTML=`<div class="login-wrap"><section class="card login-card">
 <header class="login-brand">
  <img class="login-crest rd-school-crest" src="https://www.ratsada.ac.th/images/symbol.png" alt="ตราโรงเรียนรัษฎา" width="200" height="185" decoding="async" fetchpriority="high">
  <h1>แจ้งมาสายด้วยตนเอง</h1>
  <p class="brand-subtitle">ต้องใช้รหัสยืนยันที่ครูเวรออกให้สำหรับนักเรียนแต่ละคน</p>
 </header>
 <div class="login-content">
 <form class="stack" id="studentLateForm">
  <div class="field"><label for="studentNumber">รหัสประจำตัวนักเรียน</label><input id="studentNumber" name="student_no" maxlength="40" required autocomplete="off" placeholder="เช่น 000123"></div>
  <div class="field"><label for="studentLateCode">รหัสยืนยันจากครูเวร</label><input id="studentLateCode" name="code" pattern="[a-fA-F0-9]{24}" maxlength="24" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="รหัส 24 ตัวอักษร"></div>
  <div class="field"><label for="studentLateReason">สาเหตุ (ไม่บังคับ)</label><textarea id="studentLateReason" name="reason" maxlength="300" placeholder="ระบุเหตุผลตามที่ต้องการแจ้ง"></textarea></div>
  <button type="submit" class="button full">ส่งคำขอให้ครูเวรตรวจสอบ</button>
 </form>
 <p id="lateSelfFeedback" class="muted" aria-live="polite">ระบบบันทึกเวลาเข้าถึงเซิร์ฟเวอร์อัตโนมัติ เมื่อครูเวรยืนยันจึงนับเป็นรายการมาสายที่ตรวจสอบแล้ว</p>
 <button type="button" class="button secondary full" id="backToStaffLogin">กลับหน้าเข้าสู่ระบบครู</button>
 <div class="theme-switch-login"><button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button></div>
 </div><footer class="login-credit">พัฒนาโดย ครูยุทธนา บุญจันทร์</footer>
 </section></div>`;
 bindThemeButtons();
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
 const requested=new URLSearchParams(location.search).get('tab');
 if(requested==='notifications'||requested==='advisorCenter'){
  history.replaceState(null,'',location.pathname);
  await showTab(requested);
 }else await showTab('dashboard');
}
function roleName(){return roles[state.user?.role]||state.user?.role;}
function chrome(content){
 const displayDate=new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric'}).format(new Date());
 const navs=[['dashboard','หน้าหลัก','🏠'],['attendance','เช็กชื่อรายวัน','📅'],['periodAttendance','เช็กชื่อรายคาบ','✅'],...(state.user?.role==='teacher'?[['myTimetable','ตารางสอนของฉัน','📚']]:[]),['advisorCenter','ศูนย์ครูที่ปรึกษา','🧑‍🏫'],['late','มาสาย','⏰'],['lateGate','QR มาสาย','📷'],['behavior','พฤติกรรม','⭐'],['alerts','ตรวจสอบขาด','🔎'],...(state.user?.role==='admin'?[['adminStudents','จัดการนักเรียน','🎓'],['portalAccounts','บัญชีผู้เรียน/ผู้ปกครอง','👥'],['admin','ครูและระบบ','⚙️']]:[])];
 const sidebar=navs.map(([id,label,ico])=>`<button type="button" class="rd-sidebar-link ${(state.tab===id||(id==='periodAttendance'&&state.tab==='periodCheckin'))?'active':''}" data-tab="${id}" title="${label}" ${state.tab===id?'aria-current="page"':''}><span class="rd-sidebar-symbol" aria-hidden="true">${ico}</span><span class="rd-sidebar-label">${label}</span></button>`).join('');
 const bottom=navs.map(([id,label,ico])=>`<button class="${(state.tab===id||(id==='periodAttendance'&&state.tab==='periodCheckin'))?'active':''}" data-tab="${id}" type="button">${ico} ${label}</button>`).join('');
 return `<main class="shell rd-shell">
 <header class="top"><div class="brand"><img class="brand-logo rd-school-crest" src="https://www.ratsada.ac.th/images/symbol.png" alt="ตราโรงเรียนรัษฎา" width="200" height="185" decoding="async"><div><h1>ระบบการดูแลและช่วยเหลือนักเรียน</h1><p>RD Care • โรงเรียนรัษฎา</p></div></div>
 <div class="rd-mobile-header-actions"><button type="button" data-tab="notifications" aria-label="ศูนย์แจ้งเตือน">♧</button>
 <button type="button" id="rdHeaderMenu" aria-label="เปิดเมนู">☰</button></div>
 <div class="user"><span class="rd-date-chip" aria-label="วันที่ปัจจุบัน">📅 ${esc(displayDate)}</span><span class="rd-user-avatar" aria-hidden="true">${esc((state.user.display_name||'ค').trim().charAt(0))}</span><div><strong>${esc(state.user.display_name)}</strong><br><span>${esc(roleName())}</span></div><button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button><button id="logout" class="button ghost" type="button">ออกจากระบบ</button></div></header>
 <div class="rd-layout" id="rdLayout">
 <aside class="rd-sidebar" aria-label="เมนูด้านข้าง"><div class="rd-sidebar-title"><div class="rd-side-brand"><img class="rd-school-crest" src="https://www.ratsada.ac.th/images/symbol.png" alt="" width="38" height="38" decoding="async"><span><strong>RD CARE</strong><small>RATSADA SCHOOL</small></span></div><button id="sidebarToggle" class="button ghost" type="button" aria-label="ย่อหรือขยายเมนูด้านข้าง" title="ย่อหรือขยายเมนูด้านข้าง">☰</button></div><p class="rd-nav-caption">เมนูหลัก</p><nav class="rd-sidebar-nav" aria-label="เมนูหลัก">${sidebar}</nav></aside>
 <div class="rd-workspace">
 ${state.user?.role==='admin'?`<section class="rd-global-search" aria-label="ค้นหานักเรียนทั้งโรงเรียน">
  <label for="rdGlobalSearch">🔎 ค้นหานักเรียนทั้งโรงเรียน</label>
  <input id="rdGlobalSearch" type="search" autocomplete="off" maxlength="60" placeholder="ค้นหาชื่อ รหัสนักเรียน หรือห้อง (อย่างน้อย 2 ตัว)">
  <div id="rdSearchFeedback" class="muted" role="status" aria-live="polite">ค้นหารายชื่อนักเรียนทุกห้องเรียน • เฉพาะผู้ดูแลระบบ</div>
  <div id="rdSearchResults" class="rd-search-results" role="list" hidden></div>
 </section>`:''}
 <nav class="nav" aria-label="เมนูหลักบนมือถือ">${bottom}</nav>
 ${content}
 </div>
 </div>${mobileMarkup({navs,user:state.user,active:id=>state.tab===id||(id==='periodAttendance'&&state.tab==='periodCheckin'),pending:Number(state.stats?.alerts||0)})}
 <footer class="foot">RD Care • ระบบเช็กชื่อและดูแลช่วยเหลือนักเรียน • Push ผู้ปกครองต้องเปิดรับด้วยตนเอง</footer></main>`;
}
function mount(content){
 $('#app').innerHTML=chrome(content);
 bindThemeButtons();
 $$('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>safeRun(()=>showTab(btn.dataset.tab))));
 $('#logout').addEventListener('click',()=>safeRun(logout));
 bindMobileMenu({install:()=>pwaTools.install(),logout,safeRun});
 const layout=$('#rdLayout');
 try{if(sessionStorage.getItem('rd_sidebar_collapsed')==='1')layout?.classList.add('sidebar-collapsed')}catch{}
 $('#sidebarToggle')?.addEventListener('click',()=>{
  layout.classList.toggle('sidebar-collapsed');
  const closed=layout.classList.contains('sidebar-collapsed');
  $('#sidebarToggle').setAttribute('aria-label',closed?'ขยายเมนูด้านข้าง':'ย่อเมนูด้านข้าง');
  try{sessionStorage.setItem('rd_sidebar_collapsed',closed?'1':'0')}catch{}
 });
 bindGlobalStudentSearch();
}
function bindGlobalStudentSearch(){
 const input=$('#rdGlobalSearch'),results=$('#rdSearchResults'),feedback=$('#rdSearchFeedback');
 if(!input||!results||!feedback)return;
 let timer=null,seq=0;
 input.addEventListener('input',()=>{
  clearTimeout(timer);const current=++seq,q=input.value.trim();
  results.hidden=true;results.replaceChildren();
  if(q.length<2){feedback.textContent='พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาทั้งโรงเรียน';return}
  feedback.textContent='กำลังค้นหา...';
  timer=setTimeout(async()=>{
   try{
    const response=await api('/api/admin/student-search?q='+encodeURIComponent(q));
    if(current!==seq||!input.isConnected||state.user?.role!=='admin')return;
    results.innerHTML=response.items.map(s=>`<button class="rd-search-result" type="button" role="listitem"
       data-search-student="${Number(s.id)}" data-search-room="${Number(s.classroom_id)}">
      <span class="rd-search-result-name">${esc(s.full_name)}</span>
      <span class="muted">${esc(s.student_no)} • ${esc(s.classroom_label)} • เลขที่ ${Number(s.roll_no)}${s.active?'':' • พักข้อมูล'}</span>
     </button>`).join('');
    results.hidden=response.items.length===0;
    feedback.textContent=response.items.length?'พบ ${response.items.length} รายการ (แสดงสูงสุด 20 รายการ)':'ไม่พบรายชื่อที่ตรงกับคำค้น';
   }catch(e){
    if(current!==seq||!input.isConnected)return;
    feedback.textContent=e.message;results.hidden=true;
   }
  },270);
 });
 results.addEventListener('click',e=>{
  const button=e.target.closest('[data-search-student]');
  if(!button||!results.contains(button))return;
  seq++;clearTimeout(timer);
  adminStudentState.roomId=Number(button.dataset.searchRoom);
  adminStudentState.editId=Number(button.dataset.searchStudent);
  safeRun(async()=>{
   await showTab('adminStudents');
   $('#adminEditStudent')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
 });
}
function $$(sel){return [...document.querySelectorAll(sel)]}
async function logout(){try{await pwaTools.disable({silent:true})}catch{}try{await api('/api/auth/logout',{method:'POST'})}catch{}unifiedImport.clear();advisorImporter.clear();referenceCache.clear();state.token='';state.user=null;clearAuthSession('rd_token');renderLogin();}
function roomOptions(advisorOnly=false){
 const rooms=advisorOnly&&state.user?.role==='teacher'?
  state.rooms.filter(r=>r.advisor_user_id===state.user.id):state.rooms;
 return rooms.map(r=>`<option value="${r.id}" ${r.id===state.roomId?'selected':''}>${esc(r.label)}</option>`).join('');
}
function filters({date=true,advisorOnly=false}={}){return `<div class="row"><div class="field smallbox"><label for="room">ห้องเรียน</label><select id="room">${roomOptions(advisorOnly)}</select></div>${date?`<div class="field smallbox"><label for="day">วันที่</label><input id="day" type="date" value="${state.date}" max="${dateToday()}"></div>`:''}</div>`;}
function bindFilters(onChange){$('#room')?.addEventListener('change',e=>safeRun(async()=>{state.roomId=Number(e.target.value);state.slotId=null;await onChange()}));$('#day')?.addEventListener('change',e=>safeRun(async()=>{state.date=e.target.value;state.slotId=null;await onChange()}));}
async function showTab(tab){if(tab!=='lateGate')lateGate.destroy();state.tab=tab;
 if(tab==='attendance')state.kind='daily';
 if(tab==='periodAttendance'||tab==='periodCheckin')state.kind='period';
 if(tab!=='adminStudents')unifiedImport.clear();
 if(tab!=='admin')advisorImporter.clear();
 if(tab==='dashboard')return loadDashboard();
 if(tab==='notifications')return notificationSettings.load();
 if(tab==='attendance'||tab==='periodCheckin')return loadAttendance();
 if(tab==='periodAttendance')return state.user?.role==='teacher'?periodCenter.load():loadAttendance();
 if(tab==='myTimetable')return myTimetable.load();
 if(tab==='advisorCenter')return loadAdvisorCenter();
 if(tab==='late')return loadLate();
 if(tab==='lateGate')return lateGate.load();
 if(tab==='behavior')return loadBehavior();
 if(tab==='alerts')return loadAlerts();
 if(tab==='admin')return loadAdmin();
 if(tab==='adminStudents')return loadAdminStudents();
 if(tab==='portalAccounts')return createPortalAdmin({api,mount,toast,rooms:state.rooms,safeRun}).load();
}
async function loadDashboard(){
 state.stats=await api('/api/dashboard?date='+encodeURIComponent(state.date));
 renderDashboard();
}
function renderDashboard(){
 const s=state.stats||{};
 const count=n=>Number(n||0).toLocaleString('th-TH');
 const metrics=[
  ['ห้องเรียน',s.rooms,'🏫','stat-violet'],
  ['นักเรียน',s.students,'🎓','stat-cyan'],
  ['เช็กชื่อประจำวัน',s.daily,'📝','stat-blue'],
  ['เช็กชื่อรายคาบ',s.period,'📚','stat-green'],
  ['พบขาดรายคาบ',s.absent_period,'🔎','stat-rose'],
  ['รอตรวจสอบ',s.alerts,'📌','stat-amber'],
  ['รายการมาสาย',s.late,'⏰','stat-indigo']
 ];
 const actions=[
  ['attendance','📅','เช็กชื่อรายวัน','สำหรับครูที่ปรึกษา','quick-purple'],
  ['periodAttendance','✅','เช็กชื่อรายคาบ','สำหรับครูผู้สอน','quick-teal'],
  ...(state.user?.role==='teacher'?[['myTimetable','📚','ตารางสอนของฉัน','สร้างตารางสอนรายสัปดาห์','quick-blue']]:[]),
  ['advisorCenter','🧑‍🏫','ศูนย์ครูที่ปรึกษา','ตรวจสอบงานขาดเรียน','quick-purple'],
  ['late','⏰','มาสาย','ตรวจสอบรายการมาสาย','quick-teal'],
  ['behavior','⭐','พฤติกรรม','บันทึกและตรวจสอบ','quick-orange'],
  ['alerts','🔔','ตรวจสอบขาด','รายการรอครูตรวจสอบ','quick-pink'],
  ...(state.user?.role==='admin'?[['adminStudents','🎓','จัดการนักเรียน','นำเข้าและแก้ไขข้อมูล','quick-blue']]:[])
 ];
 mount(`<section class="stack">
  <div class="dashboard-hero">
   <div class="rd-hero-greeting"><span class="rd-hero-avatar" aria-hidden="true">👤</span>
    <div><span class="hero-chip">✦ RD Care • Smart Student Care</span>
     <h2>ยินดีต้อนรับ ${esc(state.user.display_name)}</h2>
     <p>ภาพรวมการดูแลช่วยเหลือนักเรียน • วันที่ ${esc(state.date)}</p></div></div>
   <button class="button" type="button" id="refreshDashboard">↻ ดูข้อมูลล่าสุด</button>
  </div>
  <h3 class="dashboard-section-title">🌈 แอปพลิเคชัน (Smart Apps)</h3>
  <div class="card smart-apps-card"><div class="grid quick-actions">${actions.map(([tab,icon,title,desc,tone])=>
   `<button type="button" class="quick-action ${tone}" data-quick-tab="${tab}" title="${desc}" aria-label="${title}: ${desc}">
     <span class="quick-symbol" aria-hidden="true">${icon}</span>
     <span class="quick-text"><strong>${title}</strong><small>${desc}</small></span>
    </button>`).join('')}</div></div>
  <div class="card">${filters()}</div>
  <h3 class="dashboard-section-title">📊 สถิติภาพรวม</h3>
  <div class="grid four">${metrics.slice(0,4).map(([name,value,icon,tone])=>
   `<div class="card stats ${tone}"><span class="stat-icon" aria-hidden="true">${icon}</span><small>${name}</small><strong>${count(value)}</strong></div>`).join('')}</div>
  <div class="grid three">${metrics.slice(4).map(([name,value,icon,tone])=>
   `<div class="card stats ${tone}"><span class="stat-icon" aria-hidden="true">${icon}</span><small>${name}</small><strong>${count(value)}</strong></div>`).join('')}</div>
  <h3 class="dashboard-section-title">📈 กราฟการมาเรียน</h3>
  ${renderAttendanceCharts(s)}
  <div class="warn">การขาดรายคาบหมายถึง “ไม่พบการเข้าชั้นเรียน” ยังไม่ใช่ข้อสรุปว่านักเรียนหนีเรียน ต้องให้ครูที่ปรึกษาตรวจสอบก่อน</div>
 </section>`);
 bindFilters(loadDashboard);
 $('#refreshDashboard')?.addEventListener('click',()=>safeRun(async()=>{
  const button=$('#refreshDashboard');button.disabled=true;
  try{state.date=dateToday();await loadDashboard();toast('อัปเดตข้อมูลล่าสุดแล้ว')}
  finally{if(button.isConnected)button.disabled=false}
 }));
 $$('[data-quick-tab]').forEach(button=>button.addEventListener('click',()=>safeRun(()=>showTab(button.dataset.quickTab))));
}
async function loadAttendance(){
 const kind=state.kind,tab=state.tab,date=state.date;
 let roomId=state.roomId;
 if(kind==='daily'){
  const eligible=state.rooms.filter(r=>state.user?.role!=='teacher'||r.advisor_user_id===state.user?.id);
  if(!eligible.length){
   mount('<section class="card stack"><h2>เช็กชื่อรายวัน</h2><p class="warn">ยังไม่ได้รับมอบหมายเป็นครูที่ปรึกษา จึงยังไม่สามารถเช็กชื่อรายวันได้ แต่สามารถสร้างตารางสอนและเช็กชื่อรายคาบของห้องที่สอนได้</p></section>');
   return;
  }
  if(!eligible.some(r=>r.id===roomId))roomId=eligible[0].id;
  state.roomId=roomId;state.slots=[];
 }else{
  const response=await api('/api/timetable?date='+encodeURIComponent(date)+(state.user?.role==='teacher'?'&scope=mine':''));
  if(state.tab!==tab||state.date!==date)return;
  state.slots=response.items;
  let slot=state.slots.find(r=>r.id===state.slotId);
  if(!slot){slot=state.slots[0];state.slotId=slot?.id||null;}
  if(!slot){
   mount(`<section class="stack"><h2>เช็กชื่อรายคาบ</h2>
    <div class="card stack"><div class="field"><label for="periodDay">วันที่สอน</label><input id="periodDay" type="date" max="${dateToday()}" value="${esc(date)}"></div>
    <p class="warn">วันนี้ยังไม่มีคาบสอนตามตารางของคุณ ${state.user?.role==='teacher'?'กรุณาสร้างตารางสอนของตนเอง หรือเลือกวันที่มีคาบสอน':'กรุณาเลือกวันที่มีตารางสอน'}</p>
    ${state.user?.role==='teacher'?'<button class="button" data-tab="myTimetable" type="button">+ สร้างตารางสอนของฉัน</button>':''}</div></section>`);
   $('#periodDay')?.addEventListener('change',e=>safeRun(async()=>{state.date=e.target.value;state.slotId=null;await loadAttendance()}));
   return;
  }
  roomId=slot.classroom_id;state.roomId=roomId;
 }
 const studentsResponse=await referenceCache.get('students:'+roomId+':'+date,()=>api('/api/students?classroom_id='+roomId+'&date='+encodeURIComponent(date)));
 if(state.tab!==tab||state.date!==date||state.kind!==kind||state.roomId!==roomId)return;
 state.students=studentsResponse.items;
 const slotId=kind==='period'?state.slotId:null;
 const q='?kind='+kind+'&classroom_id='+roomId+'&date='+encodeURIComponent(date)+(kind==='period'?'&timetable_id='+slotId:'');
 const attendanceData=await api('/api/attendance'+q);
 const entries=attendanceData.items;
 if(state.tab!==tab||state.date!==date||state.kind!==kind||state.roomId!==roomId||(kind==='period'&&state.slotId!==slotId))return;
 state.savedCount=entries.length;
 // Keep the daily register independent of this period's editable status.
 // An absent daily record is not proof of absence in every later period.
 state.dailyReferences=kind==='period'
  ?Object.fromEntries((attendanceData.daily_items||[])
    .filter(item=>['present','absent','late','leave'].includes(item.status))
    .map(item=>[item.student_id,item.status]))
  :{};
 state.teachingNote=kind==='period'?attendanceData.teaching_note||'':'';
 state.teachingNoteUpdatedAt=kind==='period'?attendanceData.teaching_note_updated_at||null:null;
 state.statuses=Object.fromEntries(state.students.map(x=>[x.id,'present']));
 for(const entry of entries)state.statuses[entry.student_id]=entry.status;
 renderAttendance();
}
function statusCounts(){return Object.fromEntries(Object.keys(state.kind==='period'?periodNames:names)
 .map(status=>[status,Object.values(state.statuses).filter(x=>x===status).length]));}
function statusSummary(){const c=statusCounts();
 return `มา ${c.present} • ขาด ${c.absent} • สาย ${c.late} • ลา ${c.leave}`+
 (state.kind==='period'?` • หนีเรียน ${c.truancy}`:'');
}

function dailyReferenceStatus(studentId){
 const recorded=state.dailyReferences[studentId];
 return ['present','absent','late','leave'].includes(recorded)?recorded:'unrecorded';
}
function dailyReferenceCounts(){
 const counts={present:0,absent:0,late:0,leave:0,unrecorded:0};
 for(const student of state.students)counts[dailyReferenceStatus(student.id)]++;
 return counts;
}
function renderDailyOverview(){
 const c=dailyReferenceCounts();
 const focus=state.students.filter(student=>['absent','leave'].includes(dailyReferenceStatus(student.id)));
 const tiles=[['present','มา','✅'],['absent','ขาด','🔴'],['leave','ลา','🔵'],['late','สาย','🟠'],['unrecorded','ยังไม่บันทึก','⚪']];
 return `<section class="daily-class-overview" aria-label="สถานะเช็กชื่อรายวันจากครูที่ปรึกษา">
   <div class="daily-overview-heading"><div><h3>📋 เช็กชื่อรายวันของห้อง • ${esc(state.date)}</h3>
   <p>ข้อมูลจากครูที่ปรึกษา ใช้ดูประกอบการเช็กชื่อรายคาบเท่านั้น ไม่ปรับสถานะรายคาบอัตโนมัติ</p></div>
   <span class="daily-reference-readonly">ดูข้อมูลอย่างเดียว</span></div>
   <div class="daily-overview-stats">${tiles.map(([status,label,icon])=>
    `<div class="daily-overview-stat daily-ref-${status}"><span aria-hidden="true">${icon}</span>
      <strong>${c[status].toLocaleString('th-TH')}</strong><small>${label}</small></div>`).join('')}</div>
   ${focus.length?`<div class="daily-watch"><strong>ควรตรวจสอบก่อนเช็กชื่อรายคาบ (${focus.length} คน)</strong>
     <div class="daily-watch-students">${focus.map(student=>
       `<span class="daily-watch-person daily-ref-${dailyReferenceStatus(student.id)}">${esc(student.roll_no)}. ${esc(student.full_name)} — ${names[dailyReferenceStatus(student.id)]}</span>`).join('')}</div></div>`:
     '<p class="daily-watch-empty">ยังไม่มีนักเรียนที่ถูกบันทึกว่า “ขาด” หรือ “ลา” ในข้อมูลรายวันของวันที่เลือก</p>'}
   <p class="daily-reference-hint">นักเรียนที่บันทึกว่า “ขาด” รายวันแล้ว หากเช็กขาดรายคาบอีกจะไม่สร้างรายการแจ้งเตือนครูที่ปรึกษาซ้ำ แต่ยังเก็บผลรายคาบไว้ • สถานะรายวันไม่ได้ยืนยันการเข้าเรียนทุกคาบ</p>
 </section>`;
}
function renderAttendance(){
 const daily=state.kind==='daily';
 const eligible=state.rooms.filter(r=>state.user?.role!=='teacher'||r.advisor_user_id===state.user?.id);
 const roomSelect=eligible.map(r=>`<option value="${r.id}" ${r.id===state.roomId?'selected':''}>${esc(r.label)}</option>`).join('');
 const slotOptions=state.slots.map(t=>{
  const period=Number(t.end_period||t.period)===t.period?t.period:t.period+'-'+t.end_period;
  return `<option value="${t.id}" ${t.id===state.slotId?'selected':''}>คาบ ${period} • ${esc(t.classroom_label)} • ${esc(t.subject_code||'')}${t.subject_code?' / ':''}${esc(t.subject)}${state.user?.role==='teacher'?'':' ('+esc(t.teacher_name)+')'}</option>`;
 }).join('');
 const students=state.students.map(s=>`<div class="student" data-id="${s.id}"><div><div class="student-name">${s.roll_no}. ${esc(s.full_name)}</div><div class="student-sub">รหัส ${esc(s.student_no)}</div>
 ${!daily?`<span class="daily-student-badge daily-ref-${dailyReferenceStatus(s.id)}" aria-label="สถานะเช็กชื่อรายวัน: ${dailyReferenceStatus(s.id)==='unrecorded'?'ยังไม่บันทึก':names[dailyReferenceStatus(s.id)]}">รายวัน: ${dailyReferenceStatus(s.id)==='unrecorded'?'ยังไม่บันทึก':names[dailyReferenceStatus(s.id)]}</span>`:''}</div><div class="pills">${Object.keys(daily?names:periodNames).map(status=>`<button type="button" data-student="${s.id}" data-status="${status}" class="pill ${state.statuses[s.id]===status?status:''}" aria-pressed="${state.statuses[s.id]===status}">${(daily?names:periodNames)[status]}</button>`).join('')}</div></div>`).join('');
 mount(`<section class="stack">${!daily&&state.user?.role==='teacher'?'<div class="period-return"><button type="button" class="button ghost" data-tab="periodAttendance">← กลับตารางสอนรายสัปดาห์</button></div>':''}
 <div><h2>${daily?'📅 เช็กชื่อรายวัน':'✅ เช็กชื่อรายคาบ'}</h2>
  <p class="muted">${daily?'สำหรับครูที่ปรึกษา • เช็กชื่อห้องที่รับผิดชอบ':'สำหรับครูผู้สอน • เลือกวิชาจากตารางสอนของตนเองได้ แม้จะไม่ใช่ครูที่ปรึกษาของห้อง'}</p></div>
 <div class="card stack">
 ${daily?`<div class="row"><div class="field smallbox"><label for="room">ห้องที่รับผิดชอบ</label><select id="room">${roomSelect}</select></div>
 <div class="field smallbox"><label for="day">วันที่</label><input id="day" type="date" max="${dateToday()}" value="${esc(state.date)}"></div></div>`:
 `<div class="field"><label for="periodDay">วันที่สอน</label><input id="periodDay" type="date" max="${dateToday()}" value="${esc(state.date)}"></div>
 <div class="field"><label for="slot">รายวิชาและคาบเรียน</label><select id="slot">${slotOptions}</select></div>
 ${state.user?.role==='teacher'?'<button type="button" class="button secondary" data-tab="myTimetable">📚 จัดการตารางสอนของฉัน</button>':''}`}
 </div><div class="card stack">
 ${!daily?renderDailyOverview():''}
 ${!daily?'<p class="warn">🚨 เมื่อบันทึก “หนีเรียน” ระบบจะตรวจอุปกรณ์ของครูที่ปรึกษาและผู้ปกครองที่เปิดรับ Push แล้ว และแสดงผลตรวจสอบหลังบันทึก • การแก้ไขย้อนหลังจะส่งเหตุที่เพิ่งแก้ภายในช่วง 14 วันที่อนุญาต โปรดตรวจสอบก่อนยืนยัน</p>':''}
 ${!daily&&state.pushFeedback?`<div class="${state.pushFeedback.ready&&state.pushFeedback.reason==='queued'?'ok':'warn'}" role="status">
 <strong>ผลการแจ้งเตือนหนีเรียนล่าสุด</strong> • ${Number(state.pushFeedback.events)||0} รายการ
 <p>${state.pushFeedback.reason==='missing_vapid'?'ยังส่ง Push ไม่ได้ เพราะเซิร์ฟเวอร์ตั้งค่า VAPID ไม่ครบ':
 state.pushFeedback.reason==='no_subscribers'?'บันทึกหนีเรียนแล้ว แต่ยังไม่มีอุปกรณ์ของครูที่ปรึกษาหรือผู้ปกครองสมัครรับ Push':
 state.pushFeedback.reason==='queued'?`กำลังนำส่ง Push ไปยังอุปกรณ์ที่สมัครรับแล้ว • ครูที่ปรึกษา ${Number(state.pushFeedback.advisorDevices)||0} เครื่อง • ผู้ปกครอง ${Number(state.pushFeedback.guardianDevices)||0} เครื่อง (ไม่ใช่หลักฐานว่าส่งถึงมือถือแล้ว)`:
 'บันทึกแล้ว แต่ยังตรวจสอบการนำส่ง Push ไม่ได้ กรุณาดูหน้าตรวจสอบการแจ้งเตือน'}</p>
 </div>`:''}
 <div class="row between"><div><h3>รายชื่อนักเรียน (${state.students.length} คน)</h3><span class="muted" id="counts">${statusSummary()}</span></div><button id="markAll" class="button ghost" type="button">เลือกมาทั้งหมด</button></div>
 ${state.savedCount?`<div class="ok">มีข้อมูลบันทึกแล้ว ${state.savedCount} คน • การบันทึกซ้ำจะปรับสถานะล่าสุด</div>`:'<div class="warn">ข้อมูลเบื้องต้นแสดง “มา” ทุกคน ต้องตรวจสอบด้วยตัวเองก่อนบันทึก</div>'}
 <div class="attendance-list">${students||'<div class="empty">ยังไม่มีนักเรียนในห้องนี้</div>'}</div>
 ${!daily?`<section class="teaching-note-card" aria-label="บันทึกการสอนรายคาบ"><div class="teaching-note-heading">
  <div><h3>📝 บันทึกการสอน <span class="teaching-note-optional">(ไม่บังคับ)</span></h3>
   <p class="muted">หัวข้อหรือเนื้อหาที่สอน กิจกรรมการเรียนรู้ ปัญหาหรือข้อเสนอแนะของคาบนี้</p></div>
   ${state.teachingNoteUpdatedAt?'<span class="tag">มีบันทึกแล้ว</span>':''}
  </div>
  <label class="teaching-note-label" for="teachingNote">รายละเอียดการสอน (เว้นว่างได้)</label>
  <textarea id="teachingNote" rows="4" maxlength="2000" placeholder="ตัวอย่าง: เรื่อง การเขียนโปรแกรมด้วยเงื่อนไข ทดลองทำใบงานและฝึกปฏิบัติ...">${esc(state.teachingNote)}</textarea>
  <div class="teaching-note-foot"><span>บันทึกแยกตามวันที่ วิชา และคาบเรียน สามารถกลับมาแก้ไขได้</span><span id="teachingNoteCount">${state.teachingNote.length.toLocaleString('th-TH')} / 2,000</span></div>
 </section>`:''}
 <button id="saveAttendance" class="button full" ${!state.students.length||!daily&&!state.slotId?'disabled':''}>✓ ยืนยันและบันทึกทั้งห้อง</button></div></section>`);
 if(daily)bindFilters(loadAttendance);
 $('#periodDay')?.addEventListener('change',e=>safeRun(async()=>{state.date=e.target.value;state.slotId=null;await loadAttendance()}));
 $('#slot')?.addEventListener('change',e=>safeRun(async()=>{state.slotId=Number(e.target.value)||null;await loadAttendance()}));
 $$('[data-student]').forEach(btn=>btn.addEventListener('click',()=>{state.statuses[Number(btn.dataset.student)]=btn.dataset.status;updateAttendanceControls()}));
 $('#markAll')?.addEventListener('click',()=>{for(const student of state.students)state.statuses[student.id]='present';updateAttendanceControls()});
 $('#teachingNote')?.addEventListener('input',event=>{
  state.teachingNote=event.target.value;
  const count=$('#teachingNoteCount');if(count)count.textContent=state.teachingNote.length.toLocaleString('th-TH')+' / 2,000';
 });
 $('#saveAttendance')?.addEventListener('click',()=>safeRun(saveAttendance));
}
function updateAttendanceControls(){for(const el of $$('[data-student]')){const chosen=state.statuses[Number(el.dataset.student)]===el.dataset.status;el.className='pill '+(chosen?el.dataset.status:'');el.setAttribute('aria-pressed',chosen)}$('#counts').textContent=statusSummary();}
async function saveAttendance(){
 if(!state.students.length)return;
 if(state.kind==='period'&&Object.values(state.statuses).includes('truancy')&&!confirm(
  'ยืนยันการบันทึกสถานะหนีเรียน? ระบบจะส่งแจ้งเตือนถึงครูที่ปรึกษาและผู้ปกครองที่เปิดรับ Push หลังบันทึก'
 ))return;
 const button=$('#saveAttendance');button.disabled=true;
 try{
  const body={kind:state.kind,date:state.date,classroom_id:state.roomId,
   timetable_id:state.kind==='period'?state.slotId:null,
   entries:state.students.map(s=>({student_id:s.id,status:state.statuses[s.id]}))};
  if(state.kind==='period')body.teaching_note=state.teachingNote;
  const result=await api('/api/attendance',{method:'POST',body});
  state.pushFeedback=state.kind==='period'?result.push||null:null;
  toast('บันทึกสำเร็จ '+result.saved+' คน'+(result.push?.reason==='no_subscribers'?' • ยังไม่มีอุปกรณ์รับ Push':''));
  await loadAttendance();
 }finally{if(button.isConnected)button.disabled=false}
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
async function loadAdvisorCenter(){
 const advisory=state.rooms.filter(r=>state.user?.role!=='teacher'||r.advisor_user_id===state.user?.id);
 if(!advisory.length){
  mount('<section class="card stack"><h2>🧑‍🏫 ศูนย์งานครูที่ปรึกษา</h2><p class="warn">ยังไม่มีห้องที่ได้รับมอบหมายเป็นครูที่ปรึกษา สามารถติดต่อผู้ดูแลระบบเพื่อผูกห้องเรียนได้</p></section>');
  return;
 }
 if(!advisory.some(r=>r.id===state.roomId))state.roomId=advisory[0].id;
 const selected=state.roomId;
 const [data,urgent]=await Promise.all([
  api('/api/alerts?classroom_id='+selected),
  api('/api/truancy/advisor')
 ]);
 if(state.tab!=='advisorCenter'||state.roomId!==selected)return;
 const items=data.items;
 const truancy=(urgent.items||[]).filter(e=>Number(e.classroom_id)===selected);
 mount(`<section class="stack"><div><h2>🧑‍🏫 ศูนย์งานครูที่ปรึกษา</h2><p class="muted">รับรายการไม่เข้าคาบจากครูผู้สอน และยืนยันผลก่อนบันทึกเหตุการณ์แจ้งผู้ปกครอง</p></div>
 <section class="card stack"><div class="row between"><div class="field smallbox"><label for="advisorRoom">ห้องที่รับผิดชอบ</label>
 <select id="advisorRoom">${advisory.map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${esc(r.label)}</option>`).join('')}</select></div>
 <strong>รอตรวจสอบ ${items.length} รายการ</strong></div>
 <div class="row"><button class="button secondary" data-tab="attendance" type="button">📅 เช็กชื่อรายวัน</button><button class="button secondary" data-tab="alerts" type="button">🔎 ตรวจสอบการขาดเรียน</button></div></section>
 <section class="card stack"><h3>🚨 รายการหนีเรียนที่ครูบันทึก</h3>
 <p class="muted">แสดงเหตุการณ์จากครูผู้สอนที่แจ้งทันที แม้นักเรียนขาดรายวันแล้ว • ตรวจสอบข้อเท็จจริงและประสานผู้ปกครอง</p>
 ${truancy.length?truancy.map(e=>`<div class="alert-item">
  <strong>${esc(e.full_name)}</strong><p class="muted">${esc(e.school_date)} • คาบ ${esc(e.period)} • ${esc(e.subject)}</p>
  <span class="tag">หนีเรียน — ระบบจะส่ง Push ไปยังอุปกรณ์ที่เปิดรับและพร้อมใช้งาน</span>
 </div>`).join(''):'<p class="muted">ไม่มีรายการหนีเรียนที่กำลังใช้งานใน 30 วันที่ผ่านมา</p>'}</section>
 <section class="card stack"><h3>รายการรอการพิจารณา (ขาดรายคาบปกติ)</h3>
 ${items.length?items.map(a=>`<div class="alert-item"><div class="row between"><div><strong>${esc(a.full_name)}</strong>
 <p class="muted">${esc(a.school_date)} • คาบ ${a.period} • ${esc(a.subject)}</p></div><span class="tag">รอตรวจสอบ</span></div>
 <div class="row"><button class="button secondary" data-advisor-review="${a.id}" data-state="resolved" type="button">มีเหตุได้รับอนุญาต/บันทึกผิด</button><button class="button" data-advisor-review="${a.id}" data-state="confirmed" type="button">ยืนยันไม่เข้าคาบ</button></div></div>`).join(''):'<div class="empty">ไม่มีรายการที่รอการตรวจสอบ</div>'}</section>
 <p class="muted">แจ้งผู้ปกครองผ่าน Push เฉพาะเหตุหนีเรียนและอุปกรณ์ที่สมัครรับแล้ว</p></section>`);
 $('#advisorRoom')?.addEventListener('change',e=>safeRun(async()=>{state.roomId=Number(e.target.value);await loadAdvisorCenter()}));
 $$('[data-advisor-review]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
  if(!confirm(button.dataset.state==='confirmed'?'ยืนยันว่าไม่เข้าคาบเรียน?':'ยืนยันว่ามีเหตุได้รับอนุญาตหรือบันทึกผิด?'))return;
  button.disabled=true;
  try{
   await api('/api/alerts/'+Number(button.dataset.advisorReview)+'/review',{method:'POST',body:{state:button.dataset.state}});
   toast('บันทึกผลการตรวจสอบแล้ว');await loadAdvisorCenter();
  }finally{if(button.isConnected)button.disabled=false}
 })));
}
async function loadAlerts(){
 const allowed=state.user?.role==='teacher'?
   state.rooms.filter(r=>r.advisor_user_id===state.user.id):state.rooms;
 if(!allowed.length){
  mount('<section class="card stack"><h2>ศูนย์ตรวจสอบการขาดเรียน</h2><p class="muted">บัญชีนี้ยังไม่ได้รับมอบหมายเป็นครูที่ปรึกษา จึงไม่มีรายการตรวจสอบในส่วนนี้</p></section>');
  return;
 }
 if(!allowed.some(r=>r.id===state.roomId))state.roomId=allowed[0].id;
 const selected=state.roomId;
 try{
  const data=await api('/api/alerts?classroom_id='+selected);
  if(state.tab!=='alerts'||state.roomId!==selected)return;
  state.alerts=data.items;renderAlerts();
 }catch(e){mount(`<div class="card"><h2>งานตรวจสอบ</h2><p class="warn">${esc(e.message)}</p><p class="muted">หน้านี้ให้ครูที่ปรึกษาและผู้ดูแลระบบเข้าถึงได้</p></div>`)}
}
function renderAlerts(){mount(`<div class="stack"><div><h2>ศูนย์ตรวจสอบการขาดเรียน</h2><p class="muted">ครูที่ปรึกษายืนยันก่อนสรุปว่าไม่มีเหตุที่ได้รับอนุญาต</p></div><div class="card stack">${filters({date:false,advisorOnly:true})}
 <div class="warn">นักเรียนที่ขาดรายวันแล้วจะไม่ถูกแจ้งขาดรายคาบซ้ำ • รายการขาดปกติจะไม่ส่ง Push ถึงผู้ปกครอง</div>
 ${state.alerts.length?state.alerts.map(a=>`<div class="alert-item"><div class="row between"><div><strong>${esc(a.full_name)}</strong><p class="muted">${esc(a.school_date)} • คาบ ${a.period} • ${esc(a.subject)}</p></div><span class="tag">รอตรวจสอบ</span></div>
 <div class="row"><button class="button secondary" data-review="${a.id}" data-state="resolved">มีเหตุ/บันทึกผิด</button><button class="button" data-review="${a.id}" data-state="confirmed">ยืนยันไม่เข้าชั้นเรียน</button></div></div>`).join(''):'<div class="empty">ไม่มีรายการรอตรวจสอบ</div>'}</div></div>`);
 bindFilters(loadAlerts);
 $$('[data-review]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{if(!confirm(button.dataset.state==='confirmed'?'ยืนยันการไม่เข้าชั้นเรียน? (การยืนยันขาดปกติไม่ส่ง Push ถึงผู้ปกครอง)':'ยืนยันว่ามีเหตุได้รับอนุญาตหรือบันทึกผิด?'))return;await api(`/api/alerts/${button.dataset.review}/review`,{method:'POST',body:{state:button.dataset.state}});toast('บันทึกผลการตรวจสอบแล้ว');await loadAlerts()})));
}
async function loadAdmin(){if(state.user.role!=='admin')return;const accounts=await api('/api/admin/users');state.users=accounts.items;renderAdmin();}
function renderAdmin(){adminSettings.render();}

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
  <div><h2>จัดการข้อมูลนักเรียน</h2><p class="muted">เพิ่ม แก้ไข เปลี่ยนห้อง และพักข้อมูล โดยไม่ลบประวัติ</p></div>
  <div class="card stack"><div class="row between"><div class="field smallbox"><label for="adminStudentRoom">ห้องเรียน</label><select id="adminStudentRoom">${rooms(adminStudentState.roomId)}</select></div>
   <div><strong>${activeCount} คน</strong><p class="muted">พักข้อมูล ${items.length-activeCount} คน</p></div></div>
   <div class="field"><label for="adminStudentSearch">ค้นหารายชื่อหรือรหัสนักเรียน</label><input id="adminStudentSearch" placeholder="พิมพ์ชื่อหรือรหัสนักเรียน" type="search"></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>เลขที่</th><th>ชื่อ–สกุล / รหัสนักเรียน</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${rows||'<tr><td colspan="4">ยังไม่มีนักเรียนในห้องนี้</td></tr>'}</tbody></table></div>
  </div>
  <div class="grid two">
   <section class="card stack"><h3>เพิ่มนักเรียน</h3><form class="stack" id="adminAddStudent">
    <div class="field"><label>ห้องเรียน</label><select name="classroom_id">${rooms(adminStudentState.roomId)}</select></div>
    <div class="field"><label>เลขประจำตัวนักเรียน</label><input name="student_no" required maxlength="40" placeholder="000123"></div>
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
    <div class="warn">การย้ายห้องมีผลตั้งแต่วันที่ยืนยัน หากวันนี้มีข้อมูลเช็กชื่อหรือมาสาย ระบบจะปฏิเสธการย้าย กรุณาดำเนินการก่อนเริ่มเช็กชื่อ</div>
    <h3>ประวัติการสังกัดห้อง</h3>
    ${adminTransferState.studentId===edit.id&&adminTransferState.history.length?
      `<div class="table-wrap"><table class="table"><thead><tr><th>ห้องเรียน</th><th>เลขที่</th><th>เริ่มวันที่</th><th>สิ้นสุดก่อนวันที่</th></tr></thead>
       <tbody>${adminTransferState.history.map(h=>`<tr><td>${esc(h.classroom_label)}</td><td>${h.roll_no}</td><td>${esc(h.start_date)}</td><td>${esc(h.end_date||'ปัจจุบัน')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">ยังไม่มีประวัติเก่า</p>'}
   </section>`:''}
  <div id="unifiedImportHolder"></div>
`);
 unifiedImport.render($('#unifiedImportHolder'));
 $('#adminStudentRoom').addEventListener('change',e=>safeRun(async()=>{
  adminStudentState.roomId=Number(e.target.value);adminStudentState.editId=null;await loadAdminStudents();
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
async function start(){
 if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
 const scanned=new URLSearchParams(location.search).get('late_qr');
 if(scanned){
  history.replaceState(null,'',location.pathname);
  portalUi.acceptLateQr(scanned);
  if(portalUi.hasSession()){await portalUi.resume();return}
  portalUi.showLogin('student');return;
 }
 if(portalUi.hasSession()&&(!state.token||getLastLoginArea()==='portal')){await portalUi.resume();return}
 if(!state.token){renderLogin();return}
 try{await boot()}catch(error){
  // A broken/offline network should not erase a remembered session. Only 401 does that
  // inside api(); after connectivity returns the user can continue without re-entering credentials.
  if(!state.token)return;
  $('#app').innerHTML='<section class="login-wrap"><div class="card login-card stack"><h2>ยังไม่สามารถเชื่อมต่อ RD Care</h2><p>ระบบเก็บการเข้าสู่ระบบของอุปกรณ์นี้ไว้แล้ว ลองเชื่อมต่อใหม่ได้โดยไม่ต้องกรอกรหัสผ่าน</p><button type="button" id="retryRememberedLogin" class="button full">เชื่อมต่ออีกครั้ง</button><button type="button" id="forgetRememberedLogin" class="button secondary full">ออกจากระบบ</button></div></section>';
  $('#retryRememberedLogin')?.addEventListener('click',()=>start());
  $('#forgetRememberedLogin')?.addEventListener('click',()=>{clearAuthSession('rd_token');state.token='';state.user=null;renderLogin()});
 }
}
window.addEventListener('online',()=>toast('เชื่อมต่ออินเทอร์เน็ตแล้ว'));
window.addEventListener('offline',()=>toast('ออฟไลน์: ระบบจะไม่บันทึกข้อมูลจนกว่าจะเชื่อมต่อ',true));
start();
