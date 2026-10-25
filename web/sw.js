const CACHE='rd-care-shell-v23';
const ASSETS=['./','./index.html','./app.css','./theme.css','./login.css','./media/ratsada-campus.webp','./media/ratsada-crest.webp','./reference-ui.css','./charts.css','./dashboard-charts.js','./theme.js','./app.js','./config.js','./run-safely.js','./request-cache.js','./xlsx-reader.js','./portal-ui.js','./portal-admin.js','./portal-batch.js','./unified-import.js','./advisor-import.js','./csv-encoding.js','./template-xlsx.js','./templates/student-all-rooms-import.csv','./templates/advisor-all-rooms-import.csv','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
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
// ยังไม่เปิดรับ Push จนกว่าจะมีระบบผูกอุปกรณ์และจัดการความยินยอม
