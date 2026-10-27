import {API_BASE_URL} from './config.js';
import {bindThemeButtons} from './theme.js';
import {readAuthSession,saveAuthSession,clearAuthSession,setLastLoginArea} from './auth-session.js';
import {createGuardianPush} from './guardian-push.js';
import {readLateGateIntent,rememberLateGateIntent,clearLateGateIntent} from './late-qr-intent.js';
// Standalone student / guardian portal. It never uses staff authentication.
// Data stays memory-only, bearer token remains scoped to the current browser tab.
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const thaiStatus={present:'มา',absent:'ขาด',late:'สาย',leave:'ลา',truancy:'หนีเรียน'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const minusDays=(value,days)=>new Date(Date.parse(value+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
export function createPortalUi({root,onStaffLogin,onLegacyLateReport}){
 const state={token:readAuthSession('rd_portal_token'),account:null,role:'student',children:[],studentId:null,records:null,truancy:[],from:minusDays(today(),29),to:today(),view:'home',focus:null,focusUnavailable:false};
 const pushParams=new URLSearchParams(location.search);
 let noticeIntent=['late','truancy'].includes(pushParams.get('portal_notice'))&&
  /^\d{1,15}$/.test(pushParams.get('notice_id')||'')?
  {kind:pushParams.get('portal_notice'),id:Number(pushParams.get('notice_id'))}:null;
 let requestVersion=0;
 let lateQrToken=readLateGateIntent(location.search),lateQrReceipt=null;
 function acceptLateQr(value){
  lateQrToken=value==='gate'||/^[a-f0-9]{40}$/.test(value)?value:null;
  if(lateQrToken==='gate')rememberLateGateIntent('gate');
  lateQrReceipt=null;
 }
 function endLateQrIntent(){
  lateQrToken=null;
  clearLateGateIntent();
  if(new URLSearchParams(location.search).get('late_qr')!==null)
   history.replaceState(null,'',location.pathname+'?login=student'+location.hash);
 }
 const select=s=>root.querySelector(s);
 const portalDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return String(value||'');
  const d=new Date(value+'T00:00:00Z');
  return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('th-TH',{
   timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(d);
 };
 const statusTone=value=>['present','verified'].includes(value)?'positive':
  ['late','pending'].includes(value)?'attention':['absent','truancy'].includes(value)?'critical':'neutral';
 const statusLabel=value=>thaiStatus[value]||({verified:'ยืนยันแล้ว',pending:'รอตรวจสอบ',rejected:'ไม่อนุมัติ'}[value])||value||'—';
 function setPortalView(view,scroll=false){
  const allowed=state.account?.role==='guardian'?['home','attendance','alerts','account']:
   ['home','attendance','late','account'];
  state.view=allowed.includes(view)?view:'home';
  root.querySelectorAll('[data-portal-panel]').forEach(el=>{el.hidden=el.dataset.portalPanel!==state.view});
  root.querySelectorAll('[data-portal-view]').forEach(el=>{
   const active=el.dataset.portalView===state.view;
   el.classList.toggle('active',active);
   if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  if(scroll)window.scrollTo(0,0);
 }
 const message=(str,bad=false)=>{const box=select('#portalMessage');if(box){box.textContent=str;box.className=bad?'warn':'ok';}};
 const guardianPush=createGuardianPush({call,select,message});
 async function call(path,{method='GET',body,auth=true}={}){
  const headers={'content-type':'application/json'};
  if(auth&&state.token)headers.authorization='Bearer '+state.token;
  const response=await fetch(API_BASE_URL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   if(response.status===401&&auth){state.token='';clearAuthSession('rd_portal_token');}
   throw Error(data.error||'ไม่สามารถติดต่อระบบได้');
  }
  return data;
 }
 function frame(inner,login=false){
  root.innerHTML=login?`<div class="login-wrap portal-wrap"><section class="card login-card portal-login-card">
    <header class="login-brand">
      <span class="brand-code">RD CARE • RATSADA SCHOOL</span>
      <img class="login-crest rd-school-crest" src="https://www.ratsada.ac.th/images/symbol.png" alt="ตราโรงเรียนรัษฎา" width="200" height="185" decoding="async" fetchpriority="high">
      <h1>ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา</h1>
      <p class="brand-subtitle">ดูแล เอาใจใส่ และส่งเสริมศักยภาพผู้เรียน</p>
    </header>
    <div class="login-content">
    ${inner}<div id="portalMessage" class="muted" role="status" aria-live="polite"></div>
    <div class="theme-switch-login"><button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button></div>
    </div>
    <footer class="login-credit">พัฒนาโดย ครูยุทธนา บุญจันทร์</footer>
    </section></div>`
    :`<div class="rd-portal-mobile" data-role="${state.account?.role==='guardian'?'guardian':'student'}">
     <header class="rd-portal-bar"><div class="rd-portal-school">
      <img class="rd-school-crest" src="https://www.ratsada.ac.th/images/symbol.png" alt="" width="48" height="48" decoding="async">
      <div><strong>RD Care</strong><small>โรงเรียนรัษฎา</small></div></div>
      <span class="rd-portal-role">${state.account?.role==='guardian'?'ผู้ปกครอง':'นักเรียน'}</span>
     </header>
     <main class="rd-portal-content" id="portalMain" tabindex="-1">
      ${inner}<div id="portalMessage" class="rd-portal-feedback" role="status" aria-live="polite"></div>
     </main>
     <nav class="rd-portal-bottom" aria-label="เมนูหลัก">
      ${[['home','⌂','หน้าหลัก'],['attendance','▦','การมาเรียน'],
        state.account?.role==='guardian'?['alerts','♧','แจ้งเตือน']:['late','◷','มาสาย'],
        ['account','☷','บัญชี']].map(([id,icon,label])=>`<button type="button" data-portal-view="${id}" aria-label="${label}">
         <span class="rd-portal-nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>
        </button>`).join('')}
     </nav>
    </div>`;
  bindThemeButtons();
  if(!login){
   root.querySelectorAll('[data-portal-view]').forEach(btn=>btn.addEventListener('click',()=>setPortalView(btn.dataset.portalView,true)));
   root.querySelectorAll('[data-portal-open]').forEach(btn=>btn.addEventListener('click',()=>setPortalView(btn.dataset.portalOpen,true)));
   setPortalView(state.view);
  }
 }
 function showLogin(role=state.role){
  if(lateQrToken)role='student';
  if(noticeIntent)role='guardian';
  state.role=role;state.view='home';requestVersion++;
  state.account=null;state.children=[];state.records=null;
  frame(`<h2 class="login-heading">เข้าสู่ระบบ${role==='student'?'นักเรียน':'ผู้ปกครอง'}</h2>
    <p class="muted portal-login-intro">${role==='student'?'สำหรับนักเรียนโรงเรียนรัษฎา • ใช้บัญชีที่โรงเรียนออกให้':'สำหรับผู้ปกครอง • ติดตามข้อมูลเฉพาะนักเรียนในความดูแล'}</p>
    ${lateQrToken?'<p class="summary" role="status">⏰ สแกน QR ลงชื่อมาสายแล้ว กรุณาเข้าสู่ระบบบัญชีนักเรียน จากนั้นระบบจะแสดงปุ่มยืนยันลงชื่อให้ทันที</p>':''}
    ${noticeIntent?'<p class="summary" role="status">🔔 เข้าสู่ระบบผู้ปกครองเพื่อเปิดรายละเอียดการแจ้งเตือน</p>':''}
    <form id="portalLoginForm" class="stack">
     <div class="field"><label>${role==='student'?'เลขประจำตัวนักเรียน (Username)':'Username ผู้ปกครอง'}</label><input name="username" required autocomplete="username" maxlength="40" ${role==='student'?'inputmode="numeric"':''}></div>
     <div class="field"><label for="portalPassword">รหัสผ่าน</label>
      <div class="rd-portal-password-field">
       <input id="portalPassword" name="password" type="password" required autocomplete="current-password">
       <button type="button" id="portalTogglePassword" aria-label="แสดงรหัสผ่าน" aria-pressed="false">แสดง</button>
      </div></div>
     <label class="remember-login"><input type="checkbox" name="remember">
      <span><strong>จดจำการเข้าสู่ระบบบนอุปกรณ์นี้</strong>
       <small>เลือกเฉพาะมือถือหรือคอมพิวเตอร์ส่วนตัว • สูงสุด 30 วัน</small></span></label>
     <button type="submit" class="button full">เข้าสู่ระบบ${role==='student'?'นักเรียน':'ผู้ปกครอง'}</button></form>
    <p class="muted">ใช้บัญชีที่โรงเรียนออกให้และต้องเปลี่ยนรหัสผ่านชั่วคราวในการเข้าใช้ครั้งแรก</p>
    ${role==='student'&&!lateQrToken?'<button type="button" id="studentLateEntry" class="button secondary full">แจ้งมาสายด้วยรหัสจากครูเวร (แบบเดิม)</button>':''}
    ${!lateQrToken&&!noticeIntent?'<button type="button" id="portalBack" class="button secondary full">← กลับหน้าเลือกประเภทผู้เข้าใช้งาน</button>':''}`,true);
   select('#portalBack')?.addEventListener('click',onStaffLogin);
   select('#studentLateEntry')?.addEventListener('click',onLegacyLateReport);
   select('#portalTogglePassword')?.addEventListener('click',()=>{
    const field=select('#portalPassword'),button=select('#portalTogglePassword');
    if(!field||!button)return;
    const shown=field.type==='password';field.type=shown?'text':'password';
    button.textContent=shown?'ซ่อน':'แสดง';
    button.setAttribute('aria-pressed',String(shown));
    button.setAttribute('aria-label',shown?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน');
   });
   select('#portalLoginForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
    try{
     const f=new FormData(form);
     const r=await call('/api/portal/auth/login',{method:'POST',auth:false,
      body:{username:String(f.get('username')).trim(),password:String(f.get('password')),role:state.role,
       remember:f.get('remember')==='on'}});
     state.token=r.token;state.account=r.account;
     saveAuthSession('rd_portal_token',r.token,r.expires_in,f.get('remember')==='on'&&!r.account.must_change_password);
     setLastLoginArea('portal');
     if(state.account.must_change_password)showPasswordChange();
     else await showDashboard();
    }catch(error){message(error.message,true)}finally{if(button.isConnected)button.disabled=false}
   });
 }
 function showPasswordChange(){
  frame(`<h2 class="login-heading">ตั้งรหัสผ่านส่วนตัว</h2><p class="warn">บัญชีนี้ยังใช้รหัสผ่านชั่วคราว กรุณาเปลี่ยนก่อนดูข้อมูล</p>
   <form id="portalChangeForm" class="stack">
    <div class="field"><label>รหัสผ่านชั่วคราว / รหัสผ่านปัจจุบัน</label><input type="password" name="current_password" autocomplete="current-password" required></div>
    <div class="field"><label>รหัสผ่านใหม่ (อย่างน้อย 4 ตัวอักษร)</label><input type="password" name="new_password" minlength="4" maxlength="128" autocomplete="new-password" required></div>
    <div class="field"><label>ยืนยันรหัสผ่านใหม่</label><input type="password" name="confirm" minlength="4" autocomplete="new-password" required></div>
    <button type="submit" class="button full">เปลี่ยนรหัสผ่าน</button></form>
   <button type="button" class="button secondary full" id="portalLogout">ออกจากระบบ</button>`,true);
  select('#portalLogout').addEventListener('click',logout);
  select('#portalChangeForm').addEventListener('submit',async e=>{
   e.preventDefault();const form=e.currentTarget,f=new FormData(form);
   if(f.get('new_password')!==f.get('confirm')){message('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน',true);return}
   const button=form.querySelector('button');button.disabled=true;
   try{
    await call('/api/portal/auth/change-password',{method:'POST',body:{
      current_password:String(f.get('current_password')),new_password:String(f.get('new_password'))}});
    state.token='';clearAuthSession('rd_portal_token');showLogin(state.role);
    message('ตั้งรหัสผ่านส่วนตัวสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
   }catch(error){message(error.message,true)}finally{if(button.isConnected)button.disabled=false}
  });
 }
 async function logout(){
  requestVersion++;
  if(state.account?.role==='guardian')try{await guardianPush.disable({silent:true})}catch{}
  try{if(state.token)await call('/api/portal/auth/logout',{method:'POST',body:{}})}catch{}
  state.token='';state.account=null;state.records=null;state.children=[];state.focus=null;state.view='home';noticeIntent=null;
  clearAuthSession('rd_portal_token');showLogin();
 }
 async function showDashboard(){
  try{
   if(lateQrToken)state.view='late';
   const session=state.token;
   const [data,notices,focused]=await Promise.all([
    call('/api/portal/children'),
    state.account?.role==='guardian'?call('/api/portal/truancy'):Promise.resolve({items:[]}),
    noticeIntent&&state.account?.role==='guardian'?
     call('/api/portal/push/target?kind='+noticeIntent.kind+'&id='+noticeIntent.id)
      .then(item=>({item})).catch(()=>({missing:true})):Promise.resolve(null)
   ]);
   if(session!==state.token||!state.account)return;
   state.children=data.items;state.truancy=notices.items||[];
   if(focused){
    state.focus=focused.item||null;
    state.focusUnavailable=!!focused.missing;
    if(state.focus){
     state.studentId=Number(state.focus.student_id);
     state.from=state.focus.school_date;state.to=state.focus.school_date;
    }
    noticeIntent=null;state.view='home';
    history.replaceState(null,'',location.pathname+'?login=guardian'+location.hash);
   }
   if(!state.children.some(s=>s.id===state.studentId))state.studentId=state.children[0]?.id||null;
   if(state.studentId)await loadRecords();else renderDashboard();
  }catch(error){if(!state.token){showLogin(state.role);return}frame('<p class="warn">ไม่สามารถโหลดข้อมูลที่ได้รับสิทธิ์</p><button class="button secondary full" id="portalRetry">ลองอีกครั้ง</button>');message(error.message,true);select('#portalRetry').addEventListener('click',showDashboard)}
 }
 async function loadRecords(){
  const studentId=state.studentId,from=state.from,to=state.to;
  const version=++requestVersion;
  state.records=null;
  if(!studentId){renderDashboard();return}
  try{
   const records=await call('/api/portal/records?student_id='+studentId+
    '&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
   if(version!==requestVersion||studentId!==state.studentId||from!==state.from||to!==state.to)return;
   state.records=records;renderDashboard();
  }catch(error){
   if(version!==requestVersion)return;
   if(!state.token){showLogin(state.role);return}
   renderDashboard();message(error.message,true);
  }
 }
 const empty='<p class="empty">ไม่พบรายการในช่วงวันที่เลือก</p>';
 function renderDashboard(){
  const guardian=state.account.role==='guardian';
  const current=state.children.find(x=>x.id===state.studentId);
  const r=state.records;
  const dayRows=r?.daily||[];
  const count=status=>dayRows.filter(x=>x.status===status).length;
  const topic=state.focus?.kind==='late'?'มาสาย':'หนีเรียน';
  const recent=state.truancy.filter(x=>x.school_date===today()).length;
  frame(`<section class="rd-portal-hero" data-portal-panel="home">
    <div class="rd-portal-hero-top"><span class="rd-portal-overline">RATSADA STUDENT CARE</span><span class="rd-portal-hero-mark" aria-hidden="true">✦</span></div>
    <p class="rd-portal-eyebrow">ยินดีต้อนรับสู่ RD Care</p>
    <h1>${esc(state.account.display_name)}</h1>
    <p>${guardian?'พื้นที่ผู้ปกครอง • ติดตามการมาเรียนอย่างสะดวก':'พื้นที่นักเรียน • ดูแลทุกวันเรียนของคุณ'}</p>
    <div class="rd-portal-hero-footer"><span>◉ ข้อมูลจากระบบโรงเรียน</span><span>${esc(portalDate(today()))}</span></div>
   </section>
   <section class="rd-portal-panel" data-portal-panel="home">
    ${state.children.length?`<section class="rd-portal-card rd-portal-student-pick">
     <div class="rd-portal-section-heading"><div><span class="rd-portal-kicker">${guardian?'นักเรียนในความดูแล':'ข้อมูลนักเรียน'}</span>
      <h2>${guardian?'เลือกนักเรียน':'ข้อมูลของฉัน'}</h2></div><span class="rd-portal-section-symbol" aria-hidden="true">🎓</span></div>
     <label class="rd-portal-label" for="portalStudent">${guardian?'นักเรียนในความดูแล':'นักเรียน'}</label>
     <select id="portalStudent">${state.children.map(st=>`<option value="${st.id}" ${st.id===state.studentId?'selected':''}>${esc(st.full_name)} • ${esc(st.classroom_label)}</option>`).join('')}</select>
     ${current?`<p class="rd-portal-help">ห้อง ${esc(current.classroom_label)} • รหัสนักเรียน ${esc(current.student_no)}</p>`:''}
    </section>`:'<section class="rd-portal-card"><p class="rd-portal-empty">ยังไม่มีนักเรียนที่บัญชีนี้ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบของโรงเรียน</p></section>'}
    ${guardian&&state.focus?`<section class="rd-portal-card rd-portal-important" id="pushNoticeFocus" tabindex="-1">
      <div class="rd-portal-kicker">🔔 เรื่องที่แจ้งเตือน</div>
      <h2>${topic}</h2><strong>${esc(state.focus.full_name)}</strong>
      <p>ห้อง ${esc(state.focus.classroom_label)} • ${esc(portalDate(state.focus.school_date))}</p>
      <p>${state.focus.kind==='late'?'เวลา '+esc(state.focus.arrived_at)+' น.':
       'คาบ '+esc(state.focus.period)+' • วิชา '+esc(state.focus.subject)}</p>
      ${state.focus.kind==='late'&&state.focus.reason?`<p>สาเหตุ: ${esc(state.focus.reason)}</p>`:''}
      <p class="rd-portal-help">รายละเอียดนี้แสดงสำหรับบัญชีที่ได้รับสิทธิ์เท่านั้น</p>
    </section>`:''}
    ${guardian&&state.focusUnavailable?`<section class="rd-portal-card rd-portal-important" role="status">ไม่พบรายการแจ้งเตือนนี้ อาจถูกแก้ไข ยกเลิก หรือบัญชีนี้ไม่มีสิทธิ์ดู</section>`:''}
    ${guardian&&recent?`<section class="rd-portal-urgent"><span aria-hidden="true">🔔</span><div>
      <strong>มีรายการการมาเรียนที่ควรตรวจสอบวันนี้</strong>
      <p>ดูข้อมูลและประสานกับโรงเรียนเมื่อมีข้อสงสัย</p>
      <button type="button" data-portal-open="alerts">เปิดรายการแจ้งเตือน</button>
     </div></section>`:''}
    <div class="rd-portal-section-heading rd-portal-space-top"><div><span class="rd-portal-kicker">ภาพรวมการมาเรียน</span>
     <h2>สรุปช่วงวันที่เลือก</h2></div><button class="rd-portal-text-action" type="button" data-portal-open="attendance">ดูประวัติทั้งหมด ›</button></div>
    <div class="rd-portal-metrics">
     ${[['present','มา','✓'],['late','สาย','◷'],['leave','ลา','⌁'],['absent','ขาด','!']].map(([key,label,icon])=>`
      <div class="rd-portal-metric rd-portal-metric-${key}"><span class="rd-portal-metric-symbol">${icon}</span>
       <strong>${r?count(key):'–'}</strong><span>${label}</span></div>`).join('')}
    </div>
    <p class="rd-portal-count-note">นับเฉพาะวันที่มีข้อมูลเช็กชื่อในช่วงที่เลือก (${dayRows.length} รายการ)</p>
    <div class="rd-portal-quick-grid">
     <button type="button" class="rd-portal-quick" data-portal-open="attendance">
      <span class="rd-portal-quick-icon">▦</span><strong>ประวัติการมาเรียน</strong><small>รายวันและรายคาบ</small></button>
     <button type="button" class="rd-portal-quick" data-portal-open="${guardian?'alerts':'late'}">
      <span class="rd-portal-quick-icon">${guardian?'♧':'◷'}</span>
      <strong>${guardian?'การแจ้งเตือน':'ลงชื่อมาสาย'}</strong>
      <small>${guardian?'เหตุการณ์ที่ต้องติดตาม':'QR และประวัติมาสาย'}</small></button>
    </div>
    ${r?.daily?.length?`<section class="rd-portal-card rd-portal-space-top"><div class="rd-portal-section-heading">
     <div><span class="rd-portal-kicker">ข้อมูลล่าสุด</span><h2>การมาเรียนรายวัน</h2></div></div>
     ${table(r.daily.slice(0,3),[['school_date','วันที่'],['status','สถานะ']],x=>statusLabel(x.status))}
     <button type="button" class="rd-portal-outline" data-portal-open="attendance">ดูข้อมูลทั้งหมด</button></section>`:''}
   </section>
   <section class="rd-portal-panel" data-portal-panel="attendance">
    <div class="rd-portal-page-title"><span class="rd-portal-kicker">ATTENDANCE HISTORY</span><h1>การมาเรียน</h1>
     <p>ตรวจสอบข้อมูลจากการเช็กชื่อรายวันและรายคาบ</p></div>
    <section class="rd-portal-card rd-portal-filter">
     <h2>เลือกช่วงวันที่</h2><div class="rd-portal-date-grid">
      <div class="field"><label for="portalFrom">ตั้งแต่วันที่</label><input id="portalFrom" type="date" value="${state.from}" max="${today()}"></div>
      <div class="field"><label for="portalTo">ถึงวันที่</label><input id="portalTo" type="date" value="${state.to}" max="${today()}"></div>
     </div><button type="button" id="portalSearch" class="rd-portal-primary">แสดงข้อมูลช่วงวันที่เลือก</button>
     <p class="rd-portal-help">เลือกดูข้อมูลย้อนหลังได้สูงสุด 90 วัน</p>
    </section>
    ${r&&current?`<section class="rd-portal-record-section"><div class="rd-portal-section-heading">
      <div><span class="rd-portal-kicker">${esc(current.full_name)}</span><h2>เช็กชื่อรายวัน</h2></div>
      <span class="rd-portal-count">${r.daily?.length||0} รายการ</span></div>
      ${table(r.daily,[['school_date','วันที่'],['status','สถานะ']],x=>statusLabel(x.status))}
     </section><section class="rd-portal-record-section"><div class="rd-portal-section-heading">
      <div><span class="rd-portal-kicker">ตารางเรียน</span><h2>เช็กชื่อรายคาบ</h2></div>
      <span class="rd-portal-count">${r.period?.length||0} รายการ</span></div>
      ${table(r.period,[['school_date','วันที่'],['period','คาบ'],['subject','วิชา'],['status','สถานะ']],x=>statusLabel(x.status))}
     </section>
     ${guardian?`<section class="rd-portal-record-section"><div class="rd-portal-section-heading">
      <div><span class="rd-portal-kicker">บันทึกเวลาเข้าเรียน</span><h2>ประวัติมาสาย</h2></div>
      <span class="rd-portal-count">${r.late?.length||0} รายการ</span></div>
      ${table(r.late,[['school_date','วันที่'],['arrived_at','เวลา'],['state','สถานะ']],x=>statusLabel(x.state))}
     </section>`:''}`:''}
   </section>
   ${!guardian?`<section class="rd-portal-panel" data-portal-panel="late">
    <div class="rd-portal-page-title"><span class="rd-portal-kicker">LATE ARRIVAL</span><h1>ลงชื่อมาสาย</h1>
     <p>สแกน QR ของครูเวร แล้วลงชื่อผ่านบัญชีนักเรียนของตนเอง</p></div>
    ${lateQrToken?`<section class="rd-portal-card rd-portal-qr-card">
     <span class="rd-portal-qr-icon" aria-hidden="true">◷</span><h2>ยืนยันลงชื่อมาสาย</h2>
     <p>ระบบบันทึกเวลาจากเซิร์ฟเวอร์และอนุมัติอัตโนมัติเมื่อกดยืนยันหลัง 08.00 น.</p>
     <form id="studentLateQrForm" class="stack">
      <div class="field"><label for="lateQrReason">สาเหตุที่มาสาย (ไม่บังคับ)</label>
       <textarea id="lateQrReason" maxlength="300" name="reason" placeholder="ระบุสาเหตุที่มาสาย"></textarea></div>
      <button type="submit" class="rd-portal-primary">✓ ยืนยันลงชื่อมาสาย</button>
     </form><button type="button" id="cancelStudentLateQr" class="rd-portal-outline">ยกเลิก</button>
     <p class="rd-portal-help">ครูเวรสามารถแก้ไขรายการที่ผิดพลาดได้ โดยมีการบันทึกประวัติ</p>
    </section>`:`<section class="rd-portal-card rd-portal-late-hint">
     <span class="rd-portal-qr-icon" aria-hidden="true">▧</span>
     <h2>พร้อมลงชื่อมาสาย</h2><p>สแกน QR ที่โรงเรียนจัดไว้เพื่อเปิดแบบลงชื่อมาสายโดยตรง</p>
     <p class="rd-portal-help">ต้องสแกน QR ของโรงเรียนก่อน จึงจะแสดงปุ่มยืนยัน</p>
    </section>`}
    ${lateQrReceipt?`<section class="rd-portal-card rd-portal-success" role="status">
     <h2>✓ ลงชื่อมาสายสำเร็จ</h2>
     <p>${esc(portalDate(lateQrReceipt.date))} • เวลา ${esc(lateQrReceipt.arrivedAt)} น.</p>
     <p>${lateQrReceipt.state==='verified'?'ยืนยันอัตโนมัติแล้ว และเช็กชื่อรายวันเป็น สาย':'ส่งให้ครูเวรตรวจสอบแล้ว'}</p>
    </section>`:''}
    <section class="rd-portal-record-section"><div class="rd-portal-section-heading">
     <div><span class="rd-portal-kicker">ข้อมูลย้อนหลัง</span><h2>ประวัติมาสาย</h2></div></div>
     ${table(r?.late,[['school_date','วันที่'],['arrived_at','เวลา'],['state','สถานะ']],x=>statusLabel(x.state))}
    </section>
   </section>`:`<section class="rd-portal-panel" data-portal-panel="alerts">
    <div class="rd-portal-page-title"><span class="rd-portal-kicker">SCHOOL NOTICES</span><h1>การแจ้งเตือน</h1>
     <p>ติดตามข้อมูลการมาเรียนของนักเรียนในความดูแล</p></div>
    <section class="rd-portal-card guardian-truancy-notices" id="guardianAlerts">
     <h2>🔔 แจ้งเตือนการมาเรียน</h2>
     ${state.truancy.length?state.truancy.map(e=>`<article class="rd-portal-notice">
      <span class="rd-portal-status rd-portal-status-critical">ข้อมูลที่ควรตรวจสอบ</span>
      <h3>${esc(e.full_name)}</h3><p>${esc(portalDate(e.school_date))} • คาบ ${esc(e.period)} • ${esc(e.subject)}</p>
      <small>ครูบันทึกสถานะหนีเรียน กรุณาตรวจสอบข้อเท็จจริง</small>
     </article>`).join(''):'<p class="rd-portal-empty">ไม่มีรายการหนีเรียนที่กำลังใช้งานใน 30 วันที่ผ่านมา</p>'}
    </section>
    <section class="rd-portal-card rd-portal-notice-guide"><h2>การแจ้งเตือน Push</h2>
     <p>เปิดใช้งานและส่ง Push ทดสอบได้ในแท็บบัญชี หากมีเหตุการณ์ ระบบจะแจ้งประเภทและเปิดรายละเอียดที่เกี่ยวข้องหลังเข้าสู่ระบบ</p>
     <button type="button" class="rd-portal-outline" data-portal-open="account">ตั้งค่าการแจ้งเตือน</button>
    </section>
   </section>`}
   <section class="rd-portal-panel" data-portal-panel="account">
    <div class="rd-portal-page-title"><span class="rd-portal-kicker">MY ACCOUNT</span><h1>บัญชีของฉัน</h1>
     <p>ข้อมูลส่วนตัวและการตั้งค่าระบบ</p></div>
    <section class="rd-portal-card rd-portal-profile"><span class="rd-portal-profile-avatar" aria-hidden="true">${guardian?'👨‍👩‍👧':'🎓'}</span>
     <h2>${esc(state.account.display_name)}</h2><p>${guardian?'บัญชีผู้ปกครอง':'บัญชีนักเรียน'} • โรงเรียนรัษฎา</p></section>
    ${guardian?`<section class="rd-portal-card rd-portal-push-settings">
     <h2>🔔 การแจ้งเตือนบนมือถือ</h2>
     <p>เปิดรับการแจ้งเตือนสำหรับนักเรียนที่โรงเรียนยืนยันความสัมพันธ์แล้ว</p>
     <p id="guardianPushStatus" class="rd-portal-help" role="status">กำลังตรวจสอบความพร้อม</p>
     <div class="rd-portal-settings-actions">
      <button type="button" class="rd-portal-primary" id="guardianPushEnable">เปิดรับ Push</button>
      <button type="button" class="rd-portal-outline" id="guardianPushDisable">ปิด Push อุปกรณ์นี้</button>
      <button type="button" class="rd-portal-outline" id="guardianPushTest">ส่ง Push ทดสอบ</button>
     </div>
     <p id="guardianPushTestStatus" class="rd-portal-help" role="status">Push ทดสอบไม่สร้างรายการนักเรียน</p>
     <p class="rd-portal-help">iPhone: ใช้ Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดผ่านไอคอน RD Care</p>
     <p class="rd-portal-help">หน้าจอล็อกแสดงเฉพาะประเภทและรายละเอียดทั่วไป ไม่แสดงชื่อหรือรหัสนักเรียน</p>
    </section>`:''}
    ${r?`<section class="rd-portal-card"><div class="rd-portal-section-heading"><div>
     <span class="rd-portal-kicker">ข้อมูลช่วงวันที่เลือก</span><h2>คะแนนพฤติกรรม</h2></div>
     <strong class="rd-portal-score">${Number(r.behavior_total)||0}</strong></div>
     ${table(r.behavior,[['record_date','วันที่'],['points','คะแนน'],['reason','เหตุผล']])}
    </section>`:''}
    <section class="rd-portal-card rd-portal-account-actions">
     <button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button>
     <button type="button" id="portalLogout" class="rd-portal-outline rd-portal-logout">ออกจากระบบ</button>
     <p class="rd-portal-help">RD Care • ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา</p>
     <small>พัฒนาโดย ครูยุทธนา บุญจันทร์</small>
    </section>
   </section>`);
  select('#portalLogout').addEventListener('click',logout);
  select('#studentLateQrForm')?.addEventListener('submit',async event=>{
   event.preventDefault();
   const button=event.currentTarget.querySelector('button');
   button.disabled=true;
   try{
    const data=await call('/api/portal/late/qr',{method:'POST',body:{
     token:lateQrToken,reason:String(new FormData(event.currentTarget).get('reason')||'')
    }});
    lateQrReceipt=data;
    endLateQrIntent();
    await showDashboard();
    message(data.state==='verified'?'ลงชื่อมาสายสำเร็จ ยืนยันอัตโนมัติแล้ว':'ลงชื่อสำเร็จ รอตรวจสอบ');
   }catch(error){message(error.message,true);if(button.isConnected)button.disabled=false}
  });
  select('#cancelStudentLateQr')?.addEventListener('click',()=>{
   endLateQrIntent();
   renderDashboard();
  });
  if(state.account.role==='guardian')guardianPush.bind();
  if(state.focus)select('#pushNoticeFocus')?.scrollIntoView({block:'start'});
  select('#portalStudent')?.addEventListener('change',e=>{state.studentId=Number(e.target.value);loadRecords()});
  select('#portalSearch')?.addEventListener('click',()=>{
   state.from=select('#portalFrom').value;state.to=select('#portalTo').value;
   loadRecords();
  });
 }
 function table(rows,columns,formatStatus){
  if(!rows?.length)return '<p class="rd-portal-empty">ยังไม่มีรายการในช่วงวันที่เลือก</p>';
  return `<div class="rd-portal-record-list">${rows.map(x=>{
   const date=x.school_date||x.record_date;
   const status=x.status||x.state;
   const detail=columns.filter(([key])=>key!=='school_date'&&key!=='record_date'&&key!=='status'&&key!=='state');
   return `<article class="rd-portal-record"><div class="rd-portal-record-head">
     <strong>${esc(date?portalDate(date):'รายละเอียดรายการ')}</strong>
     ${status?`<span class="rd-portal-status rd-portal-status-${statusTone(status)}">${esc(formatStatus?formatStatus(x):statusLabel(status))}</span>`:''}
    </div><div class="rd-portal-record-fields">${detail.map(([key,label])=>`
      <div class="rd-portal-record-field"><small>${esc(label)}</small>
      <span>${esc(x[key]??'—')}</span></div>`).join('')}</div></article>`;
  }).join('')}</div>`;
 }
 async function resume(expectedRole=null){
  if(!state.token)return false;
  try{
   const me=await call('/api/portal/auth/me');state.account=me.account;state.role=me.account.role;
    if(expectedRole&&state.account.role!==expectedRole){
     showLogin(expectedRole);
     message('บัญชีที่จดจำไว้เป็นคนละประเภท กรุณาเข้าสู่ระบบ'+(expectedRole==='guardian'?'ผู้ปกครอง':'นักเรียน'),true);
     return true;
    }
   if(noticeIntent&&state.account.role!=='guardian'){
    state.token='';clearAuthSession('rd_portal_token');showLogin('guardian');
    message('กรุณาเข้าสู่ระบบบัญชีผู้ปกครองเพื่อดูรายละเอียดการแจ้งเตือน');return true;
   }
   if(lateQrToken&&state.account.role!=='student'){
    state.token='';clearAuthSession('rd_portal_token');showLogin('student');
    message('สแกน QR ลงชื่อมาสายต้องเข้าสู่ระบบด้วยบัญชีนักเรียน');return true;
   }
   if(state.account.must_change_password)showPasswordChange();else await showDashboard();
  }catch(error){
   if(!state.token){showLogin(expectedRole||state.role);return true}
   frame('<h2>ยังไม่สามารถเชื่อมต่อ RD Care</h2><p class="muted">ระบบจดจำการเข้าสู่ระบบของอุปกรณ์นี้ไว้แล้ว กรุณาลองใหม่เมื่อมีอินเทอร์เน็ต</p><button class="button full" id="portalRetryRestore">เชื่อมต่ออีกครั้ง</button><button class="button secondary full" id="portalForgetRestore">ออกจากระบบ</button>');
   select('#portalRetryRestore')?.addEventListener('click',()=>resume());
   select('#portalForgetRestore')?.addEventListener('click',logout);
  }
  return true;
 }
 return {showLogin,resume,acceptLateQr,hasSession:()=>!!state.token};
}
