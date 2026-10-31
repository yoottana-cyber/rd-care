import test from 'node:test';
import assert from 'node:assert/strict';
import {planAdvisorImport,advisorImportEndpoint} from '../worker/src/advisor-import.js';
import {prepareAdvisorRows,advisorRoomBatches} from '../web/advisor-import.js';
const rooms=new Map([
 ['ม.1/1',{id:1,label:'ม.1/1',advisor_user_id:10,advisor2_user_id:11}],
 ['ม.1/2',{id:2,label:'ม.1/2',advisor_user_id:12,advisor2_user_id:13}],
 ['ม.1/3',{id:3,label:'ม.1/3',advisor_user_id:14,advisor2_user_id:null}]
]);
const users=[
 {id:10,username:'teacher10',display_name:'ครูเก่า 10',role:'teacher',active:1},
 {id:11,username:'teacher11',display_name:'ครูเก่า 11',role:'teacher',active:1},
 {id:12,username:'teacher12',display_name:'ครูเก่า 12',role:'teacher',active:1},
 {id:13,username:'teacher13',display_name:'ครูเก่า 13',role:'teacher',active:1},
 {id:14,username:'staff14',display_name:'ครูฝ่ายกิจการ',role:'staff',active:1},
 {id:30,username:'teacher30',display_name:'ครูใหม่ที่มีบัญชี',role:'teacher',active:1}
];
const row=(classroom,username,full_name,password='')=>({classroom,username,full_name,password,source_row:3});
const example=[
 row('ม.1/1','teacher30','ครูใหม่ที่มีบัญชี'),
 row('ม.1/1','teacher12','ครูเก่า 12'),
 row('ม.1/2','staff14','ครูฝ่ายกิจการ')
];
test('replace changes advisors of full rooms and clears old second teacher when one row supplied',()=>{
 const plan=planAdvisorImport(example,rooms,users,'replace');
 assert.equal(plan.ready,true);
 assert.equal(plan.replacedRooms,2);
 assert.equal(plan.created,0);
 assert.ok(plan.items.every(x=>x.status==='ready'));
 assert.equal(plan.items[0].mode,'replace');
});
test('teacher can appear in two different rooms in same file while duplicate within one room fails',()=>{
 const roomLabels=[...rooms].map(([,r])=>r);
 const raw=[['classroom','full_name','username','password'],
  ['ม.1/1','ครูใหม่ที่มีบัญชี','teacher30',''],
  ['ม.1/2','ครูใหม่ที่มีบัญชี','teacher30','']];
 const parsed=prepareAdvisorRows(raw,roomLabels,{existingMode:'replace'});
 assert.equal(parsed.every(x=>x.status==='ready'),true);
 const plan=planAdvisorImport(parsed.map(x=>x.values),rooms,users,'replace');
 assert.equal(plan.ready,true);
 assert.equal(plan.created,0);
 const bad=prepareAdvisorRows([...raw,['ม.1/2','ครูใหม่ที่มีบัญชี','teacher30','']],roomLabels,{existingMode:'replace'});
 assert.equal(bad[2].status,'error');
});
test('room batching keeps two teachers of a classroom in same 5-row commit',()=>{
 const rows=[row('ม.1/1','a','ครู A'),row('ม.1/2','c','ครู C'),row('ม.1/1','b','ครู B'),
  row('ม.1/2','d','ครู D'),row('ม.1/3','e','ครู E'),row('ม.1/3','f','ครู F')];
 const batches=advisorRoomBatches(rows,5);
 assert.deepEqual(batches.map(group=>group.length),[4,2]);
 assert.equal(batches[0][0].classroom,'ม.1/1');
 assert.equal(batches[0][1].classroom,'ม.1/1');
});
test('same-file reimport with matching room assignments has zero writes',()=>{
 const plan=planAdvisorImport([
  row('ม.1/1','teacher10','ครูเก่า 10'),
  row('ม.1/1','teacher11','ครูเก่า 11')
 ],rooms,users,'replace');
 assert.equal(plan.replacedRooms,0);
 assert.equal(plan.skipped,2);
});
test('new username requires password; old account password is ignored and never reset',()=>{
 const plan=planAdvisorImport([
  row('ม.1/1','teacher30','ครูใหม่ที่มีบัญชี','abcd'),
  row('ม.1/2','teacher99','ยังไม่มีบัญชี','')
 ],rooms,users,'replace');
 assert.equal(plan.ready,false);
 assert.match(plan.items[1].message,/Password/);
 assert.ok(!JSON.stringify(plan).includes('abcd'));
});
test('conflicting names for same username across classrooms are rejected to avoid wrong identity update',()=>{
 const plan=planAdvisorImport([
  row('ม.1/1','teacher30','ครูใหม่ที่มีบัญชี'),
  row('ม.1/2','teacher30','คนอื่น')
 ],rooms,users,'replace');
 assert.equal(plan.ready,false);
});
test('only listed room gets two advisor slots overwritten atomically; no attendance or password modifications',async()=>{
 const calls=[];
 const env={DB:{
  prepare(sql){return {sql,bind(...values){return {sql,values}}}},
  async batch(statements){
   if(statements.every(x=>x.sql.startsWith('SELECT')))return [{results:[...rooms.values()]},{results:users}];
   calls.push(...statements);return statements.map(()=>({success:true,meta:{changes:1}}));
  }
 }};
 const payload={existingMode:'replace',advisors:[row('ม.1/1','teacher30','ครูใหม่ที่มีบัญชี')]};
 const request=new Request('https://school.test/api/admin/advisors/commit',{
  method:'POST',body:JSON.stringify(payload)});
 const result=await advisorImportEndpoint(request,env,{id:4,role:'admin'},'/api/admin/advisors/commit');
 const body=await result.json();
 assert.equal(body.ok,true);
 assert.equal(body.replacedRooms,1);
 const updates=calls.filter(x=>x.sql.startsWith('UPDATE classrooms'));
 assert.equal(updates.length,1);
 assert.match(updates[0].sql,/advisor_user_id=.*advisor2_user_id=/);
 assert.equal(updates[0].values[0],'teacher30');
 assert.equal(updates[0].values[1],null);
 assert.equal(updates[0].values[2],1);
 assert.equal(calls.some(x=>/UPDATE students|student_enrollments|attendance|password_hash|password_salt/.test(x.sql)),false);
});
test('preview is read only and existing passwords never appear in result',async()=>{
 let writes=0;
 const env={DB:{
  prepare(sql){return {sql}},
  async batch(statements){
   if(statements.every(x=>x.sql.startsWith('SELECT')))return [{results:[...rooms.values()]},{results:users}];
   writes++;return [];
  }
 }};
 const payload={existingMode:'replace',advisors:[row('ม.1/1','teacher30','ครูใหม่ที่มีบัญชี','PreviousSecret123')]};
 const r=await advisorImportEndpoint(new Request('https://school.test/api/admin/advisors/preview',
  {method:'POST',body:JSON.stringify(payload)}),env,{id:4,role:'admin'},'/api/admin/advisors/preview');
 assert.equal((await r.json()).replacedRooms,1);
 assert.equal(writes,0);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
