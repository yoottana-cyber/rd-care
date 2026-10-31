'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function modules(){
 const src=path.resolve(__dirname,'../../worker/src/advisor-import.js');
 const web=path.resolve(__dirname,'../../web/advisor-import.js');
 const worker=await import('file://'+src);
 const uiSource=fs.readFileSync(web,'utf8');
 const match=uiSource.match(/export function advisorRoomBatches\([\s\S]*?\n}\n/);
 assert.ok(match,'room batching helper must exist');
 const pack=new Function(match[0].replace('export ', '')+';return advisorRoomBatches;')();
 return {plan:worker.planAdvisorImport,pack};
}
test('production-compatible school Node module replaces assigned advisors in two full rooms',async()=>{
 const {plan}=await modules();
 const rooms=new Map([['ม.1/1',{id:1,label:'ม.1/1',advisor_user_id:10,advisor2_user_id:11}],
  ['ม.1/2',{id:2,label:'ม.1/2',advisor_user_id:12,advisor2_user_id:13}]]);
 const users=[{id:10,username:'old_10',display_name:'ครูเดิม 10',role:'teacher',active:1},
  {id:11,username:'old_11',display_name:'ครูเดิม 11',role:'teacher',active:1},
  {id:12,username:'old_12',display_name:'ครูเดิม 12',role:'teacher',active:1},
  {id:13,username:'old_13',display_name:'ครูเดิม 13',role:'teacher',active:1}];
 const rows=[{classroom:'ม.1/1',full_name:'ครูเดิม 12',username:'old_12',password:''},
  {classroom:'ม.1/2',full_name:'ครูเดิม 10',username:'old_10',password:''}];
 const result=plan(rows,rooms,users,'replace');
 assert.equal(result.ready,true);
 assert.equal(result.replacedRooms,2);
 assert.equal(result.created,0);
 assert.equal(result.errors,0);
});
test('room-level batches never split advisor pairs, even when input is interleaved',async()=>{
 const {pack}=await modules();
 const rows=['ม.1/1','ม.1/2','ม.1/3','ม.1/1','ม.1/2','ม.1/3'].map(classroom=>({classroom}));
 const batches=pack(rows,5);
 assert.deepEqual(batches.map(x=>x.length),[4,2]);
 assert.equal(batches.flat().length,6);
});
