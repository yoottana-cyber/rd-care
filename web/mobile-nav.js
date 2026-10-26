// Five touch-friendly mobile actions and an accessible overflow menu.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mobileMarkup({navs,user,active,pending=0}){
 const primary=user.role==='teacher'?'periodAttendance':'attendance';
 const jobs=user.role==='teacher'?'advisorCenter':'alerts';
 const buttons=[['dashboard','ภาพรวม','▦'],['notifications','แจ้งเตือน','♧'],
 [primary,'เช็กชื่อ','◎'],[jobs,'งานตรวจสอบ','☑']];
 const bottom=`<nav class="rd-mobile-bar" aria-label="เมนูหลักบนมือถือ">
 ${buttons.map(([id,label,icon],i)=>`<button type="button" data-tab="${id}" class="${active(id)?'active':''} ${i===2?'rd-mobile-primary':''}" ${active(id)?'aria-current="page"':''}>
  <span class="rd-mobile-icon" aria-hidden="true">${icon}</span>
  <span class="rd-mobile-label">${label}</span>
  ${id==='notifications'&&pending>0?`<span class="rd-mobile-bubble" aria-label="รายการรอตรวจสอบ ${pending} รายการ">${pending>99?'99+':pending}</span>`:''}
 </button>`).join('')}
 <button type="button" id="rdOpenMobileMenu" aria-expanded="false" aria-controls="rdMobileSheet">
  <span class="rd-mobile-icon" aria-hidden="true">☰</span><span class="rd-mobile-label">เมนู</span></button>
 </nav>`;
 const all=[...navs,['notifications','แจ้งเตือน','🔔']];
 const sheet=`<div class="rd-mobile-shade" id="rdMobileShade" hidden></div>
 <section class="rd-mobile-sheet" id="rdMobileSheet" role="dialog" aria-modal="true" aria-labelledby="rdMobileSheetTitle" hidden>
  <div class="rd-mobile-sheet-heading"><strong id="rdMobileSheetTitle">เมนู RD Care</strong>
   <button type="button" id="rdCloseMobileMenu" aria-label="ปิดเมนู">✕</button></div>
  <div class="rd-mobile-account"><span class="rd-user-avatar" aria-hidden="true">${esc((user.display_name||'ค').trim().charAt(0))}</span>
   <div><strong>${esc(user.display_name)}</strong><p>โรงเรียนรัษฎา • RD Care</p></div></div>
  <div class="rd-mobile-sheet-grid">${all.map(([id,label,icon])=>
   `<button type="button" data-tab="${id}"><span aria-hidden="true">${icon}</span><span>${esc(label)}</span></button>`).join('')}</div>
  <p class="rd-mobile-sheet-note">ติดตั้ง RD Care ลงหน้าจอหลักและตั้งค่าการแจ้งเตือนที่เมนูนี้ได้</p>
  <div class="rd-mobile-sheet-actions">
   <button type="button" id="rdMenuInstall">⬇️ ติดตั้งแอป</button>
   <button type="button" data-tab="notifications">🔔 ตั้งค่าแจ้งเตือน</button>
   <button type="button" id="rdMenuTheme">◐ เปลี่ยนธีม</button>
   <button type="button" id="rdMenuLogout">ออกจากระบบ</button>
  </div>
 </section>`;
 return bottom+sheet;
}
export function bindMobileMenu({install,logout,safeRun}){
 const sheet=document.querySelector('#rdMobileSheet'),shade=document.querySelector('#rdMobileShade');
 const toggle=open=>{
  if(!sheet||!shade)return;
  sheet.hidden=!open;shade.hidden=!open;
  document.querySelector('#rdOpenMobileMenu')?.setAttribute('aria-expanded',String(open));
  if(open)document.querySelector('#rdCloseMobileMenu')?.focus();
 };
 document.querySelector('#rdOpenMobileMenu')?.addEventListener('click',()=>toggle(true));
 document.querySelector('#rdHeaderMenu')?.addEventListener('click',()=>toggle(true));
 document.querySelector('#rdCloseMobileMenu')?.addEventListener('click',()=>toggle(false));
 shade?.addEventListener('click',()=>toggle(false));
 sheet?.addEventListener('keydown',e=>{if(e.key==='Escape')toggle(false)});
 document.querySelector('#rdMenuInstall')?.addEventListener('click',()=>safeRun(install));
 document.querySelector('#rdMenuLogout')?.addEventListener('click',()=>safeRun(logout));
 document.querySelector('#rdMenuTheme')?.addEventListener('click',()=>document.querySelector('.top [data-theme-toggle]')?.click());
}
