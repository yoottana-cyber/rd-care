import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planAdvisorImport,advisorImportEndpoint} from '../worker/src/advisor-import.js';
import {prepareAdvisorRows} from '../web/advisor-import.js';
import {csvRows} from '../web/unified-import.js';
import {buildAdvisorExampleXlsx} from '../web/template-xlsx.js';

const roomMap=new Map([
 ['ม.1/1',{id:1,label:'ม.1/1',advisor_user_id:null}],
 ['ม.2/3',{id:2,label:'ม.2/3',advisor_user_id:null}],
 ['ม.3/2',{id:3,label:'ม.3/2',advisor_user_id:7,advisor2_user_id:8}]
]);
const row=(classroom='ม.1/1',username='teacher_demo01',password='StrongPassword#1234')=>({
 classroom,full_name:'ครูตัวอย่าง หนึ่ง',username,password,source_row:2
});
test('four-column advisor import supports multiple rooms and Thai UTF-8 names',()=>{
 const raw=csvRows('classroom,full_name,username,password\nม.1/1,ครูตัวอย่าง หนึ่ง,teacher_demo01,StrongPassword#1234\nม.2/3,ครูตัวอย่าง สอง,teacher_demo02,StrongPassword#5678');
 const items=prepareAdvisorRows(raw,[{label:'ม.1/1'},{label:'ม.2/3'}]);
 assert.equal(items.length,2);
 assert.equal(items.every(x=>x.status==='ready'),true);
 assert.equal(items[1].values.classroom,'ม.2/3');
});
test('Excel rows without a trailing password cell can link an existing teacher account',()=>{
 const parsed=prepareAdvisorRows([['classroom','full_name','username','password'],['ม.1/1','ครูตัวอย่าง หนึ่ง','teacher_demo01']],
  [{label:'ม.1/1'}]);
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].values.password,'');
 assert.equal(parsed[0].status,'ready');
});
test('valid advisor batch never echoes passwords',()=>{
 const plan=planAdvisorImport([row()],roomMap);
 assert.equal(plan.ready,true);
 assert.equal(plan.items[0].mode,'create');
 assert.ok(!JSON.stringify(plan).includes('StrongPassword'));
});
test('existing active teacher may be assigned to a vacant room without resetting their password',()=>{
 const teachers=[{username:'teacher_demo01',display_name:'ครูตัวอย่าง หนึ่ง',role:'teacher',active:1,id:22}];
 const plan=planAdvisorImport([row('ม.1/1','teacher_demo01','')],roomMap,teachers);
 assert.equal(plan.ready,true);
 assert.equal(plan.items[0].mode,'link');
});
test('existing username cannot be hijacked and a full room is not silently overwritten',()=>{
 const users=[{username:'teacher_demo01',display_name:'ครูตัวอย่าง หนึ่ง',role:'admin',active:1}];
 assert.match(planAdvisorImport([row()],roomMap,users).items[0].message,/ไม่ใช่บัญชีครู/);
 assert.match(planAdvisorImport([row('ม.3/2')],roomMap).items[0].message,/มีครูที่ปรึกษาแล้ว/);
 const teacher=[{username:'teacher_demo01',display_name:'ครูตัวอย่าง หนึ่ง',role:'teacher',active:1}];
 assert.match(planAdvisorImport([row()],roomMap,teacher).items[0].message,/เว้น Password ว่าง/);
 assert.match(planAdvisorImport([row('ม.1/1','teacher_demo01','')],roomMap,[{...teacher[0],display_name:'ครูคนอื่น'}]).items[0].message,/ชื่อไม่ตรง/);
});
test('supports two distinct advisors per room but rejects duplicates, third advisor, and invalid passwords',()=>{
 const pair=planAdvisorImport([row(),row('ม.1/1','teacher_demo02','AnotherSecurePass1')],roomMap);
 assert.equal(pair.ready,true);
 assert.deepEqual(pair.items.map(x=>x.slot),[1,2]);
 const third=planAdvisorImport([row(),row('ม.1/1','teacher_demo02','AnotherSecurePass1'),
  row('ม.1/1','teacher_demo03','AnotherSecurePass2')],roomMap);
 assert.equal(third.ready,false);
 assert.match(third.items[2].message,/ครบ 2 คน/);
 const duplicate=planAdvisorImport([row(),row()],roomMap);
 assert.equal(duplicate.ready,false);
 assert.match(duplicate.items[1].message,/ซ้ำ|แล้ว/);
 const usersDup=planAdvisorImport([row(),row('ม.2/3')],roomMap);
 assert.equal(usersDup.ready,false);
 assert.match(usersDup.items[1].message,/Username ซ้ำ/);
 assert.equal(planAdvisorImport([row('ม.1/1','teacher_demo01','1234')],roomMap).ready,true);
 assert.match(planAdvisorImport([row('ม.1/1','teacher_demo01','123')],roomMap).items[0].message,/4/);
 assert.match(planAdvisorImport([row('ม.1/1','teacher_demo01','1234567890123')],roomMap).items[0].message,/เลขประจำตัวประชาชน/);
});
test('admin-only endpoint refuses teacher, anonymous and oversized commit before accessing D1',async()=>{
 const req=new Request('https://rd-care.test/api/admin/advisors/commit',{method:'POST',
  body:JSON.stringify({advisors:[row()]})});
 await assert.rejects(advisorImportEndpoint(req,{}, {role:'teacher'},'/api/admin/advisors/commit'),e=>e.code===403);
 const tooMany=new Request('https://rd-care.test/api/admin/advisors/commit',{method:'POST',
  body:JSON.stringify({advisors:Array.from({length:6},(_,i)=>row('ม.1/1','teacher'+i))})});
 await assert.rejects(advisorImportEndpoint(tooMany,{}, {role:'admin'},'/api/admin/advisors/commit'),e=>e.code===400);
});
test('preview performs only read queries and never returns credentials',async()=>{
 const queries=[];
 const env={DB:{prepare(query){queries.push(query);return {}},async batch(statements){
  return [
   {results:[...roomMap.values()]},
   {results:[]}
  ];
 }}};
 const request=new Request('https://rd-care.test/api/admin/advisors/preview',{
  method:'POST',body:JSON.stringify({advisors:[row()]})});
 const response=await advisorImportEndpoint(request,env,{id:1,role:'admin'},'/api/admin/advisors/preview');
 const preview=await response.json();
 assert.equal(preview.ready,true);
 assert.equal(preview.items[0].mode,'create');
 assert.equal(queries.every(q=>q.startsWith('SELECT')),true);
 assert.equal(JSON.stringify(preview).includes('StrongPassword'),false);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('example Excel includes Advisors, Instructions and Rooms with Thai Tahoma font',()=>{
 const bytes=buildAdvisorExampleXlsx();
 const decoder=new TextDecoder(),zip=decoder.decode(bytes);
 assert.match(zip,/Advisors/);
 assert.match(zip,/classroom/);
 assert.match(zip,/teacher001/);
 assert.match(zip,/Tahoma/);
});
test('UI displays one-click Excel/CSV template, secure preview and safe chunked import',()=>{
 const ui=readFileSync(new URL('../web/advisor-import.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const settings=readFileSync(new URL('../web/admin-settings.js',import.meta.url),'utf8');
 assert.match(ui,/readXlsxRows/);assert.match(ui,/readCsvFile/);
 assert.match(ui,/api\/admin\/advisors\/preview/);
 assert.match(ui,/api\/admin\/advisors\/commit/);
 assert.match(ui,/batches\(currentRows,5\)/);
 assert.match(settings,/advisorImporter\.render/);
 assert.match(app,/advisorImporter\.clear/);
 const sw=readFileSync(new URL('../web/sw.js',import.meta.url),'utf8');
 assert.match(sw,/advisor-import\.js/);assert.match(sw,/advisor-all-rooms-import\.csv/);
});

test('a previously assigned primary advisor is preserved when importing the second',()=>{
 const teachers=[{id:22,username:'second_teacher',display_name:'ครูตัวอย่าง หนึ่ง',role:'teacher',active:1}];
 const rooms=new Map([['ม.1/1',{id:1,label:'ม.1/1',advisor_user_id:19,advisor2_user_id:null}]]);
 const plan=planAdvisorImport([row('ม.1/1','second_teacher','')],rooms,teachers);
 assert.equal(plan.ready,true);
 assert.equal(plan.items[0].slot,2);
 assert.equal(plan.items[0].mode,'link');
});
test('front-end accepts two advisor rows in one room without changing file headers',()=>{
 const raw=csvRows('classroom,full_name,username,password\nม.1/1,ครูหนึ่ง,teacher001,Pass1234\nม.1/1,ครูสอง,teacher002,Pass5678');
 const result=prepareAdvisorRows(raw,[{label:'ม.1/1'}]);
 assert.equal(result.length,2);
 assert.equal(result.every(x=>x.status==='ready'),true);
});
