const CACHE='rd-care-shell-v43';
const ASSETS=['./','./index.html','./app.css','./theme.css','./login.css','./smart-school-ui.css','./media/ratsada-crest.webp','./reference-ui.css','./charts.css','./dashboard-charts.js','./theme.js','./app.js','./my-timetable.js','./period-center.js','./period-center.css','./mobile-app.css','./pwa-client.js','./auth-session.js','./mobile-nav.js','./notification-settings.js','./config.js','./run-safely.js','./request-cache.js','./xlsx-reader.js','./portal-ui.js','./portal-admin.js','./portal-batch.js','./unified-import.js','./advisor-import.js','./admin-settings.js','./admin-settings.css','./csv-encoding.js','./template-xlsx.js','./templates/student-all-rooms-import.csv','./templates/advisor-all-rooms-import.csv','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
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
// Only staff-approved generic push: never expose student details on device lock screens.
// The Worker sends an encrypted-transport, payload-free Web Push event.
self.addEventListener('push',event=>{
 event.waitUntil(self.registration.showNotification('RD Care • โรงเรียนรัษฎา',{
  body:'มีรายการใหม่ให้ตรวจสอบในระบบ RD Care',
  icon:'./icons/icon-192.png',
  badge:'./icons/icon-192.png',
  tag:'rd-care-staff-tasks',
  renotify:false,
  data:{url:new URL('./?tab=notifications',self.registration.scope).href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL('./?tab=notifications',self.registration.scope);
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
