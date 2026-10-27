const CACHE='rd-care-shell-v55';
const ASSETS=['./','./index.html','./app.css','./theme.css','./login.css','./smart-school-ui.css','./media/ratsada-crest.webp','./reference-ui.css','./charts.css','./dashboard-charts.js','./theme.js','./app.js','./my-timetable.js','./period-center.js','./period-center.css','./mobile-app.css','./late-gate.js','./late-gate.css','./late-qr-intent.js','./pwa-client.js','./auth-session.js','./mobile-nav.js','./notification-settings.js','./config.js','./run-safely.js','./request-cache.js','./xlsx-reader.js','./portal-ui.js','./guardian-push.js','./portal-admin.js','./portal-batch.js','./unified-import.js','./advisor-import.js','./admin-settings.js','./admin-settings.css','./csv-encoding.js','./template-xlsx.js','./templates/student-all-rooms-import.csv','./templates/advisor-all-rooms-import.csv','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{
 e.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
 e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
 // API responses contain private school data: always bypass the PWA cache.
 if(url.pathname.startsWith('/api/'))return;
 if(url.pathname.endsWith('/config.js')){e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));return;}
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html')));return;
 }
 e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));
});
// Generic opt-in Push to teachers or verified guardians; never put student details on lock screens.
// The Worker sends an encrypted-transport, payload-free Web Push event.
self.addEventListener('push',event=>{
 // Priority metadata is end-to-end encrypted with Web Push aes128gcm.
 // Other school notices and older clients still work with an empty payload.
 let metadata=null;
 try{if(event.data)metadata=event.data.json()}catch{}
 const urgent=metadata?.kind==='urgent_review'&&
   (metadata.audience==='advisor'||metadata.audience==='guardian');
 const late=metadata?.kind==='late_arrival'&&
   (metadata.audience==='advisor'||metadata.audience==='guardian');
 const staff=(urgent||late)&&metadata.audience==='advisor';
 const link=late&&staff?'./?tab=lateGate':staff?'./?tab=advisorCenter':
   (urgent||late)?'./':'./?tab=notifications';
 event.waitUntil(self.registration.showNotification(
  late?'RD Care • แจ้งเตือนนักเรียนมาสาย':urgent?'RD Care • มีเรื่องสำคัญต้องตรวจสอบ':'RD Care • โรงเรียนรัษฎา',{
  body:late?'มีรายการลงชื่อมาสายใหม่ กรุณาตรวจสอบรายละเอียดภายใน RD Care':
    urgent?'มีข้อมูลการมาเรียนที่ควรตรวจสอบโดยเร็ว กรุณาเปิดแอป RD Care':
   'มีรายการใหม่ให้ตรวจสอบในระบบ RD Care',
  icon:'./icons/icon-192.png',
  badge:'./icons/icon-192.png',
  // Priority alerts cannot be replaced by ordinary notifications.
  tag:late?'rd-care-late-arrival':urgent?'rd-care-priority-review':'rd-care-school-notices',
  renotify:false,
  requireInteraction:urgent,
  ...(urgent?{vibrate:[180,100,180]}:{}),
  data:{url:new URL(link,self.registration.scope).href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const home=new URL('./',self.registration.scope);
 const candidate=event.notification.data?.url;
 const target=new URL(
  candidate===new URL('./?tab=advisorCenter',self.registration.scope).href
   ?'./?tab=advisorCenter':
   candidate===new URL('./?tab=lateGate',self.registration.scope).href
   ?'./?tab=lateGate':candidate===home.href?'./':'./?tab=notifications',
  self.registration.scope
 );
 event.waitUntil((async()=>{
  const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const windowClient of clientsList){
   if(new URL(windowClient.url).origin===target.origin){
    if(windowClient.navigate)await windowClient.navigate(target.href).catch(()=>{});
    await windowClient.focus();return;
   }
  }
  await self.clients.openWindow(target.href);
 })());
});
