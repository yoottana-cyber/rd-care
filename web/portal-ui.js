import {API_BASE_URL} from './config.js';
import {bindThemeButtons} from './theme.js';
// Standalone student / guardian portal. It never uses staff authentication.
// Data stays memory-only, bearer token remains scoped to the current browser tab.
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const thaiStatus={present:'มา',absent:'ขาด',late:'สาย',leave:'ลา'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const minusDays=(value,days)=>new Date(Date.parse(value+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
export function createPortalUi({root,onStaffLogin}){
 const state={token:sessionStorage.getItem('rd_portal_token')||'',account:null,role:'student',children:[],studentId:null,records:null,from:minusDays(today(),29),to:today()};
 let requestVersion=0;
 const select=s=>root.querySelector(s);
 const message=(str,bad=false)=>{const box=select('#portalMessage');if(box){box.textContent=str;box.className=bad?'warn':'ok';}};
 async function call(path,{method='GET',body,auth=true}={}){
  const headers={'content-type':'application/json'};
  if(auth&&state.token)headers.authorization='Bearer '+state.token;
  const response=await fetch(API_BASE_URL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   if(response.status===401&&auth){state.token='';sessionStorage.removeItem('rd_portal_token');}
   throw Error(data.error||'ไม่สามารถติดต่อระบบได้');
  }
  return data;
 }
 function frame(inner,login=false){
  root.innerHTML=login?`<div class="login-wrap portal-wrap"><section class="card login-card portal-login-card">
    <header class="login-brand">
      <span class="brand-code">RD CARE • RATSADA SCHOOL</span>
      <img class="login-crest" src="./media/ratsada-crest.svg" alt="ตราโรงเรียนรัษฎา" width="91" height="91" decoding="async">
      <h1>ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา</h1>
      <p class="brand-subtitle">ดูแล เอาใจใส่ และส่งเสริมศักยภาพผู้เรียน</p>
    </header>
    <div class="login-content">
    ${inner}<div id="portalMessage" class="muted" role="status" aria-live="polite"></div>
    <div class="theme-switch-login"><button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button></div>
    </div>
    <footer class="login-credit">พัฒนาโดย ครูยุทธนา บุญจันทร์</footer>
    </section></div>`
    :`<div class="login-wrap portal-wrap"><section class="card portal-card stack">
    <div class="login-head"><div class="brand-icon">RD</div><h1>RD Care</h1><p>พื้นที่นักเรียนและผู้ปกครอง</p></div>
    ${inner}<div id="portalMessage" class="muted" role="status" aria-live="polite"></div>
    <div class="theme-switch-login"><button type="button" class="button ghost theme-switch" data-theme-toggle>เปลี่ยนธีม</button></div></section></div>`;
  bindThemeButtons();
 }
 function showLogin(role=state.role){
  state.role=role;requestVersion++;
  state.account=null;state.children=[];state.records=null;
  frame(`<div class="login-role-tabs" role="group" aria-label="ประเภทผู้เข้าใช้งาน">
    <button type="button" class="active" aria-pressed="true">นักเรียน / ผู้ปกครอง</button>
    <button type="button" id="portalBackTop" aria-pressed="false">ครู / ผู้ดูแลระบบ</button></div>
    <h2 class="login-heading">เข้าสู่ระบบ${role==='student'?'นักเรียน':'ผู้ปกครอง'}</h2>
   <div class="row portal-role-choice">
    <button type="button" class="button ${role==='student'?'':'secondary'}" data-role="student">นักเรียน</button>
    <button type="button" class="button ${role==='guardian'?'':'secondary'}" data-role="guardian">ผู้ปกครอง</button></div>
   <form id="portalLoginForm" class="stack">
    <div class="field"><label>${role==='student'?'เลขประจำตัวนักเรียน (Username)':'Username ผู้ปกครอง'}</label><input name="username" required autocomplete="username" maxlength="40" ${role==='student'?'inputmode="numeric"':''}></div>
    <div class="field"><label>รหัสผ่าน</label><input name="password" type="password" required autocomplete="current-password"></div>
    <button type="submit" class="button full">เข้าสู่ระบบ</button></form>
   <p class="muted">ใช้บัญชีที่โรงเรียนออกให้และต้องเปลี่ยนรหัสผ่านชั่วคราวในการเข้าใช้ครั้งแรก</p>
   <button type="button" id="portalBack" class="button secondary full">กลับหน้าเข้าสู่ระบบครู</button>`,true);
  select('#portalBackTop').addEventListener('click',onStaffLogin);
  select('#portalBack').addEventListener('click',onStaffLogin);
  root.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>showLogin(b.dataset.role)));
  select('#portalLoginForm').addEventListener('submit',async e=>{
   e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
   try{
    const f=new FormData(form);
    const r=await call('/api/portal/auth/login',{method:'POST',auth:false,
     body:{username:String(f.get('username')).trim(),password:String(f.get('password')),role:state.role}});
    state.token=r.token;state.account=r.account;sessionStorage.setItem('rd_portal_token',r.token);
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
    state.token='';sessionStorage.removeItem('rd_portal_token');showLogin(state.role);
    message('ตั้งรหัสผ่านส่วนตัวสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
   }catch(error){message(error.message,true)}finally{if(button.isConnected)button.disabled=false}
  });
 }
 async function logout(){
  requestVersion++;
  try{if(state.token)await call('/api/portal/auth/logout',{method:'POST',body:{}})}catch{}
  state.token='';state.account=null;state.records=null;state.children=[];
  sessionStorage.removeItem('rd_portal_token');showLogin();
 }
 async function showDashboard(){
  try{
   const session=state.token;
   const data=await call('/api/portal/children');
   if(session!==state.token||!state.account)return;
   state.children=data.items;
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
  const current=state.children.find(x=>x.id===state.studentId);
  const r=state.records;
  frame(`<div class="row between"><div><h2>${esc(state.account.display_name)}</h2>
   <p class="muted">${state.account.role==='guardian'?'ผู้ปกครอง':'นักเรียน'} • ดูข้อมูลเฉพาะที่ได้รับสิทธิ์</p></div>
   <button type="button" id="portalLogout" class="button secondary">ออกจากระบบ</button></div>
   ${state.children.length?`<div class="grid two">
     <div class="field"><label>นักเรียน${state.account.role==='guardian'?'ในความดูแล':''}</label>
      <select id="portalStudent">${state.children.map(s=>`<option value="${s.id}" ${s.id===state.studentId?'selected':''}>${esc(s.full_name)} • ${esc(s.classroom_label)}</option>`).join('')}</select></div>
     <div class="field"><label>ช่วงวันที่ (สูงสุด 90 วัน)</label><div class="row"><input aria-label="ตั้งแต่วันที่" id="portalFrom" type="date" value="${state.from}"><input aria-label="ถึงวันที่" id="portalTo" type="date" value="${state.to}"></div></div>
     </div><button type="button" id="portalSearch" class="button secondary">แสดงข้อมูลช่วงวันที่เลือก</button>`:'<p class="empty">ยังไม่มีนักเรียนที่บัญชีนี้ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบของโรงเรียน</p>'}
   ${r&&current?`<div class="summary"><strong>${esc(r.student.full_name)}</strong>
     <div class="muted">เลขประจำตัว ${esc(r.student.student_no)} • ห้อง ${esc(r.student.classroom_label)}</div></div>
    <h3>การมาเรียนประจำวัน</h3>${table(r.daily,[['school_date','วันที่'],['status','สถานะ']],row=>thaiStatus[row.status]||row.status)}
    <h3>การมาเรียนรายคาบ</h3>${table(r.period,[['school_date','วันที่'],['period','คาบ'],['subject','วิชา'],['status','สถานะ']],row=>thaiStatus[row.status]||row.status)}
    <h3>ประวัติมาสาย</h3>${table(r.late,[['school_date','วันที่'],['arrived_at','เวลา'],['state','สถานะ']],row=>row.state==='verified'?'ยืนยันแล้ว':'รอตรวจสอบ')}
    <h3>คะแนนพฤติกรรม</h3><p class="muted">รวมเฉพาะช่วงวันที่เลือก: ${r.behavior_total} คะแนน</p>
    ${table(r.behavior,[['record_date','วันที่'],['points','คะแนน'],['reason','เหตุผล']])}`:''}
   <p class="muted">ยังไม่เปิดใช้งานการแจ้งเตือน Push ถึงผู้ปกครอง</p>`);
  select('#portalLogout').addEventListener('click',logout);
  select('#portalStudent')?.addEventListener('change',e=>{state.studentId=Number(e.target.value);loadRecords()});
  select('#portalSearch')?.addEventListener('click',()=>{
   state.from=select('#portalFrom').value;state.to=select('#portalTo').value;
   loadRecords();
  });
 }
 function table(rows,columns,formatStatus){
  if(!rows?.length)return empty;
  return `<div class="table-wrap"><table class="table"><thead><tr>${columns.map(([,name])=>`<th>${esc(name)}</th>`).join('')}</tr></thead>
   <tbody>${rows.map(x=>`<tr>${columns.map(([key])=>`<td>${esc(key==='status'||key==='state'?formatStatus?.(x):x[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 }
 async function resume(){
  if(!state.token)return false;
  try{
   const me=await call('/api/portal/auth/me');state.account=me.account;state.role=me.account.role;
   if(state.account.must_change_password)showPasswordChange();else await showDashboard();
  }catch{state.token='';sessionStorage.removeItem('rd_portal_token');showLogin()}
  return true;
 }
 return {showLogin,resume,hasSession:()=>!!state.token};
}
