// Safe update checks for all three role-specific RD CONNECT home-screen apps.
// An existing authenticated form is never reloaded without the user's action.
const CHECK_INTERVAL_MS=15*60*1000;
export function showPwaUpdateNotice(doc=document,reload=()=>location.reload()){
 if(doc.getElementById('rdPwaUpdateNotice'))return;
 const host=doc.createElement('div');
 host.id='rdPwaUpdateNotice';
 host.className='rd-pwa-update-notice';
 host.setAttribute('role','status');
 host.setAttribute('aria-live','polite');
 host.innerHTML='<div class="rd-pwa-update-copy"><strong>RD CONNECT มีเวอร์ชันใหม่พร้อมใช้งาน</strong>'+
  '<span>บันทึกข้อมูลที่กำลังกรอกก่อนอัปเดต เพื่อไม่ให้ข้อมูลสูญหาย</span></div>'+
  '<div class="rd-pwa-update-actions"><button type="button" class="button" data-pwa-update-now>อัปเดตตอนนี้</button>'+
  '<button type="button" class="button secondary" data-pwa-update-later>ภายหลัง</button></div>';
 host.querySelector('[data-pwa-update-now]').addEventListener('click',reload);
 host.querySelector('[data-pwa-update-later]').addEventListener('click',()=>host.remove());
 doc.body.appendChild(host);
}
export async function registerPwaUpdates({
 navigatorRef=typeof navigator!=='undefined'?navigator:null,
 windowRef=typeof window!=='undefined'?window:null,
 documentRef=typeof document!=='undefined'?document:null,
 onUpdate=()=>showPwaUpdateNotice(),
 onError=()=>{}
}={}){
 if(!navigatorRef?.serviceWorker||!windowRef||!documentRef)return null;
 const location=windowRef.location;
 if(location.protocol!=='https:'&&
  !(location.hostname==='localhost'||location.hostname==='127.0.0.1'))return null;
 const serviceWorker=navigatorRef.serviceWorker;
 // Remember whether an older worker already controlled this page before
 // registration. First-time installs must not trigger a false update prompt.
 let hadController=Boolean(serviceWorker.controller);
 let notified=false;
 const handleControllerChange=()=>{
  if(!hadController){hadController=true;return}
  if(notified)return;
  notified=true;
  onUpdate();
 };
 serviceWorker.addEventListener('controllerchange',handleControllerChange);
 try{
  const registration=await serviceWorker.register('./sw.js',{updateViaCache:'none'});
  let lastCheck=0;
  const check=()=>{
   if(documentRef.visibilityState==='hidden'||navigatorRef.onLine===false)return;
   const current=Date.now();
   if(current-lastCheck<CHECK_INTERVAL_MS)return;
   lastCheck=current;
   Promise.resolve(registration.update()).catch(onError);
  };
  windowRef.addEventListener('online',()=>{
   lastCheck=0;check();
  });
  windowRef.addEventListener('pageshow',check);
  documentRef.addEventListener('visibilitychange',check);
  // Long-running open tabs should also pick up new releases without logout.
  const interval=windowRef.setInterval(check,CHECK_INTERVAL_MS);
  windowRef.addEventListener('pagehide',()=>windowRef.clearInterval(interval),{once:true});
  check();
  return registration;
 }catch(error){
  serviceWorker.removeEventListener?.('controllerchange',handleControllerChange);
  onError(error);
  return null;
 }
}
