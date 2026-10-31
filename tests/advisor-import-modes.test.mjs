import test from 'node:test';
import assert from 'node:assert/strict';
import {planAdvisorImport,advisorImportEndpoint} from '../worker/src/advisor-import.js';

const rooms=new Map([
 ['ม.1/1',{id:1,label:'ม.1/1',advisor_user_id:10,advisor2_user_id:11}],
 ['ม.1/2',{id:2,label:'ม.1/2',advisor_user_id:null,advisor2_user_id:null}],
 ['ม.1/3',{id:3,label:'ม.1/3',advisor_user_id:12,advisor2_user_id:null}]
]);
const users=[
 {id:10,username:'teacher_a',display_name:'ครู ก',role:'teacher',active:1,deleted_at:null},
 {id:11,username:'teacher_b',display_name:'ครู ข',role:'teacher',active:1,deleted_at:null},
 {id:12,username:'affairs_c',display_name:'ครูฝ่ายกิจการ',role:'staff',active:1,deleted_at:null},
 {id:20,username:'inactive_d',display_name:'ครู ง',role:'teacher',active:0,deleted_at:null},
 {id:21,username:'admin_e',display_name:'แอดมิน',role:'admin',active:1,deleted_at:null}
];
const row=(classroom,username,full_name='ครู ก',password='')=>({classroom,username,full_name,password,source_row:2});
function makeDb(){
 const statements=[];
 return {statements,DB:{prepare(sql){return {sql,bind(...args){return {sql,args}}}},
  async batch(group){
   if(group.every(x=>x.sql.startsWith('SELECT')))return [
    {results:[...rooms.values()]},{results:users}
   ];
   statements.push(...group);return group.map(()=>({success:true,meta:{changes:1}}));
  }}};
}
const request=(rows,existingMode='skip',commit=false)=>new Request('https://school.example/api/admin/advisors/'+(commit?'commit':'preview'),
 {method:'POST',body:JSON.stringify({advisors:rows,existingMode})});

test('skip preserves an already assigned homeroom teacher even with a changed name or password in the file',()=>{
 const result=planAdvisorImport([row('ม.1/1','teacher_a','ชื่อที่ต่างจากระบบ','NotForOverwrite')],rooms,users,'skip');
 assert.deepEqual([result.ready,result.assigned,result.skipped,result.updated],[true,0,1,0]);
 assert.equal(result.items[0].mode,'skip');
 assert.equal(JSON.stringify(result).includes('NotForOverwrite'),false);
});
test('existing homeroom teacher update only modifies display name, keeping slot 1 and another teacher intact',()=>{
 const result=planAdvisorImport([row('ม.1/1','teacher_a','ครู ก ชื่อแก้ไข')],rooms,users,'update');
 assert.deepEqual([result.ready,result.assigned,result.skipped,result.updated],[true,0,0,1]);
 assert.equal(result.items[0].mode,'update_name');
 assert.equal(result.items[0].slot,1);
});
test('existing teacher can be linked to an empty second classroom and optionally update display name',()=>{
 const existing=planAdvisorImport([row('ม.1/2','teacher_a')],rooms,users,'skip');
 assert.deepEqual([existing.ready,existing.assigned,existing.updated],[true,1,0]);
 assert.equal(existing.items[0].mode,'link');
 const change=planAdvisorImport([row('ม.1/2','teacher_a','เปลี่ยนชื่อ ก')],rooms,users,'update');
 assert.equal(change.items[0].mode,'link_update');
 assert.deepEqual([change.assigned,change.updated],[1,1]);
});
test('full two-advisor room cannot be overwritten and inactive/admin credentials cannot be linked',()=>{
 const plan=planAdvisorImport([row('ม.1/1','new_teacher','คนอื่น','LongEnoughTeacherPassword')],rooms,users,'update');
 assert.equal(plan.ready,false);
 assert.match(plan.items[0].message,/ครบ 2 คน/);
 assert.equal(planAdvisorImport([row('ม.1/2','inactive_d')],rooms,users,'skip').ready,false);
 assert.equal(planAdvisorImport([row('ม.1/2','admin_e')],rooms,users,'update').ready,false);
});
test('staff that already teaches is retained as advisor without role conversion',()=>{
 const result=planAdvisorImport([row('ม.1/3','affairs_c','ครูฝ่ายกิจการ')],rooms,users,'skip');
 assert.equal(result.ready,true);
 assert.equal(result.skipped,1);
});
test('new accounts and second advisor slots remain supported without username duplication',()=>{
 const base=planAdvisorImport([
  row('ม.1/2','new_teacher','ครูใหม่','LongEnoughTeacherPassword'),
  row('ม.1/2','new_teacher2','ครูใหม่อีกคน','LongEnoughTeacherPassword2')
 ],rooms,users,'skip');
 assert.equal(base.ready,true);
 assert.deepEqual(base.items.map(x=>x.slot),[1,2]);
 const duplicated=planAdvisorImport([
  row('ม.1/2','new_teacher','ครูใหม่','LongEnoughTeacherPassword'),
  row('ม.1/3','new_teacher','ครูใหม่','LongEnoughTeacherPassword')
 ],rooms,users,'update');
 assert.equal(duplicated.ready,false);
});
test('preview is read-only; duplicate import commit with skip creates no mutations',async()=>{
 const env=makeDb();
 const admin={id:1,role:'admin'};
 const input=[row('ม.1/1','teacher_a','ครูแก้ชื่อ','TryToReplacePassword')];
 const pre=await advisorImportEndpoint(request(input),env,admin,'/api/admin/advisors/preview');
 assert.equal((await pre.json()).skipped,1);
 assert.equal(env.statements.length,0);
 const committed=await advisorImportEndpoint(request(input,'skip',true),env,admin,'/api/admin/advisors/commit');
 const data=await committed.json();
 assert.deepEqual([data.assigned,data.created,data.updated,data.skipped],[0,0,0,1]);
 assert.equal(env.statements.length,0);
});
test('update commit writes only name and audit, never password, role, sessions or classroom slots',async()=>{
 const env=makeDb();
 const res=await advisorImportEndpoint(request([row('ม.1/1','teacher_a','ครูชื่อใหม่')],'update',true),
  env,{id:1,role:'admin'},'/api/admin/advisors/commit');
 const data=await res.json();
 assert.equal(data.ok,true);
 assert.deepEqual([data.assigned,data.updated,data.skipped],[0,1,0]);
 assert.equal(env.statements.length,2);
 assert.match(env.statements[0].sql,/UPDATE users SET display_name/);
 assert.ok(env.statements.every(x=>!/password_hash|password_salt|UPDATE classrooms|DELETE FROM sessions|SET role=|SET active=/.test(x.sql)));
});
test('link existing teacher only fills a vacant advisor slot, without replacing an existing assignment',async()=>{
 const env=makeDb();
 const res=await advisorImportEndpoint(request([row('ม.1/3','teacher_b','ครู ข')],'skip',true),
  env,{id:1,role:'admin'},'/api/admin/advisors/commit');
 const data=await res.json();
 assert.equal(data.assigned,1);
 const update=env.statements.find(x=>x.sql.startsWith('UPDATE classrooms'));
 assert.ok(update);
 assert.match(update.sql,/advisor2_user_id/);
 assert.match(update.sql,/IS NULL/);
});
test('invalid mode and non-admin cannot import',async()=>{
 const env=makeDb();
 await assert.rejects(advisorImportEndpoint(request([row('ม.1/1','teacher_a')],'reset'),env,
  {id:1,role:'admin'},'/api/admin/advisors/preview'),e=>e.code===400);
 await assert.rejects(advisorImportEndpoint(request([row('ม.1/1','teacher_a')]),env,
  {id:2,role:'teacher'},'/api/admin/advisors/preview'),e=>e.code===403);
});
