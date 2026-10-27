import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupNavigation,pageLocation,renderSidebarNavigation,searchNavItems} from '../web/navigation-ui.js';
import {mobileMarkup} from '../web/mobile-nav.js';

const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const navs=[
 ['dashboard','หน้าหลัก','🏠'],['attendance','เช็กชื่อรายวัน','📅'],
 ['periodAttendance','เช็กชื่อรายคาบ','✅'],['advisorCenter','ศูนย์ครูที่ปรึกษา','👨‍🏫'],
 ['behavior','คะแนนพฤติกรรม','⚖️'],['good','คะแนนความดี','⭐'],
 ['studentAffairs','ฝ่ายกิจการนักเรียน','🏫'],['adminStudents','จัดการนักเรียน','🎓'],
 ['portalAccounts','บัญชีผู้เรียน/ผู้ปกครอง','👥'],['admin','ครูและระบบ','⚙️']
];
test('school workspace navigation groups tasks and keeps the exact role-filtered list',()=>{
 const sections=groupNavigation(navs);
 assert.deepEqual(sections.map(x=>x.id),['overview','attendance','care','management']);
 assert.deepEqual(sections.flatMap(x=>x.items.map(item=>item[0])),navs.map(x=>x[0]));
 const teacher=navs.filter(x=>!['studentAffairs','adminStudents','portalAccounts','admin'].includes(x[0]));
 const teacherMarkup=renderSidebarNavigation(teacher,'good');
 assert.match(teacherMarkup,/class="rd-sidebar-link active" data-tab="good"/);
 assert.doesNotMatch(teacherMarkup,/data-tab="admin"/);
 assert.doesNotMatch(teacherMarkup,/data-tab="studentAffairs"/);
 assert.match(teacherMarkup,/data-nav-group="care"/);
 assert.match(teacherMarkup,/aria-current="page"/);
});
test('page headings describe context without changing navigation permissions',()=>{
 assert.deepEqual(pageLocation(navs,'periodCheckin'),{
  title:'เช็กชื่อรายคาบ',
  description:'เช็กชื่อผู้เรียนตามคาบเรียนและตารางสอน',
  group:'การเช็กชื่อและติดตาม'
 });
 assert.equal(pageLocation(navs,'studentAffairs').group,'ดูแลและส่งเสริม');
 assert.equal(pageLocation(navs,'portalAccounts').group,'งานบริหารระบบ');
});
test('sidebar search hides unrelated navigation and restores all categories on clearing',()=>{
 const cards=[{textContent:'หน้าหลัก',hidden:false},{textContent:'คะแนนความดี',hidden:false},
  {textContent:'คะแนนพฤติกรรม',hidden:false}];
 const groups=[
  {hidden:false,querySelectorAll(){return [cards[0]]}},
  {hidden:false,querySelectorAll(){return cards.slice(1)}}
 ];
 const empty={hidden:true};
 const root={querySelectorAll(query){
  return query==='.rd-sidebar-link'?cards:query==='.rd-sidebar-group'?groups:[]
 },querySelector(query){return query==='#rdNavEmpty'?empty:null}};
 assert.equal(searchNavItems(root,'ความดี'),1);
 assert.equal(groups[0].hidden,true);
 assert.equal(groups[1].hidden,false);
 assert.equal(empty.hidden,true);
 assert.equal(searchNavItems(root,'ไม่พบอะไรเลย'),0);
 assert.equal(empty.hidden,false);
 assert.equal(searchNavItems(root,''),3);
 assert.deepEqual(cards.map(x=>x.hidden),[false,false,false]);
 assert.deepEqual(groups.map(x=>x.hidden),[false,false]);
});
test('mobile drawer groups the same authorized links while keeping five quick nav slots',()=>{
 const html=mobileMarkup({navs:navs.slice(0,7),user:{role:'teacher',display_name:'ครูทดสอบ'},
  active:id=>id==='good',pending:3});
 assert.match(html,/rd-mobile-sheet-groups/);
 assert.match(html,/rd-mobile-sheet-section/);
 assert.match(html,/rd-mobile-sheet-grid/);
 assert.match(html,/data-tab="good" class="active" aria-current="page"/);
 assert.match(html,/rd-mobile-bar/);
 assert.match(html,/rd-mobile-bubble/);
 assert.doesNotMatch(html,/data-tab="adminStudents"/);
});
test('all school interfaces load a unified design system after scoped styles',()=>{
 const index=text('web/index.html'),css=text('web/rd-design-system.css'),sw=text('web/sw.js');
 assert.ok(index.lastIndexOf('rd-design-system.css')>index.indexOf('student-affairs.css'));
 for(const selector of ['.rd-shell','.rd-settings','.rd-affairs','.rd-portal-mobile',
  '.login-wrap','.rd-content-head','.rd-sidebar-search','.rd-mobile-sheet-groups',
  '.rd-workspace .stats','.quick-action']){
  assert.ok(css.includes(selector),selector);
 }
 for(const role of ['student','guardian'])assert.ok(css.includes('data-role="'+role+'"'));
 assert.match(css,/@media\(max-width:780px\)/);
 assert.match(css, /prefers-reduced-motion:reduce/);
 assert.match(css,/\[data-theme="dark"\]/);
 assert.match(sw,/\.\/rd-design-system\.css/);
 assert.match(sw,/\.\/navigation-ui\.js/);
});
