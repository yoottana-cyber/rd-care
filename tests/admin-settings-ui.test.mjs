import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminMetrics,adminTabs,createAdminSettings} from '../web/admin-settings.js';

const teachers=[
 {id:1,username:'admin',display_name:'Admin',role:'admin',active:1},
 {id:2,username:'t02',display_name:'ครูตัวอย่าง',role:'teacher',active:1},
 {id:3,username:'s03',display_name:'ฝ่ายกิจการ',role:'staff',active:0}
];
const rooms=[
 {id:7,label:'ม.1/1',advisor_user_id:2},
 {id:8,label:'ม.1/2',advisor_user_id:null}
];
function setup(users=teachers,classes=rooms){
 const orig=globalThis.document;
 let html='';
 let imported=0;
 globalThis.document={
  querySelectorAll:()=>[],querySelector:()=>null,getElementById:()=>null
 };
 const page=createAdminSettings({
  api:()=>{throw Error('render must not mutate API')},
  mount:content=>{html=content},
  safeRun:fn=>fn(),toast:()=>{},
  getUsers:()=>users,getRooms:()=>classes,
  reload:async()=>{},refreshRooms:async()=>{},clearStudentCache:()=>{},
  advisorImporter:{render:()=>{imported++}},
  parseCsv:()=>[],periodChoices:['1','1-2','2','9-10','10']
 });
 return {page,get html(){return html},get imported(){return imported},
  restore(){if(orig===undefined)delete globalThis.document;else globalThis.document=orig}};
}

test('admin settings summary counts rooms and active staff accurately',()=>{
 assert.deepEqual(adminMetrics(teachers,rooms),{
  users:3,teachers:1,rooms:2,advisors:1,inactive:1
 });
 assert.deepEqual(adminTabs.map(t=>t.id),['overview','people','teaching','import']);
});
test('full admin redesign shows summary cards and clean navigation',()=>{
 const s=setup();
 try{
  s.page.render();
  assert.match(s.html,/ศูนย์จัดการระบบ/);
  assert.match(s.html,/บัญชีบุคลากร/);
  assert.match(s.html,/ครูและตารางสอน/);
  assert.match(s.html,/นำเข้าข้อมูล/);
  assert.match(s.html,/ยังไม่ได้กำหนดครูที่ปรึกษา/);
  assert.match(s.html,/rd-settings-stats/);
 }finally{s.restore()}
});
test('personnel panel retains create edit role filters and correct per-row buttons',()=>{
 const s=setup();
 try{
  s.page.open('people');
  for(const text of ['id="addUser"','id="staffPassword"','id="settingsSearch"',
   'id="settingsRoleFilter"','id="settingsStatusFilter"',
   'data-edit-user="2"','data-edit-user="3"']){
   assert.ok(s.html.includes(text),text);
  }
  assert.doesNotMatch(s.html,/data-edit-user="1"/);
  assert.match(s.html,/data-settings-user/);
 }finally{s.restore()}
});
test('curriculum and import panels keep original API-facing form IDs and templates',()=>{
 const s=setup();
 try{
  s.page.open('teaching');
  for(const item of ['id="assignAdvisor"','id="addSlot"',
   'name="subject_code"','name="period_range"','value="1-2"','value="9-10"']){
    assert.ok(s.html.includes(item),item);
  }
  s.page.open('import');
  assert.match(s.html,/id="importStudents"/);
  assert.match(s.html,/id="advisorImportHolder"/);
  assert.equal(s.imported,1);
 }finally{s.restore()}
});
test('school and user display names are escaped in the new admin markup',()=>{
 const malicious=[{id:2,username:'t02',display_name:'<script>alert("x")</script>',role:'teacher',active:1}];
 const s=setup(malicious,[{id:7,label:'<img onerror=alert(1)>',advisor_user_id:null}]);
 try{
  s.page.open('people');
  assert.doesNotMatch(s.html,/<script>alert/);
  assert.match(s.html,/&lt;script&gt;/);
  s.page.open('teaching');
  assert.doesNotMatch(s.html,/<img onerror=/);
  assert.match(s.html,/&lt;img onerror=/);
 }finally{s.restore()}
});
test('old querySelector forEach crash is removed from the app entrypoint',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/\$\(['"]\[data-edit-user\]['"]\)\.forEach/);
 assert.match(app,/function renderAdmin\(\)\{adminSettings\.render\(\);\}/);
 assert.match(app,/import \{createAdminSettings\} from '\.\/admin-settings\.js'/);
});
