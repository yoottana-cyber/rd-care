// Guardian push notifications are available only after direct consent on a
// school-verified guardian account. No background auto-enrollment.
const standalone=()=>matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
const supported=()=>window.isSecureContext&&'serviceWorker'in navigator&&
  'PushManager'in window&&'Notification'in window;
const keyBytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')
  .padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
export function createGuardianPush({call,select,message}){
 async function subscription(){
  if(!supported())return null;
  const registration=await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
 }
 async function refresh(){
  const target=select('#guardianPushStatus'),enable=select('#guardianPushEnable');
  if(!target)return;
  if(!supported()){
   target.textContent='อุปกรณ์นี้ยังไม่รองรับ Push';if(enable)enable.disabled=true;return;
  }
  try{
   const [config,sub]=await Promise.all([call('/api/portal/push/config'),subscription()]);
   const owned=sub?await call('/api/portal/push/status',{method:'POST',body:{endpoint:sub.endpoint}}):{subscribed:false};
   target.textContent=!config.enabled?'เซิร์ฟเวอร์ยังไม่พร้อมส่ง Push':
    Notification.permission==='denied'?'ต้องอนุญาตการแจ้งเตือนจากการตั้งค่าอุปกรณ์':
    owned.subscribed?'อุปกรณ์นี้เปิดรับ Push ผู้ปกครองแล้ว':'ยังไม่ได้เปิดรับ Push สำหรับบัญชีผู้ปกครองนี้';
   if(enable)enable.disabled=!config.enabled||Notification.permission==='denied'||!!owned.subscribed;
   const disable=select('#guardianPushDisable');if(disable)disable.disabled=!owned.subscribed;
  }catch(error){target.textContent='ยังตรวจสอบการแจ้งเตือนไม่ได้'}
 }
 async function enable(){
  if(!supported())throw Error('เบราว์เซอร์นี้ไม่รองรับ Push');
  if(/iPad|iPhone|iPod/.test(navigator.userAgent)&&!standalone())
   throw Error('iPhone ต้องเพิ่ม RD Care ไปหน้าจอโฮมใน Safari และเปิดจากไอคอนก่อน');
  // Called before the first await from the click handler: preserves user gesture.
  const permitted=await Notification.requestPermission();
  if(permitted!=='granted')throw Error('ยังไม่ได้อนุญาตการแจ้งเตือน');
  const config=await call('/api/portal/push/config');
  if(!config.enabled||!config.publicKey)throw Error('เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า VAPID');
  const registration=await navigator.serviceWorker.ready;
  let sub=await registration.pushManager.getSubscription();
  const wasNew=!sub;
  if(!sub)sub=await registration.pushManager.subscribe({
   userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)
  });
  try{await call('/api/portal/push/subscribe',{method:'POST',body:sub.toJSON()})}
  catch(error){if(wasNew)await sub.unsubscribe().catch(()=>{});throw error}
  message('เปิดรับ Push สำหรับผู้ปกครองบนอุปกรณ์นี้แล้ว');
  await refresh();
 }
 async function disable({silent=false}={}){
  const sub=await subscription();if(!sub)return;
  let problem=null;
  try{await call('/api/portal/push/unsubscribe',{method:'POST',body:{endpoint:sub.endpoint}})}
  catch(e){problem=e}
  await sub.unsubscribe().catch(()=>{});
  if(problem&&!silent)throw problem;
  if(!silent){message('ปิดรับ Push อุปกรณ์นี้แล้ว');await refresh()}
 }
 function bind(){
  select('#guardianPushEnable')?.addEventListener('click',()=>{
   // Do not wrap enable() inside an awaited task or timeout before permission prompt.
   enable().catch(error=>message(error.message,true));
  });
  select('#guardianPushDisable')?.addEventListener('click',()=>{
   disable().catch(error=>message(error.message,true));
  });
  refresh();
 }
 return {bind,disable};
}
