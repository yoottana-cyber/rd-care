// First-use, consent-based Push invitation. Permission is requested ONLY from
// the direct user click. Browser and iOS home-screen rules are never bypassed.
const standalone=()=>{try{return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch{return false}};
const mobile=()=>{try{return standalone()||matchMedia('(max-width: 768px)').matches}catch{return false}};
const ios=()=>/iPad|iPhone|iPod/i.test(navigator.userAgent);
const storageKey=(role,id)=>'rd-push-intro-v1:'+role+':'+id+':'+(standalone()?'app':'web');

export function shouldOfferPushIntro({role,id,storage=localStorage,isMobile=mobile}){
 if(!['staff','guardian','student'].includes(role)||!id||!isMobile())return false;
 try{return storage.getItem(storageKey(role,id))!=='seen'}catch{return true}
}
export async function offerPushIntro({role,id,check,enable,isCurrent=()=>true}){
 if(!shouldOfferPushIntro({role,id})||document.querySelector('[data-rd-push-intro]'))return false;
 if(typeof check!=='function'||typeof enable!=='function')return false;
 const account=id;
 const state=await check().catch(()=>null);
 if(!state||!isCurrent()||!shouldOfferPushIntro({role,id:account})||
  document.querySelector('[data-rd-push-intro]'))return false;
 const needsInstall=ios()&&!standalone();
 if(state.subscribed||state.permission==='denied'||
  (!state.enabled&&!needsInstall)||(!state.canPush&&!needsInstall))return false;
 const label=role==='guardian'?'ผู้ปกครอง':role==='student'?'นักเรียน':'ครูและบุคลากร';
 const el=document.createElement('section');
 el.dataset.rdPushIntro=role;
 el.className='rd-push-intro';
 el.setAttribute('role','dialog');
 el.setAttribute('aria-modal','false');
 el.setAttribute('aria-label','เปิดการแจ้งเตือน RD CONNECT');
 el.innerHTML=`<div class="rd-push-intro-icon" aria-hidden="true">🔔</div>
  <div class="rd-push-intro-body"><strong>เปิดรับแจ้งเตือน RD CONNECT</strong>
  <p>${needsInstall?'บน iPhone ให้ติดตั้งจาก Safari ไปยังหน้าจอโฮม แล้วเปิดแอปจากไอคอนเพื่ออนุญาต Push':
    'เปิดรับแจ้งเตือนสำหรับ'+label+' เพื่อไม่พลาดรายการสำคัญ โดยไม่แสดงข้อมูลนักเรียนบนหน้าจอล็อก'}</p>
  <div class="rd-push-intro-actions">
   <button type="button" data-rd-push-accept>${needsInstall?'วิธีติดตั้งบน iPhone':'เปิดรับการแจ้งเตือน'}</button>
   <button type="button" data-rd-push-later>ไว้ภายหลัง</button>
  </div><p data-rd-push-error role="status" aria-live="polite" hidden></p></div>
  <button type="button" class="rd-push-intro-close" data-rd-push-close aria-label="ปิด">✕</button>`;
 document.body.append(el);
 const mark=()=>{
  try{localStorage.setItem(storageKey(role,id),'seen')}catch{}
  el.remove();
 };
 el.querySelector('[data-rd-push-close]').addEventListener('click',mark);
 el.querySelector('[data-rd-push-later]').addEventListener('click',mark);
 el.querySelector('[data-rd-push-accept]').addEventListener('click',()=>{
  if(needsInstall){
   const output=el.querySelector('[data-rd-push-error]');
   output.hidden=false;output.textContent='Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิด RD CONNECT จากไอคอน';
   return;
  }
  const button=el.querySelector('[data-rd-push-accept]');
  button.disabled=true;
  // IMPORTANT: call enable synchronously in this click event; it calls
  // Notification.requestPermission() before its first awaited operation.
  let operation;
  try{operation=enable()}catch(err){operation=Promise.reject(err)}
  Promise.resolve(operation).then(ok=>{
   if(ok===false){button.disabled=false;return}
   mark();
  }).catch(err=>{
   if(!el.isConnected)return;
   button.disabled=false;
   const output=el.querySelector('[data-rd-push-error]');
   output.hidden=false;output.textContent=String(err?.message||'ไม่สามารถเปิดแจ้งเตือนได้');
  });
 });
 return true;
}
