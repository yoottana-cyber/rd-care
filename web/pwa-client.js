// PWA install and opted-in account/device Web Push; does not request permission on page load.
let installPrompt=null;
if(typeof window!=='undefined'){
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;window.dispatchEvent(new Event('rd-pwa-install-ready'))});
 window.addEventListener('appinstalled',()=>{installPrompt=null;window.dispatchEvent(new Event('rd-pwa-install-ready'))});
}
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
const supported=()=>('serviceWorker'in navigator)&&('PushManager'in window)&&('Notification'in window)&&window.isSecureContext;
const decodeKey=value=>{
 const base64=value.replace(/-/g,'+').replace(/_/g,'/');
 const data=atob(base64.padEnd(Math.ceil(base64.length/4)*4,'='));
 return Uint8Array.from(data,c=>c.charCodeAt(0));
};
export function createPwaTools({api,toast}){
 async function sw(){return navigator.serviceWorker.ready;}
 async function check(){
  const installed=isStandalone(),canPush=supported(),permission=('Notification'in window)?Notification.permission:'unsupported';
  let remote={enabled:false,reason:'กรุณาเปิดอินเทอร์เน็ตก่อนสมัครรับแจ้งเตือน'};
  if(canPush)try{remote=await api('/api/push/config')}catch{}
  let subscribed=false;
  if(canPush)try{subscribed=Boolean(await (await sw()).pushManager.getSubscription())}catch{}
  return {installed,canInstall:Boolean(installPrompt),canPush,permission,subscribed,
   enabled:remote.enabled===true,publicKey:remote.publicKey||''};
 }
 async function install(){
  if(isStandalone()){toast('แอป RD CONNECT ติดตั้งไว้แล้ว');return}
  if(installPrompt){const p=installPrompt;installPrompt=null;await p.prompt();await p.userChoice;return}
  if(/iPad|iPhone|iPod/i.test(navigator.userAgent))toast('บน iPhone: เปิดผ่าน Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม');
  else toast('บน Android: เปิดเมนูเบราว์เซอร์ แล้วเลือก ติดตั้งแอป หรือ เพิ่มไปยังหน้าจอหลัก');
 }
 async function enable(){
  if(!supported()){toast('อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่รองรับ Push',true);return false}
  // iOS requires a home-screen app and a requestPermission in a direct user gesture.
  if(/iPad|iPhone|iPod/i.test(navigator.userAgent)&&!isStandalone()){
   toast('iPhone: โปรดเพิ่ม RD CONNECT ไปหน้าจอโฮมและเปิดจากไอคอนก่อนเปิดการแจ้งเตือน',true);return false;
  }
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){toast('ยังไม่ได้รับสิทธิ์การแจ้งเตือน สามารถเปิดได้จากตั้งค่าอุปกรณ์',true);return false}
  const config=await api('/api/push/config');
  if(!config.enabled||!config.publicKey){toast('ระบบ Push ยังไม่ตั้งค่ากุญแจ VAPID ที่เซิร์ฟเวอร์',true);return false}
  const registration=await sw();
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({
   userVisibleOnly:true,applicationServerKey:decodeKey(config.publicKey)
  });
  // No user ID is accepted from client: server binds to current authenticated account.
  try{
   await api('/api/push/subscribe',{method:'POST',body:subscription.toJSON()});
  }catch(e){
   await subscription.unsubscribe().catch(()=>{});
   throw e;
  }
  toast('เปิดการแจ้งเตือนบนอุปกรณ์นี้แล้ว');return true;
 }
 async function disable({silent=false}={}){
  if(!supported())return false;
  const subscription=await (await sw()).pushManager.getSubscription();
  if(!subscription)return false;
  // Always unsubscribe locally, even if the user is offline during logout.
  // The server will then expire an unreachable device subscription on delivery.
  let problem=null;
  try{await api('/api/push/unsubscribe',{method:'POST',body:{endpoint:subscription.endpoint}})}
  catch(e){problem=e}
  await subscription.unsubscribe();
  if(problem&&!silent)throw problem;
  if(!silent)toast('ปิดการแจ้งเตือนบนอุปกรณ์นี้แล้ว');
  return true;
 }
 async function testPush(){
  if(!supported())return {accepted:false,code:'unsupported'};
  const registration=await sw();
  const sub=await registration.pushManager.getSubscription();
  if(!sub)return {accepted:false,code:'device_not_registered'};
  return api('/api/push/test',{method:'POST',body:{endpoint:sub.endpoint}});
 }
 return {check,install,enable,disable,testPush,isStandalone,supported};
}
