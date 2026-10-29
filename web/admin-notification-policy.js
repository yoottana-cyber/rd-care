// Administrator schoolwide Push delivery switches (not device-level consent).
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createAdminNotificationPolicy({api,toast,safeRun}){
 let requestVersion=0;
 async function load(){
  const area=document.querySelector('#rdAdminPushPolicy');
  if(!area)return;
  const version=++requestVersion;
  area.innerHTML='<p class="muted" role="status">กำลังโหลดประเภทการแจ้งเตือน…</p>';
  const data=await api('/api/admin/notification-preferences');
  if(version!==requestVersion||!area.isConnected)return;
  const items=data.items||[],groups=[...new Set(items.map(x=>x.group))];
  area.innerHTML=`<div class="rd-admin-push-overview">
   <strong>การแจ้งเตือนที่เปิดอยู่: <span id="rdAdminPushEnabledCount">${items.filter(x=>x.enabled).length}</span> / ${items.length}</strong>
   <p>การปิดจะหยุดส่ง Push ประเภทนั้น แต่ข้อมูลนักเรียนและประวัติยังบันทึกตามปกติ</p>
   <p>เฉพาะอุปกรณ์ที่สมัครรับ Push ด้วยตนเองเท่านั้นที่จะรับแจ้งเตือนได้</p>
   </div>
   ${groups.map(group=>`<section class="rd-admin-push-group">
    <h4>${esc(group)}</h4>
    ${items.filter(x=>x.group===group).map(item=>`<label class="rd-admin-push-item">
      <span><strong>${esc(item.label)}</strong><small class="rd-admin-push-hint">${esc(item.key)}</small></span>
      <span class="rd-admin-push-switch">
       <input type="checkbox" data-push-policy="${esc(item.key)}" ${item.enabled?'checked':''}
        aria-label="เปิดหรือปิด ${esc(item.label)}">
       <span class="rd-admin-push-switch-track" aria-hidden="true"></span>
      </span>
     </label>`).join('')}
   </section>`).join('')}
   <p class="muted rd-admin-push-footnote">เมื่อตั้งค่ากลับเป็นเปิด ระบบจะส่งตามเหตุการณ์ใหม่ การแจ้งเตือนคะแนนจะไม่ส่งย้อนหลัง</p>`;
  area.querySelectorAll('[data-push-policy]').forEach(input=>input.addEventListener('change',()=>{
   safeRun(async()=>{
    const next=input.checked,previous=!next;
    input.disabled=true;
    try{
     await api('/api/admin/notification-preferences',{
      method:'POST',body:{key:input.dataset.pushPolicy,enabled:next}
     });
     const match=items.find(x=>x.key===input.dataset.pushPolicy);
     if(match)match.enabled=next;
     const counter=area.querySelector('#rdAdminPushEnabledCount');
     if(counter)counter.textContent=String(items.filter(x=>x.enabled).length);
     toast((next?'เปิด':'ปิด')+'การแจ้งเตือนรายการนี้แล้ว');
    }catch(e){input.checked=previous;throw e}
    finally{input.disabled=false}
   });
  }));
 }
 return {load};
}
