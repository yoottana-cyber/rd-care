// RD CONNECT settings console. Reuses the existing school APIs and advisor-import workflow.
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const adminTabs=[
 {id:'overview',label:'ภาพรวม',icon:'◫'},
 {id:'people',label:'บัญชีบุคลากร',icon:'♙'},
 {id:'teaching',label:'ครูและตารางสอน',icon:'▤'},
 {id:'import',label:'นำเข้าข้อมูล',icon:'⇩'}
];
export function adminMetrics(users,rooms){
 const staff=users.filter(u=>['teacher','staff'].includes(u.role));
 return {users:users.length,teachers:staff.filter(u=>u.role==='teacher'&&u.active).length,
  rooms:rooms.length,advisors:rooms.filter(r=>r.advisor_user_id).length,
  inactive:staff.filter(u=>!u.active).length};
}
const roleText={teacher:'ครูผู้สอน',staff:'กิจการนักเรียน',admin:'ผู้ดูแลระบบ'};
export function createAdminSettings({api,mount,safeRun,toast,getUsers,getRooms,
 reload,refreshRooms,clearStudentCache,advisorImporter,parseCsv,periodChoices,navigate}){
 let tab='overview',editUserId=null,search='',filterRole='all',filterStatus='all';
 const users=()=>getUsers()||[],rooms=()=>getRooms()||[];
 const roomsHtml=()=>rooms().map(r=>`<option value="${r.id}">${safe(r.label)}</option>`).join('');
 const teachersHtml=()=>users().filter(u=>u.active&&u.role==='teacher')
  .map(u=>`<option value="${u.id}">${safe(u.display_name)} (@${safe(u.username)})</option>`).join('');
 const panel=(icon,title,subtitle)=>`<div class="rd-settings-panel-head">
  <span class="rd-settings-panel-symbol" aria-hidden="true">${icon}</span>
  <div><h3>${title}</h3><p>${subtitle}</p></div></div>`;
 const jump=(id,title)=>`<button type="button" class="rd-settings-link" data-settings-go="${id}">${title}<span aria-hidden="true">›</span></button>`;
 function overview(){
  const m=adminMetrics(users(),rooms());
  return `<div class="rd-settings-content"><div class="rd-settings-section-heading">
   <div><h3>ภาพรวมการจัดการ</h3><p>เลือกหมวดงานเพื่อดูรายละเอียดและแก้ไขข้อมูล</p></div></div>
   <div class="rd-settings-feature-grid">
    <article class="rd-settings-feature"><span aria-hidden="true">👥</span><h4>บัญชีครูและบุคลากร</h4>
     <p>เพิ่มบัญชี ค้นหาและแก้ไขข้อมูล หรือจัดการสถานะผู้ใช้งาน</p>${jump('people','จัดการบุคลากร')}</article>
    <article class="rd-settings-feature"><span aria-hidden="true">📚</span><h4>โครงสร้างการสอน</h4>
     <p>กำหนดครูที่ปรึกษาและเพิ่มรายวิชาตามห้องเรียนและช่วงคาบ</p>${jump('teaching','จัดการการสอน')}</article>
    <article class="rd-settings-feature"><span aria-hidden="true">📥</span><h4>ศูนย์นำเข้าข้อมูล</h4>
     <p>นำเข้านักเรียน CSV หรือครูที่ปรึกษาจาก Excel / CSV</p>${jump('import','นำเข้าข้อมูล')}</article>
   </div>
   <div class="rd-settings-notice"><strong>สิ่งที่ควรตรวจสอบ</strong>
    <p>ยังไม่ได้กำหนดครูที่ปรึกษา <b>${m.rooms-m.advisors}</b> ห้อง
    · พักบัญชีบุคลากร <b>${m.inactive}</b> บัญชี</p></div></div>`;
 }
 function people(){
  const person=users().find(u=>u.id===editUserId&&['teacher','staff'].includes(u.role));
  return `<div class="rd-settings-content"><div class="rd-settings-section-heading">
   <div><h3>บัญชีครูและบุคลากร</h3><p>สร้างบัญชีใหม่และจัดการบุคลากรอย่างเป็นระบบ</p></div>
   <span class="rd-settings-counter">${users().length} บัญชี</span></div>
   <div class="rd-settings-people-grid">
    <section class="rd-settings-panel">${panel('＋','เพิ่มบัญชีใหม่','ครูผู้สอนและฝ่ายกิจการนักเรียน')}
     <form id="addUser" class="rd-settings-form">
      <div class="field"><label for="staffUsername">ชื่อเข้าสู่ระบบ (Username)</label>
       <input id="staffUsername" name="username" autocomplete="off" pattern="[A-Za-z0-9._-]+" minlength="3" maxlength="40" placeholder="เช่น teacher01" required>
       <small>ใช้อักษรอังกฤษ ตัวเลข จุด หรือขีดกลาง</small></div>
      <div class="field"><label for="staffDisplay">ชื่อที่แสดง</label>
       <input id="staffDisplay" name="display_name" maxlength="100" placeholder="ชื่อ–สกุล" autocomplete="off" required></div>
      <div class="field"><label for="staffRole">บทบาท</label><select name="role" id="staffRole">
       <option value="teacher">ครูผู้สอน</option><option value="staff">ฝ่ายกิจการนักเรียน</option></select></div>
      <div class="field"><label for="staffPassword" id="staffPasswordLabel">รหัสผ่านชั่วคราว (อย่างน้อย 4 ตัว)</label>
       <input id="staffPassword" name="password" type="password" minlength="4" maxlength="128" autocomplete="new-password" required>
       <small>แนะนำรหัสผ่านที่คาดเดายากและไม่ซ้ำ</small></div>
      <button class="button full" type="submit">＋ สร้างบัญชี</button>
     </form></section>
    <section class="rd-settings-panel rd-settings-roster">${panel('♙','รายชื่อบุคลากร','ค้นหาและแก้ไขบัญชี')}
     <div class="rd-settings-filters">
      <div class="field"><label for="settingsSearch">ค้นหาชื่อหรือ Username</label>
       <input type="search" id="settingsSearch" placeholder="ค้นหาบุคลากร" value="${safe(search)}"></div>
      <div class="field"><label for="settingsRoleFilter">บทบาท</label>
       <select id="settingsRoleFilter"><option value="all" ${filterRole==='all'?'selected':''}>ทุกบทบาท</option>
       <option value="teacher" ${filterRole==='teacher'?'selected':''}>ครู</option>
       <option value="staff" ${filterRole==='staff'?'selected':''}>กิจการนักเรียน</option>
       <option value="admin" ${filterRole==='admin'?'selected':''}>ผู้ดูแลระบบ</option></select></div>
      <div class="field"><label for="settingsStatusFilter">สถานะ</label>
       <select id="settingsStatusFilter"><option value="all" ${filterStatus==='all'?'selected':''}>ทั้งหมด</option>
       <option value="active" ${filterStatus==='active'?'selected':''}>ใช้งาน</option>
       <option value="inactive" ${filterStatus==='inactive'?'selected':''}>พักบัญชี</option></select></div>
     </div>
     <p class="rd-settings-filter-count" id="settingsResultCount" role="status"></p>
     <div class="table-wrap"><table class="table rd-settings-table"><thead>
      <tr><th>ชื่อ / Username</th><th>บทบาท</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
      ${users().map(u=>`<tr data-settings-user data-name="${safe((u.display_name+' '+u.username).toLocaleLowerCase())}"
       data-role="${u.role}" data-status="${u.active?'active':'inactive'}">
       <td><div class="rd-settings-person"><span aria-hidden="true" class="rd-settings-avatar">${safe(u.display_name?.charAt(0)||'ค')}</span>
       <div><strong>${safe(u.display_name)}</strong><small>@${safe(u.username)}</small></div></div></td>
       <td>${safe(roleText[u.role]||u.role)}</td><td><span class="rd-settings-status ${u.active?'on':'off'}">${u.active?'ใช้งาน':'พักบัญชี'}</span></td>
       <td>${['teacher','staff'].includes(u.role)?`<button type="button" class="button secondary"
        data-edit-user="${u.id}">แก้ไข</button>
        <button type="button" class="button danger" data-remove-user="${u.id}">ลบบัญชี</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="4">ยังไม่มีข้อมูล</td></tr>'}
     </tbody></table></div></section>
   </div>
   ${person?`<section class="rd-settings-panel rd-settings-person-edit" id="settingsPersonEdit">
     ${panel('✎','แก้ไขข้อมูลบุคลากร','Username: '+safe(person.username))}
     <form id="adminPersonnelEdit" class="rd-settings-form">
      <div class="rd-settings-fields-two"><div class="field"><label for="editStaffName">ชื่อที่แสดง</label>
       <input id="editStaffName" name="display_name" maxlength="100" value="${safe(person.display_name)}" required></div>
      <div class="field"><label for="editStaffActive">สถานะบัญชี</label><select id="editStaffActive" name="active">
       <option value="1" ${person.active?'selected':''}>ใช้งาน</option>
       <option value="0" ${person.active?'':'selected'}>ระงับการใช้งาน</option></select></div></div>
      ${person.role==='teacher'?`<div class="field rd-affairs-permission">
         <label for="editStudentAffairs"><input id="editStudentAffairs" type="checkbox" name="student_affairs"
          ${Number(person.student_affairs)===1?'checked':''}>
          <strong>มอบหมายสิทธิ์ฝ่ายกิจการนักเรียน</strong></label>
         <small>ครูจะเข้าหน้าและใช้งาน API ฝ่ายกิจการนักเรียนได้ โดยยังคงบทบาทครูผู้สอนและครูที่ปรึกษาเดิม</small>
        </div>`:'<p class="rd-settings-field-hint">บัญชีฝ่ายกิจการนักเรียนได้รับสิทธิ์นี้ตามบทบาทที่กำหนด</p>'}
       <p class="rd-settings-field-hint">การระงับบัญชีจะยกเลิก Session ของบุคลากรทันที แต่ยังเก็บประวัติไว้</p>
      <div class="rd-settings-actions"><button class="button" type="submit">บันทึกการเปลี่ยนแปลง</button>
       <button class="button ghost" type="button" id="cancelSettingsEdit">ยกเลิก</button></div>
     </form></section>`:''}
  </div>`;
 }
 function teaching(){
  const disabled=!rooms().length||!teachersHtml();
  return `<div class="rd-settings-content"><div class="rd-settings-section-heading">
   <div><h3>โครงสร้างการสอน</h3><p>แบ่งงานครูที่ปรึกษาออกจากการกำหนดผู้สอนรายคาบ</p></div></div>
   <div class="rd-settings-teaching-grid">
    <section class="rd-settings-panel">${panel('🏫','กำหนดครูที่ปรึกษา','เลือกห้องเรียนและครูผู้รับผิดชอบ')}
     <form id="assignAdvisor" class="rd-settings-form">
      <div class="field"><label for="advisorRoom">ห้องเรียน</label>
       <select id="advisorRoom" name="classroom_id" required>${roomsHtml()}</select></div>
      <div class="field"><label for="advisorTeacher">ครูที่ปรึกษา</label>
       <select id="advisorTeacher" name="teacher_user_id" required>${teachersHtml()}</select></div>
      <p class="rd-settings-field-hint">ตรวจสอบห้องและครูที่รับผิดชอบก่อนบันทึก</p>
      <button class="button full" type="submit" ${disabled?'disabled':''}>บันทึกครูที่ปรึกษา</button></form></section>
    <section class="rd-settings-panel">${panel('▤','เพิ่มตารางสอนรายคาบ','ตั้งรายวิชา ผู้สอน วัน และช่วงคาบ')}
     <form id="addSlot" class="rd-settings-form">
      <div class="rd-settings-fields-two">
       <div class="field"><label for="slotRoom">ห้องเรียน</label><select id="slotRoom" name="classroom_id">${roomsHtml()}</select></div>
       <div class="field"><label for="slotTeacher">ครูผู้สอน</label><select id="slotTeacher" name="teacher_user_id">${teachersHtml()}</select></div>
       <div class="field"><label for="slotWeekday">วันสอน</label><select id="slotWeekday" name="day_of_week">
       ${['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'].map((d,i)=>`<option value="${i+1}">${d}</option>`).join('')}</select></div>
       <div class="field"><label for="slotPeriod">คาบสอน</label><select id="slotPeriod" name="period_range">
        ${periodChoices.map(p=>`<option value="${p}">${p}</option>`).join('')}</select></div>
       <div class="field"><label for="slotCode">รหัสวิชา</label><input name="subject_code" id="slotCode" maxlength="30" placeholder="เช่น ว22103" required></div>
       <div class="field"><label for="slotSubject">ชื่อวิชา</label><input name="subject" id="slotSubject" maxlength="120" placeholder="เช่น วิทยาการคำนวณ" required></div>
      </div><p class="rd-settings-field-hint">รองรับคาบเดี่ยวและคู่ 1, 1-2, 2, 2-3 จนถึงคาบ 10 และตรวจคาบซ้อนให้อัตโนมัติ</p>
      <button type="submit" class="button full" ${disabled?'disabled':''}>＋ เพิ่มคาบเรียน</button></form></section>
   </div><div class="rd-settings-notice">ครูสามารถเพิ่มตารางสอนได้เองโดยไม่รอ Admin อนุมัติ ระบบตรวจคาบซ้อนของครูและห้องก่อนบันทึก และ Admin ใช้เมนู “ตรวจสอบตารางสอน” เพื่อดูภาพรวม</div></div>`;
 }
 function imports(){
  return `<div class="rd-settings-content"><div class="rd-settings-section-heading">
   <div><h3>ศูนย์นำเข้าข้อมูล</h3><p>แยกประเภทไฟล์และตรวจสอบความถูกต้องก่อนบันทึก</p></div></div>
   <div class="rd-settings-import-grid">
    <section class="rd-settings-panel">${panel('🎓','นำเข้าทะเบียนนักเรียน','ใช้เมนูเดียวกับศูนย์ทะเบียน ไม่มีฟอร์มซ้ำ')}
     <p class="rd-settings-field-hint">นำเข้าจาก Excel/CSV ทั้งโรงเรียน: รายการเดิมจะอัปเดตตามเลขประจำตัวนักเรียน แถวผิดพลาดจะข้ามและแสดงเหตุผล โดยไม่ย้ายห้องหรือเปลี่ยนประวัติเช็กชื่อเอง</p>
     <p class="rd-settings-field-hint">ตรวจความถูกต้องและการคุ้มครองข้อมูลส่วนบุคคลก่อนนำเข้า ห้ามเผยแพร่ไฟล์ที่มีข้อมูลนักเรียนหรือรหัสผ่าน</p>
     <button type="button" class="button full" id="openStudentRosterImport">เปิดศูนย์ทะเบียนและนำเข้านักเรียน</button>
    </section>
    <div id="advisorImportHolder" class="rd-settings-advisor-import"></div>
   </div></div>`;
 }
 const layout=()=>{const m=adminMetrics(users(),rooms());
  const statItems=[['◉','บัญชีทั้งหมด',m.users],['♙','ครูที่ใช้งาน',m.teachers],['▦','ห้องเรียน',m.rooms],['✓','มีครูที่ปรึกษา',m.advisors]];
  return `<section class="rd-settings">
   <header class="rd-settings-hero"><div><span>RD CONNECT · ADMINISTRATION</span>
    <h2>ศูนย์จัดการระบบ</h2><p>จัดการบัญชีครู ห้องเรียน ตารางสอน และการนำเข้าข้อมูลในที่เดียว</p></div>
    <div class="rd-settings-hero-icon" aria-hidden="true">⚙</div></header>
   <div class="rd-settings-stats">${statItems.map(([icon,label,value])=>`<div class="rd-settings-stat">
    <span aria-hidden="true">${icon}</span><div><small>${label}</small><strong>${value.toLocaleString('th-TH')}</strong></div></div>`).join('')}</div>
   <nav class="rd-settings-tabs" aria-label="หมวดตั้งค่าระบบ">
    ${adminTabs.map(t=>`<button type="button" data-settings-go="${t.id}" class="${tab===t.id?'active':''}"
      ${tab===t.id?'aria-current="page"':''}><span aria-hidden="true">${t.icon}</span>${t.label}</button>`).join('')}</nav>
   ${tab==='people'?people():tab==='teaching'?teaching():tab==='import'?imports():overview()}
   </section>`;
 };
 function applyFilters(){
  const query=search.trim().toLocaleLowerCase();let count=0;
  document.querySelectorAll('[data-settings-user]').forEach(row=>{
   const show=(!query||row.dataset.name.includes(query))&&(filterRole==='all'||row.dataset.role===filterRole)&&
    (filterStatus==='all'||row.dataset.status===filterStatus);
   row.hidden=!show;if(show)count++;
  });
  const label=document.querySelector('#settingsResultCount');
  if(label)label.textContent='แสดง '+count+' จาก '+users().length+' บัญชี';
 }
 function onSubmit(id,action,message){
  const form=document.getElementById(id);
  form?.addEventListener('submit',event=>{
   event.preventDefault();
   safeRun(async()=>{
    const button=form.querySelector('button[type="submit"]');
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
     const saved=await action(new FormData(form));
     if(saved===false)return;
     toast(message);await reload();
    }finally{if(button?.isConnected)button.disabled=false}
   });
  });
 }
 function bindPeople(){
  const role=document.querySelector('#staffRole'),password=document.querySelector('#staffPassword');
  const sync=()=>{
   if(!role||!password)return;
   password.minLength=role.value==='teacher'?4:12;
   const label=document.querySelector('#staffPasswordLabel');
   if(label)label.textContent='รหัสผ่านชั่วคราว (อย่างน้อย '+password.minLength+' ตัว)';
  };role?.addEventListener('change',sync);sync();
  document.querySelector('#settingsSearch')?.addEventListener('input',e=>{search=e.target.value;applyFilters()});
  document.querySelector('#settingsRoleFilter')?.addEventListener('change',e=>{filterRole=e.target.value;applyFilters()});
  document.querySelector('#settingsStatusFilter')?.addEventListener('change',e=>{filterStatus=e.target.value;applyFilters()});
  applyFilters();
  document.querySelectorAll('[data-edit-user]').forEach(button=>button.addEventListener('click',()=>{
   editUserId=Number(button.dataset.editUser);render();
   document.querySelector('#settingsPersonEdit')?.scrollIntoView({behavior:'smooth',block:'center'});
  }));
  document.querySelector('#cancelSettingsEdit')?.addEventListener('click',()=>{editUserId=null;render()});
  document.querySelectorAll('[data-remove-user]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   const person=users().find(u=>u.id===Number(button.dataset.removeUser));
   if(!person||person.role==='admin')return;
   const entered=window.prompt('ลบบัญชี '+person.display_name+'?\\nระบบจะยกเลิกสิทธิ์และเก็บประวัติการสอนไว้\\nพิมพ์ Username เพื่อยืนยัน:','');
   if(entered===null)return;
   if(entered!==person.username)throw Error('Username ไม่ตรงกัน');
   button.disabled=true;
   try{
    await api('/api/admin/users/'+person.id+'/delete',{method:'POST',body:{confirm:entered}});
    toast('ลบบัญชีออกจากการใช้งานแล้ว โดยเก็บประวัติการสอนไว้');
    editUserId=null;await reload();
   }finally{if(button.isConnected)button.disabled=false}
  })));

  onSubmit('adminPersonnelEdit',async f=>{
   const u=users().find(u=>u.id===editUserId);
   if(!u)throw Error('ไม่พบบัญชี');
   const active=Number(f.get('active'));
   if(!active&&!confirm('ระงับบัญชี '+u.display_name+' และยกเลิก Session ทุกอุปกรณ์?'))return false;
   await api('/api/admin/users/'+u.id,{method:'POST',body:{
     display_name:String(f.get('display_name')).trim(),active,
     ...(u.role==='teacher'?{student_affairs:f.get('student_affairs')==='on'}:{})
    }});
   editUserId=null;return true;
  },'บันทึกข้อมูลบุคลากรสำเร็จ');
  onSubmit('addUser',async f=>{
   await api('/api/admin/users',{method:'POST',body:{
    username:String(f.get('username')).trim(),display_name:String(f.get('display_name')).trim(),
    password:String(f.get('password')),role:f.get('role')}});
   return true;
  },'สร้างบัญชีสำเร็จ');
 }
 function bindTeaching(){
  onSubmit('assignAdvisor',async f=>{
   await api('/api/admin/advisor',{method:'POST',body:{
    classroom_id:Number(f.get('classroom_id')),teacher_user_id:Number(f.get('teacher_user_id'))}});
   await refreshRooms();return true;
  },'บันทึกครูที่ปรึกษาสำเร็จ');
  onSubmit('addSlot',async f=>{
   const periods=String(f.get('period_range')).split('-').map(Number);
   await api('/api/admin/timetable',{method:'POST',body:{
    classroom_id:Number(f.get('classroom_id')),teacher_user_id:Number(f.get('teacher_user_id')),
    day_of_week:Number(f.get('day_of_week')),period:periods[0],end_period:periods[1]||periods[0],
    subject_code:String(f.get('subject_code')).trim(),subject:String(f.get('subject')).trim()}});
   return true;
  },'เพิ่มตารางสอนแล้ว');
 }
 function bindImports(){
  document.querySelector('#openStudentRosterImport')?.addEventListener('click',()=>navigate?.('adminStudents'));
  advisorImporter.render(document.querySelector('#advisorImportHolder'));
 }
  function render(){
  mount(layout());
  document.querySelectorAll('[data-settings-go]').forEach(button=>button.addEventListener('click',()=>{
   const target=button.dataset.settingsGo;
   if(!adminTabs.some(x=>x.id===target)||tab===target)return;
   tab=target;editUserId=null;render();
   document.querySelector('.rd-settings')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  if(tab==='people')bindPeople();
  if(tab==='teaching')bindTeaching();
  if(tab==='import')bindImports();
 }
 return {render,open:id=>{if(adminTabs.some(t=>t.id===id))tab=id;render()}};
}
