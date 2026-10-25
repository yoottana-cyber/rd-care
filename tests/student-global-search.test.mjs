import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeStudentSearch,searchStudents} from '../worker/src/student-search.js';
test('global student search normalizes query without wildcard injection or losing leading zero',()=>{
 assert.equal(normalizeStudentSearch('  001234  '),'001234');
 assert.equal(normalizeStudentSearch('  ม.3/8 '),'ม.3/8');
 assert.equal(normalizeStudentSearch('  นาย   ตัวอย่าง  '),'นาย ตัวอย่าง');
 for(const value of ['','a','x'.repeat(61),'ab\nzz'])
  assert.throws(()=>normalizeStudentSearch(value));
});
test('teacher and student cannot request global roster even with admin endpoint URL',async()=>{
 const req=new Request('https://rdcare.test/api/admin/student-search?q=DEMO');
 await assert.rejects(searchStudents(req,{}, {role:'teacher'}),e=>e.code===403);
 await assert.rejects(searchStudents(req,{}, {role:'student'}),e=>e.code===403);
});
test('backend uses bound parameters and limited, non-sensitive columns',async()=>{
 let captured=null;
 const fake={DB:{prepare(sql){return {bind(...params){captured={sql,params};return {async all(){return {results:[{
  id:17,student_no:'001234',full_name:'Demo student',roll_no:2,classroom_id:8,
  classroom_label:'ม.1/1',active:1
 }]}}}}}}}};
 const response=await searchStudents(new Request('https://rdcare.test/api/admin/student-search?q='+encodeURIComponent('0012')),
  fake,{id:1,role:'admin'});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(captured.params,['0012','0012','0012']);
 assert.match(captured.sql,/LIMIT 20/);
 assert.match(captured.sql,/instr\(lower\(s\.student_no\),\?\)/);
 assert.doesNotMatch(captured.sql,/password|salt|token|email/i);
 const body=await response.json();
 assert.equal(body.items[0].student_no,'001234');
});
test('reference-inspired UI offers working authorized search and desktop collapsing without changing mobile nav',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/reference-ui.css',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../web/sw.js',import.meta.url),'utf8');
 for(const token of ['rdGlobalSearch','rd-sidebar-nav','rd-workspace','rd-sidebar-link','sidebarToggle',
   'bindGlobalStudentSearch','/api/admin/student-search','showTab(\'adminStudents\')'])
  assert.ok(app.includes(token),token);
 assert.match(app,/state\.user\?\.role==='admin'\?/);
 assert.match(app,/adminStudentState\.roomId=Number\(button\.dataset\.searchRoom\)/);
 assert.match(app,/adminStudentState\.editId=Number\(button\.dataset\.searchStudent\)/);
 assert.match(css,/@media\(max-width:780px\)/);
 assert.match(css,/\.rd-workspace>\.nav\{display:flex\}/);
 assert.match(sw,/rd-care-shell-v(18|19|20|21|22|23|24|25)/);
 assert.match(sw,/reference-ui\.css/);
});
