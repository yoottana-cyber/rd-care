// Guardian push notifications are available only after direct consent on a
// school-verified guardian account. No background auto-enrollment.
const standalone=()=>matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
const supported=()=>window.isSecureContext&&'serviceWorker'in navigator&&
  'PushManager'in window&&'Notification'in window;
const keyBytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')
  .padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
export function createPortalPush({call,select,message,role='guardian'}){
 const student=role==='student';
 const base=student?'/api/portal/student-push':'/api/portal/push';
 const dom=id=>(student?'studentPush':'guardianPush')+id;
 async function subscription(){
  if(!supported())return null;
  const registration=await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
 }
 async function introStatus(){
  if(!supported())return {canPush:false,enabled:false,permission:'unsupported',subscribed:false};
  const [config,sub]=await Promise.all([call(base+'/config'),subscription()]);
  const owned=sub?await call(base+'/status',{method:'POST',body:{endpoint:sub.endpoint}}):{subscribed:false};
  return {canPush:true,enabled:config.enabled===true,
   permission:Notification.permission,subscribed:owned.subscribed===true};
 }
 async function refresh(){
  const target=select('#'+dom('Status')),enable=select('#'+dom('Enable'));
  if(!target)return;
  if(!supported()){
   target.textContent='อุปกรณ์นี้ยังไม่รองรับ Push';if(enable)enable.disabled=true;return;
  }
  try{
   const [config,sub]=await Promise.all([call(base+'/config'),subscription()]);
   const owned=sub?await call(base+'/status',{method:'POST',body:{endpoint:sub.endpoint}}):{subscribed:false};
   target.textContent=!config.enabled?'เซิร์ฟเวอร์ยังไม่พร้อมส่ง Push':
    Notification.permission==='denied'?'ต้องอนุญาตการแจ้งเตือนจากการตั้งค่าอุปกรณ์':
    owned.subscribed?'อุปกรณ์นี้เปิดรับ Push '+(student?'นักเรียน':'ผู้ปกครอง')+'แล้ว':'ยังไม่ได้เปิดรับ Push สำหรับบัญชี'+(student?'นักเรียน':'ผู้ปกครอง')+'นี้';
   if(enable)enable.disabled=!config.enabled||Notification.permission==='denied'||!!owned.subscribed;
   const disable=select('#'+dom('Disable'));if(disable)disable.disabled=!owned.subscribed;
   const test=select('#'+dom('Test'));if(test)test.disabled=!owned.subscribed||!config.enabled;
  }catch(error){target.textContent='ยังตรวจสอบการแจ้งเตือนไม่ได้'}
 }
 async function enable(){
  if(!supported())throw Error('เบราว์เซอร์นี้ไม่รองรับ Push');
  if(/iPad|iPhone|iPod/.test(navigator.userAgent)&&!standalone())
   throw Error('iPhone ต้องเพิ่ม RD CONNECT ไปหน้าจอโฮมใน Safari และเปิดจากไอคอนก่อน');
  // Called before the first await from the click handler: preserves user gesture.
  const permitted=await Notification.requestPermission();
  if(permitted!=='granted')throw Error('ยังไม่ได้อนุญาตการแจ้งเตือน');
  const config=await call(base+'/config');
  if(!config.enabled||!config.publicKey)throw Error('เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า VAPID');
  const registration=await navigator.serviceWorker.ready;
  let sub=await registration.pushManager.getSubscription();
  const wasNew=!sub;
  if(!sub)sub=await registration.pushManager.subscribe({
   userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)
  });
  try{await call(base+'/subscribe',{method:'POST',body:sub.toJSON()})}
  catch(error){if(wasNew)await sub.unsubscribe().catch(()=>{});throw error}
  message('เปิดรับ Push สำหรับ'+(student?'นักเรียน':'ผู้ปกครอง')+'บนอุปกรณ์นี้แล้ว');
  await refresh();
 }
 async function disable({silent=false}={}){
  const sub=await subscription();if(!sub)return;
  // A registration can be shared by multiple portal logins on this origin.
  // Never unsubscribe the browser if this account does not own the endpoint.
  const owned=await call(base+'/status',{method:'POST',body:{endpoint:sub.endpoint}})
   .catch(error=>{if(silent)return null;throw error});
  if(!owned?.subscribed)return;
  await call(base+'/unsubscribe',{method:'POST',body:{endpoint:sub.endpoint}});
  await sub.unsubscribe().catch(()=>{});
  if(!silent){message('ปิดรับ Push อุปกรณ์นี้แล้ว');await refresh()}
 }
 async function testPush(){
  const sub=await subscription();
  if(!sub)throw Error('อุปกรณ์นี้ยังไม่ได้เปิดรับ Push');
  const result=await call(base+'/test',{method:'POST',body:{endpoint:sub.endpoint}});
  const errors={
   missing_settings:'Cloudflare Worker ยังตั้งค่ากุญแจ VAPID ไม่ครบ',
   invalid_subject:'VAPID_SUBJECT ไม่ถูกต้อง',
   invalid_keypair:'กุญแจ VAPID ไม่ถูกต้อง',
   keypair_mismatch:'กุญแจ VAPID Public/Private ไม่ใช่คู่เดียวกัน',
   device_not_registered:'บัญชีนี้ยังไม่ได้สมัครรับ Push บนอุปกรณ์นี้',
   provider_rejected:'ผู้ให้บริการ Push ปฏิเสธคำขอ (HTTP '+(result.providerStatus||'?')+')',
   network_or_crypto_error:'เครือข่ายหรือการเข้ารหัสแจ้งเตือนมีปัญหา'
  };
  const target=select('#'+dom('TestStatus'));
  if(target)target.textContent=result.accepted?
   'ผู้ให้บริการตอบรับ Push ทดสอบแล้ว โปรดตรวจสอบการแจ้งเตือนบนมือถือ':
   (errors[result.code]||'ส่ง Push ทดสอบไม่สำเร็จ');
 }
 function bind(){
  select('#'+dom('Test'))?.addEventListener('click',()=>testPush().catch(e=>{
   const output=select('#'+dom('TestStatus'));
   if(output)output.textContent=e.message;
  }));
  select('#'+dom('Enable'))?.addEventListener('click',()=>{
   // Do not wrap enable() inside an awaited task or timeout before permission prompt.
   enable().catch(error=>message(error.message,true));
  });
  select('#'+dom('Disable'))?.addEventListener('click',()=>{
   disable().catch(error=>message(error.message,true));
  });
  refresh();
 }
 return {bind,disable,enable,introStatus};
}

// Compatibility for existing guardian portal and tests.
export function createGuardianPush(args){return createPortalPush({...args,role:'guardian'})}
