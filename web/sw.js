// RD CONNECT offline app shell. This cache contains only public static assets,
// never authenticated responses, student records, or arbitrary same-origin URLs.
const CACHE='rd-care-shell-v111';
const CACHE_PREFIX='rd-care-shell-';
const ASSETS=[
 './','./index.html','./app.css','./theme.css','./login.css','./login-route.js',
 './pwa-role.js','./pwa-updates.js','./pwa-client.js','./push-intro.js','./smart-school-ui.css',
 './rd-design-system.css','./media/ratsada-crest.webp','./reference-ui.css',
 './charts.css','./dashboard-charts.js','./theme.js','./app.js',
 './navigation-ui.js','./period-clock.js','./my-timetable.js','./period-center.js','./period-center.css',
 './mobile-app.css','./late-gate.js','./late-gate.css','./late-qr-intent.js',
 './auth-session.js','./mobile-nav.js','./notification-settings.js','./config.js',
 './run-safely.js','./request-cache.js','./xlsx-reader.js','./portal-ui.js',
 './portal-date-range.js','./portal-mobile.css','./student-message-ui.js','./student-late-qr-scanner.js',
 './vendor/qr-scanner.min.js','./vendor/qr-scanner-worker.min.js','./student-affairs.js',
 './student-affairs.css','./criteria-excel-import.js','./guardian-push.js','./portal-admin.js',
 './portal-table.js','./portal-batch.js','./portal-roster-import.js',
 './unified-import.js','./student-statistics.js','./student-statistics.css','./advisor-import.js','./admin-settings.js',
 './admin-settings.css','./csv-encoding.js','./template-xlsx.js',
 './score-recording.js','./score-recording.css','./score-history.js',
 './score-history-popup.js','./behavior-adjustment.js',
 './teacher-score-monitor.js','./teacher-score-monitor.css',
 './school-settings.js','./school-settings.css','./term-snapshots.js','./timetable-audit.js',
 './templates/portal-accounts-import.csv','./templates/student-all-rooms-import.csv',
 './templates/advisor-all-rooms-import.csv',
 './manifest.webmanifest','./manifest-staff.webmanifest',
 './manifest-student.webmanifest','./manifest-guardian.webmanifest',
 './icons/staff-192.png','./icons/staff-512.png','./icons/student-192.png',
 './icons/student-512.png','./icons/guardian-192.png','./icons/guardian-512.png',
 './icons/icon-192.png','./icons/icon-512.png','./icons/rd-connect.svg'
];
const SHELL=new URL('./index.html',self.registration.scope).href;
const SCOPE=new URL('./',self.registration.scope);
const STATIC_PATHS=new Set(ASSETS.map(path=>new URL(path,SCOPE).pathname));
function isApiPath(pathname){
 return /(^|\/)api(?:\/|$)/.test(pathname);
}
function isAppNavigation(url){
 return url.pathname===SCOPE.pathname||url.pathname===new URL(SHELL).pathname;
}
// A new worker preloads one consistent set of scripts before taking control.
// Requests bypass the browser HTTP cache so a release cannot precache old files.
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE)
  .then(cache=>cache.addAll(ASSETS.map(path=>new Request(new URL(path,SCOPE),{cache:'reload'}))))
  .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE)
   .map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
async function networkFirst(request,key){
 const cache=await caches.open(CACHE);
 try{
  const response=await fetch(request,{cache:'no-store'});
  // Never cache redirects, failures, opaque responses or server-rendered errors.
  if(response.ok&&response.type==='basic'&&!response.redirected){
   try{await cache.put(key,response.clone())}catch{}
  }
  return response;
 }catch{
  return (await cache.match(key))||Response.error();
 }
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==SCOPE.origin||isApiPath(url.pathname))return;
 // Navigation is always network-first, including role-specific login URLs.
 // Only the static app shell may be used as an offline navigation fallback.
 if(request.mode==='navigate'){
  if(isAppNavigation(url))event.respondWith(networkFirst(request,SHELL));
  return;
 }
 if(!STATIC_PATHS.has(url.pathname))return;
 // Only known public build assets can enter the Cache Storage allowlist.
 const cacheKey=url.origin+url.pathname;
 event.respondWith(networkFirst(request,cacheKey));
});

// Push includes only a school event category, date/time, optional lesson and an
// opaque event ID. Student details are fetched after authenticated click-through.
self.addEventListener('push',event=>{
 let metadata=null;
 try{if(event.data)metadata=event.data.json()}catch{}
 const urgent=metadata?.kind==='urgent_review'&&
  (metadata.audience==='advisor'||metadata.audience==='guardian');
 const late=metadata?.kind==='late_arrival'&&
  (metadata.audience==='advisor'||metadata.audience==='guardian');
 const review=metadata?.kind==='attendance_review'&&metadata.audience==='advisor';
 const test=metadata?.kind==='push_test';
 const pupilNotice=metadata?.kind==='pupil_notice'&&metadata.audience==='student';
 const studentMessage=metadata?.kind==='student_message'&&metadata.audience==='student';
 const messageId=Number(metadata?.messageId);
 const validMessageId=Number.isSafeInteger(messageId)&&messageId>0;
 const dailyReminder=metadata?.kind==='daily_attendance_reminder'&&metadata.audience==='advisor';
 const room=Number(metadata?.classroomId),validRoom=Number.isSafeInteger(room)&&room>0;
 const staff=metadata?.audience==='advisor';
 const id=Number(metadata?.eventId),hasId=Number.isSafeInteger(id)&&id>0;
 const date=/^\d{4}-\d{2}-\d{2}$/.test(String(metadata?.date||''))?metadata.date:'';
 const period=Number(metadata?.period),validPeriod=Number.isInteger(period)&&period>=1&&period<=12;
 const subject=typeof metadata?.subject==='string'?metadata.subject.slice(0,55):'';
 const arrival=/^\d{2}:\d{2}$/.test(String(metadata?.arrival||''))?metadata.arrival:'';
 const type=late?'late':review?'attendance_review':'truancy';
 const studentKind=['late','truancy'].includes(metadata?.noticeKind)?metadata.noticeKind:null;
 const link=studentMessage&&validMessageId?
  './?login=student&student_message='+messageId:
  pupilNotice&&hasId&&studentKind?
   './?login=student&pupil_notice='+studentKind+'&notice_id='+id:
  dailyReminder&&validRoom&&date?
   './?tab=attendance&classroom_id='+room+'&date='+date:
  hasId&&(late||urgent||review)
  ?staff
   ?'./?tab='+(late?'lateGate':'advisorCenter')+'&notice_kind='+type+'&notice_id='+id
   :'./?portal_notice='+type+'&notice_id='+id
  :late&&staff?'./?tab=lateGate':(urgent||review)&&staff?'./?tab=advisorCenter':
   (late||urgent||review)?'./':test&&staff?'./?tab=notifications':
   test&&metadata?.audience==='student'?'./?login=student':
   test&&metadata?.audience==='guardian'?'./?login=guardian':
   test?'./':'./?tab=notifications';
 const title=dailyReminder?'RD CONNECT • เตือนเช็กชื่อรายวัน':
  late?'RD CONNECT • แจ้งเรื่องมาสาย':
  urgent?'RD CONNECT • แจ้งเรื่องหนีเรียน':
  review?'RD CONNECT • แจ้งขาดรายคาบรอตรวจสอบ':
  test?'RD CONNECT • ทดสอบการแจ้งเตือน':
  pupilNotice?'RD CONNECT • มีข้อมูลการเข้าเรียนใหม่':
  studentMessage?'RD CONNECT • ข้อความจากโรงเรียน':'RD CONNECT • โรงเรียนรัษฎา';
 const details=late?
  [date&&'วันที่ '+date,arrival&&'เวลา '+arrival+' น.'].filter(Boolean).join(' • '):
  [date&&'วันที่ '+date,validPeriod&&'คาบ '+period,subject&&'วิชา '+subject].filter(Boolean).join(' • ');
 const body=dailyReminder?'ยังเช็กชื่อนักเรียนรายวันไม่ครบ • แตะเพื่อเปิดห้องเรียนและดำเนินการ':
  late?'มีการลงชื่อมาสาย'+(details?' • '+details:'')+' แตะเพื่อดูรายการ':
  urgent?'มีการบันทึกหนีเรียน'+(details?' • '+details:'')+' แตะเพื่อดูรายละเอียด':
  review?'มีเรื่องขาดรายคาบรอตรวจสอบ'+(details?' • '+details:'')+' แตะเพื่อเปิดรายการ':
  pupilNotice?'มีข้อมูลการเข้าเรียนให้ตรวจสอบในแอป RD CONNECT':
  studentMessage?'มีข้อความใหม่จากโรงเรียน กรุณาเข้าสู่ระบบเพื่ออ่าน':
  test?'การแจ้งเตือนทดสอบจาก RD CONNECT (ไม่มีเหตุการณ์นักเรียน)':
  'มีรายการใหม่ให้ตรวจสอบในระบบ RD CONNECT';
 event.waitUntil(self.registration.showNotification(title,{
  body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',
  // Do not collapse separate students/events into one notification.
  tag:dailyReminder?'rd-connect-daily-checkin-'+date+'-'+room:
      late?'rd-care-late-arrival'+(hasId?'-'+id:''):
      urgent?'rd-care-priority-review'+(hasId?'-'+id:''):
      review?'rd-care-attendance-review'+(hasId?'-'+id:''):
      pupilNotice?'rd-care-student-'+studentKind+'-'+id:
      studentMessage?'rd-care-student-message-'+messageId:
      test?'rd-care-push-test':'rd-care-school-notices',
  renotify:false,requireInteraction:urgent,
  ...(urgent?{vibrate:[180,100,180]}:{}),
  data:{url:new URL(link,self.registration.scope).href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const home=new URL('./',self.registration.scope);
 let target=home;
 try{
  const value=new URL(event.notification.data?.url||home.href,self.registration.scope);
  const q=value.searchParams;
  const tab=q.get('tab'),kind=q.get('notice_kind'),id=q.get('notice_id');
  const portalKind=q.get('portal_notice');
  const studentKind=q.get('pupil_notice');
  const safeDaily=tab==='attendance'&&/^\d{1,8}$/.test(q.get('classroom_id')||'')&&
   /^\d{4}-\d{2}-\d{2}$/.test(q.get('date')||'');
  const safeStaff=safeDaily||tab==='notifications'||
   (tab==='advisorCenter'&&['truancy','attendance_review'].includes(kind)&&/^\d{1,15}$/.test(id||''))||
   (tab==='lateGate'&&kind==='late'&&/^\d{1,15}$/.test(id||''))||
   ((tab==='advisorCenter'||tab==='lateGate')&&!id&&!kind);
  const safeGuardian=['truancy','late'].includes(portalKind)&&/^\d{1,15}$/.test(id||'');
  const safeStudent=['truancy','late'].includes(studentKind)&&/^\d{1,15}$/.test(id||'')&&q.get('login')==='student';
  const safeStudentMessage=/^\d{1,15}$/.test(q.get('student_message')||'')&&q.get('login')==='student';
  if(value.origin===home.origin&&value.pathname===home.pathname&&
    (!value.search||safeStaff||safeGuardian||safeStudent||safeStudentMessage))target=value;
 }catch{}
 event.waitUntil((async()=>{
  const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const windowClient of clientsList){
   if(new URL(windowClient.url).origin===target.origin){
    if(windowClient.navigate){
     try{
      const navigated=await windowClient.navigate(target.href);
      if(navigated){await navigated.focus();return}
     }catch{}
    }
    // An existing window may already be on the requested URL.
    if(windowClient.url===target.href){await windowClient.focus();return}
   }
  }
  await self.clients.openWindow(target.href);
 })());
});
