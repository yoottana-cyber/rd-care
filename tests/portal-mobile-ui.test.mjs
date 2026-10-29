import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {portalPeriodMode} from '../web/portal-date-range.js';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const portal=source('web/portal-ui.js');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function renderFor(role,{qr=false,guardianFocus=false}={}){
 const start=portal.indexOf(' function dateFilterMarkup(scope){');
 const end=portal.indexOf(' function table(',start);
 assert.ok(start>0&&end>start,'render method found');
 let html='';
 const student={id:7,full_name:'นักเรียนตัวอย่าง',student_no:'19460',classroom_label:'ม.3/8'};
 const state={
  account:{role,display_name:'บัญชีทดลอง'},studentId:7,children:[student],
  records:{daily:[{school_date:'2026-10-27',status:'late'}],
   period:[{school_date:'2026-10-27',period:3,subject:'วิทยาศาสตร์',status:'present'}],
   late:[{school_date:'2026-10-27',arrived_at:'09:50',state:'verified'}],
   behavior:[{record_date:'2026-10-27',points:5,reason:'มีวินัย'}],behavior_total:5},
  from:'2026-10-27',to:'2026-10-27',filterMode:'today',
  view:qr?'late':'home',
  truancy:guardianFocus?[{id:9,full_name:'นักเรียนตัวอย่าง',school_date:'2026-10-27',period:3,subject:'ภาษาไทย'}]:[],
  focus:guardianFocus?{kind:'truancy',full_name:'นักเรียนตัวอย่าง',classroom_label:'ม.3/8',
   school_date:'2026-10-27',period:3,subject:'ภาษาไทย'}:null,focusUnavailable:false
 };
 const context={
  state,lateQrToken:qr?'gate':null,lateQrReceipt:null,
  root:{querySelectorAll:()=>[]},portalPeriodMode,isInstalledPwa:()=>false,
  frame:next=>{html=next},esc:escapeHtml,portalDate:x=>x,guardianPush:{bind(){},introStatus(){},enable(){}},studentPush:{bind(){},introStatus(){},enable(){}},
  offerPushIntro:()=>Promise.resolve(false),portalPushIntroPending:false,
  table:()=>'<div class="rd-portal-record-list"></div>',
  statusLabel:x=>x,today:()=> '2026-10-27',
  select:()=>({addEventListener(){},scrollIntoView(){}}),
  logout(){},call:async()=>({}),endLateQrIntent(){},showDashboard(){},message(){},loadRecords(){}
 };
 const fn=vm.runInNewContext('(()=>{'+portal.slice(start,end)+';return renderDashboard})()',context);
 fn();
 return html;
}
test('student portal renders thumb-friendly navigation, quick cards, QR form and real records',()=>{
 const html=renderFor('student',{qr:true});
 for(const id of ['home','attendance','late','account'])
  assert.match(html,new RegExp('data-portal-panel="'+id+'"'));
 assert.match(html,/id="studentLateQrForm"/);
 assert.match(html,/id="cancelStudentLateQr"/);
 assert.match(html,/id="portalFrom-history"/);
 assert.match(html,/id="portalDate-home"/);
 assert.match(html,/data-portal-date-mode="today"/);
 assert.match(html,/data-portal-date-mode="date"/);
 assert.match(html,/data-portal-date-mode="range"/);
 assert.match(html,/data-portal-open="attendance"/);
 assert.match(html,/ประวัติมาสาย/);
 assert.doesNotMatch(html,/id="guardianPushEnable"/);
 assert.match(html,/id="studentPushEnable"/);
 assert.match(html,/id="studentPushDisable"/);
 assert.match(html,/id="studentPushTest"/);
});
test('guardian portal retains verified guardian Push controls and focus on linked event',()=>{
 const html=renderFor('guardian',{guardianFocus:true});
 assert.match(html,/data-portal-panel="alerts"/);
 assert.match(html,/id="guardianAlerts"/);
 assert.match(html,/id="portalDate-home"/);
 assert.match(html,/id="portalFrom-history"/);
 assert.match(html,/ประวัติมาสาย/);
 for(const id of ['guardianPushStatus','guardianPushEnable','guardianPushDisable','guardianPushTest'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/id="pushNoticeFocus"/);
 assert.match(html,/รายละเอียดนี้แสดงสำหรับบัญชีที่ได้รับสิทธิ์เท่านั้น/);
 assert.doesNotMatch(html,/id="studentLateQrForm"/);
 assert.doesNotMatch(html,/id="studentPushEnable"/);
 assert.doesNotMatch(html,/data-portal-panel="late"/);
});
test('mobile student/guardian login keeps role-specific password visibility and original auth',()=>{
 assert.match(portal,/id="portalTogglePassword"/);
 assert.match(portal,/aria-pressed/);
 assert.match(portal,/api\/portal\/auth\/login/);
 assert.match(portal,/saveAuthSession\(activeTokenKey/);
 assert.match(portal,/rd_portal_guardian_token/);
 assert.match(portal,/rd_portal_student_token/);
});
test('portal styles isolate changes from staff dashboard and respect mobile safe area',()=>{
 const css=source('web/portal-mobile.css');
 assert.match(css,/\.rd-portal-mobile/);
 assert.match(css,/\.rd-portal-bottom/);
 assert.match(css,/env\(safe-area-inset-bottom/);
 assert.match(css,/focus-visible/);
 assert.match(css,/\[hidden\]/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(source('web/index.html'),/stylesheet" href="\.\/portal-mobile\.css"/);
 assert.match(source('web/sw.js'),/portal-mobile\.css/);
 assert.match(portal,/setPortalView\(state\.view\)/);
 assert.match(portal,/guardianPush\.bind\(\)/);
});
