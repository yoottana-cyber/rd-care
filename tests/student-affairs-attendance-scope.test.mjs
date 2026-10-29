import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/worker.js';
import {bangkokToday,weekday} from '../worker/src/core.js';

const date=bangkokToday();
const token='a'.repeat(64),base='https://rd.test',auth={Authorization:'Bearer '+token};
function setup({role='staff',id=7,primary=8,secondary=null,owner=8}={}){
 const statements=[],batched=[];
 const db={
  prepare(sql){
   const item={sql,args:[]};statements.push(item);
   return {bind(...args){item.args=args;return {
    async first(){
     if(sql.includes('FROM sessions s JOIN users u'))
      return {id,role,active:1,display_name:'ผู้ใช้ทดสอบ'};
     if(sql.includes('SELECT advisor_user_id,advisor2_user_id FROM classrooms'))
      return {advisor_user_id:primary,advisor2_user_id:secondary};
     if(sql.includes('SELECT id,classroom_id,teacher_user_id,day_of_week FROM timetable'))
      return {id:5,classroom_id:2,teacher_user_id:owner,day_of_week:weekday(date)};
     if(sql.includes('FROM period_teaching_logs WHERE timetable_id'))return null;
     throw Error('Unexpected SQL first: '+sql);
    },
    async all(){
     if(sql.includes('SELECT s.id FROM students s'))return {results:[{id:10}]};
     if(sql.includes('SELECT a.student_id,a.status FROM attendance_daily a'))return {results:[{student_id:10,status:'present'}]};
     if(sql.includes('FROM attendance_period p'))return {results:[{student_id:10,status:'present'}]};
     if(sql.includes('FROM attendance_daily d'))return {results:[{student_id:10,status:'present'}]};
     throw Error('Unexpected SQL all: '+sql);
    },
    async run(){return {meta:{changes:1}}}
   }}};
  },
  async batch(rows){batched.push(...rows);return rows.map(()=>({meta:{changes:1}}))}
 };
 return {env:{DB:db},statements,batched};
}
async function read(env,kind){
 const query='?kind='+kind+'&date='+date+'&classroom_id=2'+(kind==='period'?'&timetable_id=5':'');
 return worker.fetch(new Request(base+'/api/attendance'+query,{headers:auth}),env);
}
async function save(env,kind){
 return worker.fetch(new Request(base+'/api/attendance',{method:'POST',
  headers:{...auth,'content-type':'application/json'},
  body:JSON.stringify({kind,date,classroom_id:2,timetable_id:kind==='period'?5:undefined,
   entries:[{student_id:10,status:'present'}]})}),env);
}
test('Student Affairs staff cannot read or record daily check-in for another homeroom',async()=>{
 const external=setup({role:'staff',primary:11,secondary:12});
 assert.equal((await read(external.env,'daily')).status,403);
 assert.equal((await save(external.env,'daily')).status,403);
 assert.equal(external.batched.length,0);
 assert.equal(external.statements.some(x=>x.sql.includes('INSERT INTO attendance_daily')),false);
});
test('Student Affairs primary and secondary advisors can both check their own room',async()=>{
 for(const room of [{primary:7,secondary:11},{primary:11,secondary:7}]){
  const own=setup({role:'staff',...room});
  assert.equal((await read(own.env,'daily')).status,200);
  assert.equal((await save(own.env,'daily')).status,200);
  assert.ok(own.batched.some(x=>x.sql.includes('INSERT INTO attendance_daily')));
 }
});
test('Student Affairs staff can check only personally owned timetable periods',async()=>{
 const foreign=setup({role:'staff',primary:7,owner:99});
 assert.equal((await read(foreign.env,'period')).status,403);
 assert.equal((await save(foreign.env,'period')).status,403);
 assert.equal(foreign.batched.length,0);
 const own=setup({role:'staff',primary:99,owner:7});
 assert.equal((await read(own.env,'period')).status,200);
 assert.equal((await save(own.env,'period')).status,200);
 assert.ok(own.batched.some(x=>x.sql.includes('INSERT INTO attendance_period')));
});
test('Admin can still handle school-wide daily and period check-in',async()=>{
 const admin=setup({role:'admin',primary:55,owner:88});
 assert.equal((await read(admin.env,'daily')).status,200);
 assert.equal((await save(admin.env,'daily')).status,200);
 assert.equal((await read(admin.env,'period')).status,200);
 assert.equal((await save(admin.env,'period')).status,200);
});
test('teacher role still requires advisor ownership for daily and teacher ownership for period',async()=>{
 const noAdvisor=setup({role:'teacher',primary:88,owner:7});
 assert.equal((await save(noAdvisor.env,'daily')).status,403);
 assert.equal((await save(noAdvisor.env,'period')).status,200);
 const noLesson=setup({role:'teacher',primary:7,owner:88});
 assert.equal((await save(noLesson.env,'daily')).status,200);
 assert.equal((await save(noLesson.env,'period')).status,403);
});
