import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/worker.js';
import {bangkokToday,weekday} from '../worker/src/core.js';
const today=bangkokToday(),bearer='Bearer '+'a'.repeat(64);
const base='https://rd.test';
function setup({owner=7,existingNote='หัวข้อเดิม'}={}){
 const executed=[],batched=[];
 const db={
  prepare(sql){
   const entry={sql,params:[]};executed.push(entry);
   return {bind(...args){entry.params=args;return {
    sql,params:args,
    async first(){
     if(sql.includes('FROM sessions s'))return {id:7,role:'teacher',display_name:'ครูทดสอบ',active:1};
     if(sql.includes('SELECT advisor_user_id FROM classrooms'))return {advisor_user_id:7};
     if(sql.includes('SELECT id,classroom_id,teacher_user_id,day_of_week FROM timetable'))return {id:5,classroom_id:2,teacher_user_id:owner,day_of_week:weekday(today)};
     if(sql.includes('FROM period_teaching_logs WHERE timetable_id=? AND school_date=?'))return existingNote?{note:existingNote,updated_at:'2026-10-26 07:00:00'}:null;
     throw Error('Unexpected first query: '+sql);
    },
    async all(){
     if(sql.includes('SELECT s.id FROM students s'))return {results:[{id:10}]};
     if(sql.includes('SELECT p.student_id,p.status FROM attendance_period p'))return {results:[{student_id:10,status:'present'}]};
     throw Error('Unexpected all query: '+sql);
    },
    async run(){return {meta:{changes:1}}}
   }}};
  },
  async batch(items){batched.push(...items);return items.map(()=>({meta:{changes:1}}))}
 };
 return {env:{DB:db},executed,batched};
}
async function post(env,payload){
 return worker.fetch(new Request(base+'/api/attendance',{method:'POST',
  headers:{Authorization:bearer,'content-type':'application/json'},
  body:JSON.stringify({kind:'period',date:today,classroom_id:2,timetable_id:5,
   entries:[{student_id:10,status:'present'}],...payload})}),env);
}
test('teacher loads previously saved optional note for the actual period and date',async()=>{
 const {env,executed}=setup();
 const res=await worker.fetch(new Request(base+'/api/attendance?kind=period&date='+today+'&classroom_id=2&timetable_id=5',
  {headers:{Authorization:bearer}}),env);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.teaching_note,'หัวข้อเดิม');
 assert.equal(body.items[0].status,'present');
 assert.ok(executed.some(x=>x.sql.includes('FROM period_teaching_logs')&&x.params[0]===5&&x.params[1]===today));
});
test('optional note saved in same batch as period attendance, including edited note',async()=>{
 const {env,executed,batched}=setup();
 const res=await post(env,{teaching_note:'  เรื่อง เงื่อนไข if  '});
 assert.equal(res.status,200);
 const result=await res.json();assert.equal(result.saved,1);
 assert.equal(batched.length,6); // attendance, alert resolution, notification cleanup, note, note audit, attendance audit
 const note=executed.find(x=>x.sql.includes('INSERT INTO period_teaching_logs'));
 assert.deepEqual(note.params,[5,today,'เรื่อง เงื่อนไข if',7]);
 assert.ok(batched.some(x=>x.sql.includes('INSERT INTO attendance_period')));
});
test('leaving note out does not force note creation; deliberately clearing deletes it',async()=>{
 const original=setup();
 assert.equal((await post(original.env,{})).status,200);
 assert.equal(original.executed.some(x=>x.sql.includes('period_teaching_logs')),false);
 const clearing=setup();
 assert.equal((await post(clearing.env,{teaching_note:''})).status,200);
 assert.ok(clearing.executed.some(x=>x.sql.includes('DELETE FROM period_teaching_logs')));
});
test('overlong or non-string teaching notes are rejected before writing attendance',async()=>{
 for(const bad of ['x'.repeat(2001),12,null,{text:'abc'}]){
  const {env,batched}=setup();
  const res=await post(env,{teaching_note:bad});
  assert.equal(res.status,400);
  assert.equal(batched.length,0);
 }
});
test('teacher cannot read or write a lesson owned by another teacher',async()=>{
 const read=setup({owner:99});
 const res=await worker.fetch(new Request(base+'/api/attendance?kind=period&date='+today+'&classroom_id=2&timetable_id=5',
  {headers:{Authorization:bearer}}),read.env);
 assert.equal(res.status,403);
 assert.equal(read.executed.some(x=>x.sql.includes('FROM period_teaching_logs')),false);
 const write=setup({owner:99});
 assert.equal((await post(write.env,{teaching_note:'ทดลอง'})).status,403);
 assert.equal(write.batched.length,0);
});
