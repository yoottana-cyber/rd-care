import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPersonnelImport,personnelImportEndpoint} from '../worker/src/personnel-import.js';
import {parsePersonnelImportRows} from '../web/personnel-import.js';
import {csvRows} from '../web/unified-import.js';
import {buildPersonnelExampleXlsx} from '../web/template-xlsx.js';

const existing=[
 {id:1,username:'teacher01',display_name:'ครูเดิม',role:'teacher',active:1,deleted_at:null},
 {id:2,username:'staff02',display_name:'บุคลากรเดิม',role:'staff',active:0,deleted_at:null},
 {id:3,username:'systemadmin',display_name:'ผู้ดูแล',role:'admin',active:1,deleted_at:null},
 {id:4,username:'deleted04',display_name:'ถูกลบ',role:'teacher',active:0,deleted_at:'2026-10-29'}
];
const make=(username,display_name='ครูที่อัปเดต',role='teacher',password='MySyntheticTeacherPass123')=>
 ({source_row:2,username,display_name,role,password});

test('skip existing by default, add only missing accounts, never echo passwords',()=>{
 const result=planPersonnelImport([make('teacher01','เปลี่ยนชื่อคนเดิม'),make('teacher99')],existing);
 assert.equal(result.ready,true);
 assert.deepEqual([result.created,result.updated,result.skipped],[1,0,1]);
 assert.deepEqual(result.items.map(x=>x.status),['skipped','ready']);
 assert.equal(JSON.stringify(result).includes('MySyntheticTeacherPass123'),false);
});
test('update existing changes only names and never password, role, sessions or assignment',async()=>{
 const queries=[];
 const env={DB:{
  prepare(sql){return {sql,bind(...values){return {sql,values,async all(){
    return {results:existing.filter(x=>values.includes(x.username))};
   }}}}},
  async batch(commands){queries.push(...commands);return []}
 }};
 const req=new Request('https://rd.test/api/admin/personnel-import/commit',{method:'POST',body:JSON.stringify({
  mode:'update',people:[make('teacher01','ชื่อใหม่','teacher','ThisIsNotANewPassword2026')]
 })});
 const response=await personnelImportEndpoint(req,env,{id:10,role:'admin'},'/api/admin/personnel-import/commit');
 const result=await response.json();
 assert.equal(result.updated,1);
 assert.equal(result.created,0);
 assert.equal(queries.some(x=>x.sql.startsWith('UPDATE users SET display_name=?')),true);
 assert.equal(queries.some(x=>/password_hash|password_salt|sessions|student_affairs_assignments/.test(x.sql)),false);
 assert.equal(JSON.stringify(result).includes('ThisIsNotANewPassword2026'),false);
});
test('preview is read-only and omits passwords',async()=>{
 const calls=[],env={DB:{prepare(sql){calls.push(sql);return {bind(){return {all:async()=>({results:existing})}}}}}};
 const req=new Request('https://rd.test/api/admin/personnel-import/preview',{method:'POST',body:JSON.stringify({
  mode:'skip',people:[make('teacher01')]
 })});
 const res=await personnelImportEndpoint(req,env,{id:10,role:'admin'},'/api/admin/personnel-import/preview');
 const data=await res.json();
 assert.equal(data.skipped,1);
 assert.equal(calls.length,1);assert.match(calls[0],/^SELECT /);
 assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal(JSON.stringify(data).includes('MySyntheticTeacherPass123'),false);
});
test('role escalation, duplicate users and deleted/admin users are blocked',()=>{
 assert.equal(planPersonnelImport([make('teacher01','ชื่อใหม่','staff')],existing,'update').ready,false);
 assert.equal(planPersonnelImport([make('systemadmin')],existing,'skip').ready,false);
 assert.equal(planPersonnelImport([make('deleted04')],existing,'skip').ready,false);
 assert.equal(planPersonnelImport([make('teacherx'),make('TEACHERX')],existing).ready,false);
 assert.equal(planPersonnelImport([make('newstaff','พนักงาน','staff','short')],existing).ready,false);
 assert.equal(planPersonnelImport([make('new01','ครูใหม่','admin')],existing).ready,false);
 assert.equal(planPersonnelImport([make('new01','ครูใหม่','teacher','abc')],existing).ready,false);
});
test('paused existing account stays paused; blank existing password is permitted',()=>{
 const result=planPersonnelImport([make('staff02','ชื่อใหม่','staff','')],existing,'update');
 assert.equal(result.ready,true);
 assert.equal(result.updated,1);
 assert.match(result.items[0].message,/ยังคงถูกพัก/);
});
test('non-admin, unsupported modes and oversized commits rejected',async()=>{
 const req=(mode,people)=>new Request('https://rd.test/api/admin/personnel-import/commit',{
  method:'POST',body:JSON.stringify({mode,people})
 });
 await assert.rejects(personnelImportEndpoint(req('skip',[make('teacher01')]),{},
  {role:'teacher'},'/api/admin/personnel-import/commit'),e=>e.code===403);
 await assert.rejects(personnelImportEndpoint(req('reset',[make('teacher01')]),{},
  {role:'admin'},'/api/admin/personnel-import/commit'),e=>e.code===400);
 await assert.rejects(personnelImportEndpoint(req('skip',Array.from({length:6},(_,i)=>make('new'+i))),{},
  {role:'admin'},'/api/admin/personnel-import/commit'),e=>e.code===400);
});
test('Thai CSV/XLSX templates and UI wiring agree',()=>{
 const parsed=parsePersonnelImportRows(csvRows(
  'username,full_name,role,password\nteacherx,ครูหนึ่ง,teacher,StrongSyntheticPassword123\nstaffx,บุคลากรหนึ่ง,staff,LongSyntheticStaffPassword123'
 ));
 assert.equal(parsed.length,2);
 assert.equal(parsed.every(x=>x.status==='pending'),true);
 const xlsx=new TextDecoder().decode(buildPersonnelExampleXlsx());
 assert.match(xlsx,/Personnel/);assert.match(xlsx,/Tahoma/);
 const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
 assert.match(read('../web/personnel-import.js'),/personnel-import\/commit/);
 assert.match(read('../worker/src/worker.js'),/personnelImportEndpoint/);
 assert.match(read('../web/admin-settings.js'),/personnelImporter\?\.render/);
 assert.match(read('../web/sw.js'),/personnel-import\.csv/);
});
