'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const source=pathToFileURL(path.resolve(__dirname,'../../worker/src/advisor-import.js')).href;
async function plan(){return (await import(source)).planAdvisorImport}
const rooms=new Map([['ม.2/1',{id:1,label:'ม.2/1',advisor_user_id:7,advisor2_user_id:null}],
 ['ม.2/2',{id:2,label:'ม.2/2',advisor_user_id:null,advisor2_user_id:null}]]);
const users=[{id:7,username:'existing7',display_name:'ชื่อเดิม',role:'teacher',active:1,deleted_at:null}];
const row=(room,username,name='ชื่อเดิม',password='')=>({classroom:room,username,full_name:name,password,source_row:2});
test('school-host import can skip existing advisor and add a new teacher independently',async()=>{
 const f=await plan();
 const result=f([row('ม.2/1','existing7'),row('ม.2/2','newteacher','ครูใหม่','StrongDemoPassword23')],rooms,users,'skip');
 assert.equal(result.ready,true);
 assert.deepEqual([result.skipped,result.created,result.assigned],[1,1,1]);
});
test('school-host import update mode changes only existing advisor name in preview',async()=>{
 const f=await plan(),p=f([row('ม.2/1','existing7','ชื่อใหม่')],rooms,users,'update');
 assert.equal(p.ready,true);
 assert.equal(p.updated,1);
 assert.equal(p.assigned,0);
 assert.equal(p.items[0].mode,'update_name');
 assert.ok(!JSON.stringify(p).includes('StrongDemoPassword23'));
});
test('same classroom retains its primary teacher while second joins vacant slot',async()=>{
 const f=await plan(),p=f([row('ม.2/1','another_teacher','ครูใหม่','StrongDemoPassword23')],rooms,users,'skip');
 assert.equal(p.ready,true);
 assert.equal(p.items[0].slot,2);
 assert.equal(p.assigned,1);
});
