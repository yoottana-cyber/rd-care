import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeBehaviorStudentIds,searchBehaviorStudents,recordBehaviorBulk} from '../worker/src/behavior-bulk.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';

const user={role:'teacher',id:7,student_affairs:0};
const rule={id:4,name:'ช่วยดูแลความสะอาดห้องเรียน',category:'good',points:5,active:1};
function fakeDb({authorized=[12,13],searchItems=[],scoreRule=rule}={}){
 const calls=[],batches=[];
 return {calls,batches,DB:{
  prepare(sql){
   const entry={sql,args:[]};calls.push(entry);
   return {bind(...args){
    entry.args=args;
    return {
     first:async()=>sql.includes('FROM affairs_behavior_rules')?scoreRule:null,
     all:async()=>({results:sql.includes('FROM students s WHERE s.active=1')?
      authorized.map(id=>({id})):sql.includes('FROM behavior_incidents')?
      authorized.map((student_id,i)=>({id:100+i,student_id,affairs_rule_id:4,
       affairs_category:scoreRule.category,points_applied:scoreRule.points,
       warning_no:0,behavior_record_id:200+i})):searchItems})
    };
   }};
  },
  batch:async statements=>{
   batches.push(statements);
   const token=statements[0]?.args?.[3];
   return statements.map((x,i)=>i===statements.length-1?{
    success:true,results:authorized.map((student_id,j)=>({
     id:100+j,student_id,affairs_rule_id:scoreRule.id,reason:scoreRule.name,
     affairs_category:scoreRule.category,points_applied:scoreRule.points,
     warning_no:0,behavior_record_id:200+j}))
   }:{success:true,meta:{changes:4,last_row_id:900+i}});
  }
 }};
}
const post=(path,body)=>new Request('https://rd-care.test'+path,
 {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('bulk selection limits and duplicate identifiers are validated',()=>{
 assert.deepEqual(normalizeBehaviorStudentIds(['12',13]),[12,13]);
 for(const ids of [[],[12,12],[0],[1.5],Array.from({length:201},(_,i)=>i+1)])
  assert.throws(()=>normalizeBehaviorStudentIds(ids),{code:400});
});

test('teacher number/name lookup applies advisor or timetable access filter',async()=>{
 const rows=[{id:12,student_no:'000123',full_name:'นักเรียน ก',classroom_id:3,classroom_label:'ม.1/3'}];
 const env=fakeDb({searchItems:rows});
 const path='/api/affairs/behavior/students';
 const response=await studentAffairsRoutes(new Request('https://rd-care.test'+path+'?query=00123'),
  {DB:env.DB},user,path);
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).items,rows);
 const query=env.calls.find(x=>x.sql.includes('FROM students s JOIN classrooms'));
 assert.match(query.sql,/t\.teacher_user_id=\?/);
 assert.match(query.sql,/c2\.advisor_user_id=\?/);
 assert.deepEqual(query.args,['00123','00123',7,7,'00123']);
 const staffEnv=fakeDb();
 await searchBehaviorStudents(new Request('https://rd-care.test'+path+'?query=123'),
  {DB:staffEnv.DB},{role:'staff',id:2});
 assert.doesNotMatch(staffEnv.calls[0].sql,/teacher_user_id=\?/);
});

test('bulk merit recording defaults blank description to approved rule and audits every row atomically',async()=>{
 const env=fakeDb(),path='/api/affairs/behavior/record/bulk';
 const response=await studentAffairsRoutes(post(path,{student_ids:[12,13],rule_id:4,reason:''}),
  {DB:env.DB},user,path);
 assert.equal(response.status,201);
 const result=await response.json();
 assert.equal(result.ok,true);
 assert.equal(result.count,2);
 assert.equal(result.merited,2);
 assert.equal(result.warned,0);
 assert.equal(result.points,5);
 assert.equal(result.rule_name,rule.name);
 assert.equal(env.batches.length,1);
 const inserts=env.calls.filter(x=>x.sql.includes('INSERT INTO behavior_incidents'));
 assert.equal(inserts.length,2);
 assert.deepEqual([inserts[0].args[0],inserts[0].args[1],inserts[0].args[2],...inserts[0].args.slice(4)],
  [12,rule.name,7,12,4,4]);
 assert.deepEqual([inserts[1].args[0],inserts[1].args[1],inserts[1].args[2],...inserts[1].args.slice(4)],
  [13,rule.name,7,13,4,4]);
 assert.equal(env.batches[0].length,3); // 2 inserts + receipt SELECT
 assert.match(inserts[0].args[3],/^[0-9a-f-]{36}$/);
 assert.equal(inserts[0].args[3],inserts[1].args[3]);
 assert.equal(result.items[0].incident_id,100);
});

test('unauthorized room rejects entire batch before any data is written',async()=>{
 const env=fakeDb({authorized:[12]}),path='/api/affairs/behavior/record/bulk';
 await assert.rejects(()=>studentAffairsRoutes(post(path,
  {student_ids:[12,13],rule_id:4}),{DB:env.DB},user,path),{code:403});
 assert.equal(env.batches.length,0);
});

test('bulk score endpoint disallows raw points and non-approved categories',async()=>{
 const env=fakeDb(),path='/api/affairs/behavior/record/bulk';
 await assert.rejects(()=>recordBehaviorBulk({DB:env.DB},user,
  {student_ids:[12,13],rule_id:4,points:100}),{code:400});
 const invalid=fakeDb({scoreRule:{...rule,category:'adjustment'}});
 await assert.rejects(()=>recordBehaviorBulk({DB:invalid.DB},user,
  {student_ids:[12],rule_id:4}),{code:400});
 assert.equal(env.batches.length,0);
 assert.equal(invalid.batches.length,0);
});

test('teacher UI includes multi-room, student number lookup and optional description in both score modes',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 const ui=read('web/score-recording.js'),app=read('web/app.js'),html=read('web/index.html');
 assert.match(ui,/data-score-choice/);
 assert.match(ui,/scoreSearchForm/);
 assert.match(ui,/scoreRoom/);
 assert.match(ui,/scoreToggleRoom/);
 assert.match(ui,/record\/bulk/);
 assert.match(ui,/scoreReason.*ไม่บังคับ/);
 assert.doesNotMatch(ui,/<textarea[^>]*required/);
 assert.match(app,/createScoreRecording/);
 assert.match(html,/score-recording\.css/);
});
