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
      authorized.map(id=>({id})):searchItems})
    };
   }};
  },
  batch:async statements=>{batches.push(statements);return statements.map(()=>({meta:{changes:1}}));}
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
 assert.deepEqual(await response.json(),{ok:true,count:2,points:5,category:'good',rule_name:rule.name});
 assert.equal(env.batches.length,1);
 const inserts=env.calls.filter(x=>x.sql.includes('INSERT INTO behavior_records'));
 const logs=env.calls.filter(x=>x.sql.includes('INSERT INTO audit_logs'));
 assert.equal(inserts.length,2);
 assert.equal(logs.length,2);
 assert.deepEqual(inserts[0].args,[12,5,rule.name,7,4,'good']);
 assert.deepEqual(inserts[1].args,[13,5,rule.name,7,4,'good']);
 assert.ok(logs.every(x=>x.sql.includes('last_insert_rowid()')));
 assert.equal(env.batches[0].length,4);
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
