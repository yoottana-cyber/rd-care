'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const source=pathToFileURL(path.resolve(__dirname,'../../worker/src/personnel-import.js')).href;
async function load(){return import(source)}
const user={id:42,role:'admin'};
const old=[
 {id:1,username:'teacher01',display_name:'ก่อนอัปเดต',role:'teacher',active:1,deleted_at:null},
 {id:2,username:'staff02',display_name:'เจ้าหน้าที่',role:'staff',active:0,deleted_at:null},
 {id:3,username:'systemadmin',display_name:'Admin',role:'admin',active:1,deleted_at:null}
];
const teacher=(username,password='SyntheticTeacherPassword123')=>({
 username,display_name:'ชื่อทดสอบสำหรับระบบ',role:'teacher',password,source_row:2
});
function env(capture){
 return {DB:{
  prepare(sql){capture.queries.push(sql);return {bind(...values){return {sql,values,
   async all(){return {results:old.filter(x=>values.includes(x.username))}}
  }}}},
  async batch(statements){capture.writes.push(...statements);return []}
 }};
}
function request(mode,people,kind='preview'){
 return new Request('https://rd.test/api/admin/personnel-import/'+kind,{
  method:'POST',body:JSON.stringify({mode,people})
 });
}
test('school personnel preview is read only, skips existing and adds missing',async()=>{
 const {personnelImportEndpoint}=await load(),calls={queries:[],writes:[]};
 const res=await personnelImportEndpoint(request('skip',[teacher('teacher01',''),teacher('teacher99')]),
  env(calls),user,'/api/admin/personnel-import/preview');
 const data=await res.json();
 assert.deepEqual([data.created,data.updated,data.skipped,data.errors],[1,0,1,0]);
 assert.equal(calls.writes.length,0);
 assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal(JSON.stringify(data).includes('SyntheticTeacherPassword123'),false);
});
test('same-person update only sets display_name; never changes role or credentials',async()=>{
 const {personnelImportEndpoint}=await load(),calls={queries:[],writes:[]};
 const res=await personnelImportEndpoint(request('update',[teacher('teacher01','IgnoredPasswordForExisting2026')],'commit'),
  env(calls),user,'/api/admin/personnel-import/commit');
 const data=await res.json();
 assert.equal(data.updated,1);
 assert.equal(data.created,0);
 assert.equal(calls.writes.length,2); // update display_name and insert audit
 assert.ok(calls.writes[0].sql.startsWith('UPDATE users SET display_name=?'));
 assert.equal(calls.writes.some(x=>/password_hash|password_salt|UPDATE users SET role|UPDATE users SET active|DELETE FROM sessions/.test(x.sql)),false);
});
test('no privilege escalation, removed-account resurrection or new weak password',async()=>{
 const {planPersonnelImport}=await load();
 assert.equal(planPersonnelImport([teacher('systemadmin','')],old,'skip').ready,false);
 const changed={...teacher('teacher01',''),role:'staff'};
 assert.equal(planPersonnelImport([changed],old,'update').ready,false);
 assert.equal(planPersonnelImport([teacher('teacher_new','short')],old,'skip').ready,false);
 const oldSuspended=planPersonnelImport([{...teacher('staff02',''),role:'staff'}],old,'update');
 assert.equal(oldSuspended.ready,true);
 assert.match(oldSuspended.items[0].message,/ยังคงถูกพัก/);
});
test('teacher and non-admin cannot import, commit hard limit is five people',async()=>{
 const {personnelImportEndpoint}=await load(),calls={queries:[],writes:[]};
 await assert.rejects(personnelImportEndpoint(request('skip',[teacher('teacher01')]),
  env(calls),{id:7,role:'teacher'},'/api/admin/personnel-import/preview'),e=>e.code===403);
 await assert.rejects(personnelImportEndpoint(request('skip',Array.from({length:6},(_,i)=>
  teacher('teacher'+i)),'commit'),env(calls),user,'/api/admin/personnel-import/commit'),
  e=>e.code===400);
 assert.equal(calls.writes.length,0);
});
