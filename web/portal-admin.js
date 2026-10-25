import {planStudentAccounts} from './portal-batch.js';
// Staff portal provisioning is admin-only and never stores one-time credentials.
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function createPortalAdmin({api,mount,toast,rooms,safeRun}){
 let roomId=rooms?.[0]?.id||null,accounts=[],links=[],students=[];
 let issuedCredentials=[];
 const $=s=>document.querySelector(s);
 async function load(notice=null){
  if(!rooms?.some(r=>r.id===roomId))roomId=rooms?.[0]?.id||null;
  const data=await Promise.all([
   api('/api/admin/portal/accounts'),api('/api/admin/portal/links'),
   roomId?api('/api/admin/students?classroom_id='+roomId):Promise.resolve({items:[]})
  ]);
  accounts=data[0].items;links=data[1].items;students=data[2].items.filter(s=>s.active);
  render(notice);
 }
 function render(notice){
  const roomOpts=rooms.map(r=>`<option value="${r.id}" ${r.id===roomId?'selected':''}>${esc(r.label)}</option>`).join('');
  const studentOpts=students.map(s=>`<option value="${s.id}">${s.roll_no}. ${esc(s.full_name)} (${esc(s.student_no)})</option>`).join('');
  const plan=planStudentAccounts(students,accounts);
  const guardians=accounts.filter(a=>a.role==='guardian'&&a.active);
  const guardianOpts=guardians.map(a=>`<option value="${a.id}">${esc(a.display_name)} (${esc(a.username)})</option>`).join('');
  mount(`<section class="stack"><div><h2>บัญชีนักเรียนและผู้ปกครอง</h2><p class="muted">จัดการบัญชีและสิทธิ์การเข้าถึงของนักเรียนและผู้ปกครอง แยกจากบัญชีครูและบุคลากร</p></div>
   ${notice?`<section class="card stack"><h3>ข้อมูลรับบัญชี (แสดงครั้งเดียว)</h3><div class="warn">เก็บรหัสชั่วคราวอย่างปลอดภัย แจ้งเจ้าของบัญชีหลังยืนยันตัวตนเท่านั้น ห้ามส่งในกลุ่มสาธารณะหรือเผยแพร่ภาพหน้าจอ</div>
    <div class="field"><label>Username</label><input readonly value="${esc(notice.username)}"></div>
    <div class="field"><label>รหัสผ่านชั่วคราว</label><input readonly value="${esc(notice.temporary_password)}"></div>
    <p class="muted">รหัสชั่วคราวไม่สามารถดูย้อนหลังได้ หากสูญหายให้รีเซ็ตรหัสผ่านใหม่จากปุ่มด้านล่าง</p></section>`:''}
   <div class="grid two">
    <section class="card stack"><h3>สร้างบัญชีนักเรียน</h3>
     <div class="field"><label>เลือกห้องเรียน</label><select id="portalAdminRoom">${roomOpts}</select></div>
     <form id="portalCreateStudent" class="stack">
      <div class="field"><label>นักเรียน</label><select required name="student_id">${studentOpts}</select></div>
      <div class="field"><label>Username (ค่าเริ่มต้นคือเลขประจำตัวนักเรียน)</label><input id="selectedStudentNumber" name="username" maxlength="40" required value="${esc(students[0]?.student_no||'')}" autocomplete="off"></div>
      <div class="field"><label>รหัสผ่านเริ่มต้น (ไม่บังคับ: เว้นว่างเพื่อให้ระบบสุ่ม)</label><input name="password" type="password" minlength="4" maxlength="128" autocomplete="new-password" placeholder="อย่างน้อย 4 ตัวอักษร"></div>
      <button type="submit" class="button full" ${students.length?'':'disabled'}>สร้างบัญชีนักเรียน</button>
     </form></section>
    <section class="card stack"><h3>สร้างบัญชีผู้ปกครอง</h3>
     <form id="portalCreateGuardian" class="stack">
      <div class="field"><label>ชื่อ–สกุลผู้ปกครอง</label><input name="display_name" required maxlength="100" placeholder="ชื่อ–สกุลผู้ปกครอง"></div>
      <div class="field"><label>Username ใหม่</label><input name="username" required minlength="3" maxlength="40" placeholder="เช่น guardian001"></div>
      <button class="button full" type="submit">สร้างบัญชีผู้ปกครอง</button>
     </form></section></div>
   <section class="card stack"><h3>สร้างบัญชีนักเรียนจากรายชื่อทั้งห้อง</h3>
    <p class="muted">นำเข้ารายชื่อนักเรียนด้วย Excel/CSV ที่เมนู “นักเรียน” ก่อน แล้วกลับมาหน้านี้ ระบบจะใช้เลขประจำตัวนักเรียนเป็น Username โดยอัตโนมัติ</p>
    <p class="muted">พร้อมสร้าง ${plan.items.filter(x=>x.status==='ready').length} บัญชี • มีบัญชีแล้ว/ข้อมูลไม่ถูกต้อง ${plan.skipped.length} รายการ • สร้างครั้งละไม่เกิน 10 บัญชีเพื่อลดภาระ Worker</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>รหัสนักเรียน</th><th>ชื่อ–สกุล</th><th>สถานะ</th></tr></thead>
     <tbody>${plan.items.map(x=>`<tr><td>${esc(x.student_no)}</td><td>${esc(x.full_name)}</td><td>${esc(x.reason||'พร้อมสร้าง')}</td></tr>`).join('')||'<tr><td colspan="3">ไม่มีนักเรียนในห้องนี้</td></tr>'}</tbody></table></div>
    <div id="portalBulkProgress" class="muted" role="status" aria-live="polite"></div>
    <button type="button" id="portalBulkCreate" class="button full" ${plan.ready.length?'':'disabled'}>สร้างบัญชี ${plan.ready.length} คนที่ยังไม่มีบัญชี</button>
    <div class="warn">ห้ามอัปโหลดเลขประจำตัวประชาชนเพื่อใช้เป็นรหัสผ่าน ระบบจะสุ่มรหัสชั่วคราวแยกรายคนและบังคับเปลี่ยนครั้งแรก</div>
   </section>
   ${issuedCredentials.length?`<section class="card stack"><h3>รหัสชั่วคราวจากการสร้างบัญชีครั้งล่าสุด (${issuedCredentials.length})</h3>
    <p class="warn">แสดงเฉพาะในหน้านี้ และจะหายเมื่อออกจากเมนูหรือโหลดหน้าใหม่ ควรแจ้งรหัสแต่ละคนเป็นการส่วนตัว อย่าถ่ายภาพหรือแชร์ในกลุ่ม</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>นักเรียน</th><th>Username</th><th>รหัสชั่วคราว</th></tr></thead>
     <tbody>${issuedCredentials.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.username)}</td><td><input aria-label="รหัสชั่วคราวของ ${esc(x.username)}" type="text" readonly autocomplete="off" value="${esc(x.temporary_password)}"></td></tr>`).join('')}</tbody></table></div>
    <button type="button" class="button secondary" id="portalClearCredentials">ปิดการแสดงรหัสชั่วคราว</button>
   </section>`:''}
   <section class="card stack"><h3>ผูกผู้ปกครองกับนักเรียน</h3>
    <div class="warn">ต้องตรวจสอบตัวตนและหลักฐานความสัมพันธ์จริงก่อนผูกสิทธิ์เมื่อใช้งานจริง ห้ามอนุญาตจากคำกล่าวอ้างเพียงอย่างเดียว</div>
    <form id="portalLink" class="stack"><div class="grid two">
     <div class="field"><label>บัญชีผู้ปกครอง</label><select name="guardian_account_id" required>${guardianOpts}</select></div>
     <div class="field"><label>นักเรียนในห้องที่เลือก</label><select name="student_id" required>${studentOpts}</select></div></div>
     <label><input name="verified" type="checkbox" required> ยืนยันว่าได้ตรวจสอบตัวตนและความสัมพันธ์ก่อนผูกบัญชี</label>
     <button type="submit" class="button full" ${guardians.length&&students.length?'':'disabled'}>ผูกบัญชีผู้ปกครองกับนักเรียน</button></form>
   </section>
   <section class="card stack"><h3>บัญชีที่ออกแล้ว (${accounts.length})</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>Username / ชื่อ</th><th>ประเภท</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
     <tbody>${accounts.map(a=>`<tr><td><strong>${esc(a.username)}</strong><div class="muted">${esc(a.display_name)}</div></td>
      <td>${a.role==='student'?'นักเรียน':'ผู้ปกครอง'}</td><td>${a.active?'ใช้งาน':'ระงับ'} ${a.must_change_password?'• ต้องเปลี่ยนรหัส':''}</td>
      <td><button type="button" class="button secondary" data-reset-portal="${a.id}">รีเซ็ต</button>
       <button type="button" class="button ghost" data-status-portal="${a.id}" data-active="${a.active?0:1}">${a.active?'ระงับ':'เปิดใช้'}</button></td></tr>`).join('')||'<tr><td colspan="4">ยังไม่มีบัญชี</td></tr>'}</tbody></table></div>
   </section>
   <section class="card stack"><h3>ผู้ปกครองที่ผูกกับนักเรียน (${links.length})</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>ผู้ปกครอง</th><th>นักเรียน</th><th>จัดการ</th></tr></thead>
     <tbody>${links.map(l=>`<tr><td>${esc(l.guardian_name)}</td><td>${esc(l.full_name)} <span class="muted">${esc(l.student_no)}</span></td>
      <td><button type="button" class="button ghost" data-unlink-guardian="${l.guardian_account_id}" data-unlink-student="${l.student_id}">เพิกถอนสิทธิ์</button></td></tr>`).join('')||'<tr><td colspan="3">ยังไม่มีการผูกบัญชี</td></tr>'}</tbody></table></div></section>
  </section>`);
  $('#portalAdminRoom')?.addEventListener('change',e=>safeRun(async()=>{roomId=Number(e.target.value);issuedCredentials=[];await load()}));
  $('#portalCreateStudent select[name="student_id"]')?.addEventListener('change',e=>{
   const student=students.find(s=>s.id===Number(e.target.value));
   if($('#selectedStudentNumber'))$('#selectedStudentNumber').value=student?.student_no||'';
  });
  $('#portalCreateStudent')?.addEventListener('submit',e=>safeRun(async()=>{
   e.preventDefault();const f=new FormData(e.currentTarget),button=e.currentTarget.querySelector('button');button.disabled=true;
   try{const r=await api('/api/admin/portal/accounts',{method:'POST',body:{role:'student',student_id:Number(f.get('student_id')),username:String(f.get('username')).trim(),...(f.get('password')?{password:String(f.get('password'))}:{})}});
    toast('สร้างบัญชีนักเรียนแล้ว');await load(r.temporary_password?{username:r.username,temporary_password:r.temporary_password}:null);
   }finally{if(button.isConnected)button.disabled=false}
  }));
  $('#portalBulkCreate')?.addEventListener('click',()=>safeRun(async()=>{
   if(!plan.ready.length)return;
   if(!confirm('สร้างบัญชีนักเรียน '+plan.ready.length+' คน โดยใช้เลขประจำตัวนักเรียนเป็น Username และสุ่มรหัสชั่วคราวแยกรายคน?'))return;
   const button=$('#portalBulkCreate'),status=$('#portalBulkProgress');
   button.disabled=true;issuedCredentials=[];
   let errors=[];
   try{
    for(const [i,s] of plan.ready.entries()){
     if(status)status.textContent='กำลังสร้างบัญชี '+(i+1)+' / '+plan.ready.length+' : '+s.student_no;
     try{
      const r=await api('/api/admin/portal/accounts',{method:'POST',body:{role:'student',student_id:s.student_id}});
      issuedCredentials.push({full_name:s.full_name,username:r.username,temporary_password:r.temporary_password});
     }catch(error){errors.push(s.student_no+': '+error.message)}
    }
    toast('สร้างสำเร็จ '+issuedCredentials.length+' คน'+(errors.length?' / ไม่สำเร็จ '+errors.length+' คน':''));
    await load();
    if(errors.length)$('#portalBulkProgress').textContent='สร้างไม่สำเร็จ: '+errors.join(' | ');
   }finally{if(button.isConnected)button.disabled=false}
  }));
  $('#portalClearCredentials')?.addEventListener('click',()=>{issuedCredentials=[];render()});
  $('#portalCreateGuardian')?.addEventListener('submit',e=>safeRun(async()=>{
   e.preventDefault();const f=new FormData(e.currentTarget),button=e.currentTarget.querySelector('button');button.disabled=true;
   try{const r=await api('/api/admin/portal/accounts',{method:'POST',body:{role:'guardian',display_name:String(f.get('display_name')),username:String(f.get('username'))}});
    toast('สร้างบัญชีผู้ปกครองแล้ว');await load({username:r.username,temporary_password:r.temporary_password});
   }finally{if(button.isConnected)button.disabled=false}
  }));
  $('#portalLink')?.addEventListener('submit',e=>safeRun(async()=>{
   e.preventDefault();const f=new FormData(e.currentTarget),button=e.currentTarget.querySelector('button');
   if(f.get('verified')!=='on')throw Error('ต้องยืนยันการตรวจสอบตัวตนก่อน');
   if(!confirm('ตรวจสอบความสัมพันธ์เรียบร้อย และยืนยันให้ผู้ปกครองดูข้อมูลนักเรียนคนนี้?'))return;
   button.disabled=true;
   try{await api('/api/admin/portal/links',{method:'POST',body:{
    guardian_account_id:Number(f.get('guardian_account_id')),student_id:Number(f.get('student_id')),identity_verified:true}});
    toast('ผูกสิทธิ์สำเร็จ');await load();
   }finally{if(button.isConnected)button.disabled=false}
  }));
  document.querySelectorAll('[data-reset-portal]').forEach(b=>b.addEventListener('click',()=>safeRun(async()=>{
   if(!confirm('รีเซ็ตรหัสผ่านบัญชีนี้และให้ออกจากระบบทุกอุปกรณ์?'))return;
   b.disabled=true;
   try{const id=Number(b.dataset.resetPortal);
    const account=accounts.find(a=>a.id===id);
    const r=await api('/api/admin/portal/accounts/'+id+'/reset',{method:'POST',body:{}});
    toast('รีเซ็ตรหัสผ่านสำเร็จ');await load({username:account.username,temporary_password:r.temporary_password});
   }finally{if(b.isConnected)b.disabled=false}
  })));
  document.querySelectorAll('[data-status-portal]').forEach(b=>b.addEventListener('click',()=>safeRun(async()=>{
   if(!confirm('ยืนยันการเปลี่ยนสถานะบัญชี? เซสชันเดิมจะถูกยกเลิก'))return;
   b.disabled=true;
   try{await api('/api/admin/portal/accounts/'+b.dataset.statusPortal+'/status',{
    method:'POST',body:{active:Number(b.dataset.active)}});toast('ปรับสถานะแล้ว');await load();
   }finally{if(b.isConnected)b.disabled=false}
  })));
  document.querySelectorAll('[data-unlink-guardian]').forEach(b=>b.addEventListener('click',()=>safeRun(async()=>{
   if(!confirm('เพิกถอนสิทธิ์ผู้ปกครองในการดูข้อมูลนักเรียนคนนี้?'))return;
   b.disabled=true;
   try{await api('/api/admin/portal/links/'+b.dataset.unlinkGuardian+'/'+b.dataset.unlinkStudent+'/revoke',
     {method:'POST',body:{}});toast('เพิกถอนสิทธิ์แล้ว');await load();
   }finally{if(b.isConnected)b.disabled=false}
  })));
 }
 return {load};
}
