import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advisorManagementMarkup,resolveTeacherId,teacherLabel,activeTeachers,filterAdvisorRoster}
 from '../web/affairs-people-table.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';

const teachers=[
 {id:1,username:'teacher001',display_name:'นายสมชาย ใจดี',role:'teacher',active:1},
 {id:2,username:'staff001',display_name:'นางสมใจ ใจดี',role:'staff',active:1},
 {id:3,username:'offline001',display_name:'ครูพักบัญชี',role:'teacher',active:0},
 {id:4,username:'admin001',display_name:'ผู้ดูแล',role:'admin',active:1},
 {id:5,username:'teacher002',display_name:'นายสมชาย ใจดี',role:'teacher',active:1}
];
const rooms=Array.from({length:48},(_,i)=>({
 id:i+1,label:'ม.'+(Math.floor(i/8)+1)+'/'+(i%8+1),grade:Math.floor(i/8)+1,
 advisor_user_id:i===0?1:i===1?2:null,
 advisor2_user_id:i===1?5:null,
 advisor_name:i===0?'นายสมชาย ใจดี':i===1?'นางสมใจ ใจดี':null,
 advisor2_name:i===1?'นายสมชาย ใจดี':null
}));
test('renders a 48-row table and six editable grade heads with name/username combobox',()=>{
 const {markup,teachers:choices,rooms:items}=advisorManagementMarkup({
  teachers,rooms,heads:[{grade:2,teacher_user_id:2}]
 });
 assert.equal(items.length,48);
 assert.equal((markup.match(/data-affairs-advisor="\d+"/g)||[]).length,48);
 assert.equal((markup.match(/data-affairs-head="\d+"/g)||[]).length,6);
 assert.match(markup,/<table class="table rd-affairs-advisor-table"/);
 assert.match(markup,/id="rdAffairsTeacherChoices"/);
 assert.match(markup,/type="search" list="rdAffairsTeacherChoices"/);
 assert.match(markup,/ฝ่ายกิจการ/);
 assert.match(markup,/นางสมใจ ใจดี/);
 assert.equal(choices.length,3);
 assert.equal(markup.includes('ครูพักบัญชี'),false);
 assert.equal(markup.includes('ผู้ดูแล'),false);
});
test('exact person names are disambiguated by username; freeform or inactive text is rejected',()=>{
 const active=activeTeachers(teachers);
 assert.equal(resolveTeacherId(teacherLabel(teachers[0]),active),1);
 assert.equal(resolveTeacherId(teacherLabel(teachers[4]),active),5);
 assert.equal(resolveTeacherId(teacherLabel(teachers[1]),active),2);
 assert.equal(resolveTeacherId('',active),null);
 assert.throws(()=>resolveTeacherId('นายสมชาย ใจดี',active),/เลือกชื่อครู/);
 assert.throws(()=>resolveTeacherId(teacherLabel(teachers[2]),active),/เลือกชื่อครู/);
});
test('filters room label, grade, missing coverage and teacher names',()=>{
 assert.equal(filterAdvisorRoster(rooms,{grade:'2'}).length,8);
 assert.equal(filterAdvisorRoster(rooms,{coverage:'missing'}).length,46);
 assert.equal(filterAdvisorRoster(rooms,{query:'ม.1/1'}).length,1);
 assert.equal(filterAdvisorRoster(rooms,{query:'สมใจ'}).length,1);
 const roster=advisorManagementMarkup({teachers,rooms,heads:[]}).rooms;
 assert.equal(filterAdvisorRoster(roster,{query:'staff001'}).length,1);
 assert.equal(filterAdvisorRoster(roster,{coverage:'partial'}).length,1);
});
function post(path,teacher_user_id,actor={id:13,role:'staff'}){
 return {path,actor,req:new Request('https://school.test'+path,{method:'POST',
  body:JSON.stringify({grade:4,teacher_user_id})})};
}
test('active staff student-affairs account can become grade head without role changes',async()=>{
 const sql=[];
 const DB={prepare(query){
  const statement={query,args:[]};sql.push(statement);
  return {bind(...args){statement.args=args;return {
   first:async()=>query.includes("FROM users WHERE id=?")?{id:2}:null,
   run:async()=>({meta:{changes:1}})
  }}};
 }};
 const {path,actor,req}=post('/api/affairs/heads',2);
 const res=await studentAffairsRoutes(req,{DB},actor,path);
 assert.equal(res.status,200);
 assert.equal((await res.json()).ok,true);
 assert.ok(sql.some(x=>x.query.includes("role IN ('teacher','staff')")&&
  x.query.includes('deleted_at IS NULL')));
 assert.ok(sql.some(x=>x.query.includes('INSERT INTO affairs_grade_heads')&&x.args[1]===2));
 assert.equal(sql.some(x=>/UPDATE users|UPDATE.*role|password_hash/.test(x.query)),false);
});
test('inactive staff grade head blocked before upsert and unassigned teacher cannot manage heads',async()=>{
 const queries=[],db={prepare(sql){
  queries.push(sql);
  return {bind(){return {first:async()=>null,run:async()=>({meta:{changes:1}})}}};
 }};
 const x=post('/api/affairs/heads',2);
 await assert.rejects(studentAffairsRoutes(x.req,{DB:db},x.actor,x.path),e=>e.code===400);
 assert.ok(!queries.some(x=>x.includes('INSERT INTO affairs_grade_heads')));
 const y=post('/api/affairs/heads',2,{id:5,role:'teacher'});
 await assert.rejects(studentAffairsRoutes(y.req,{DB:db},y.actor,y.path),e=>e.code===403);
});
test('backend exposes teacher usernames for search and validates active staff as head',()=>{
 const backend=readFileSync(new URL('../worker/src/student-affairs.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../web/student-affairs.js',import.meta.url),'utf8');
 assert.match(backend,/SELECT id,username,display_name,role,active FROM users/);
 assert.match(backend,/role IN \('teacher','staff'\) AND active=1 AND deleted_at IS NULL/);
 assert.match(ui,/rdAffairsAdvisorGrade/);
 assert.match(ui,/rdAffairsAdvisorSearch/);
 assert.match(ui,/data-save-affairs-advisor/);
 assert.match(ui,/teacher2_user_id:second/);
});
