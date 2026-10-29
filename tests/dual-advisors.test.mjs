import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
import {planAdvisorImport} from '../worker/src/advisor-import.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const post=(path,body)=>new Request('https://school.test'+path,{method:'POST',
 headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('Student Affairs assigns one or two distinct advisors without changing roles',async()=>{
 const calls=[],db={prepare(sql){return {bind(...args){calls.push({sql,args});return {
  first:async()=>({n:args.length}),
  run:async()=>({meta:{changes:1}})
 }}}}};
 const path='/api/affairs/advisor';
 const res=await studentAffairsRoutes(post(path,{classroom_id:7,teacher_user_id:4,
  teacher2_user_id:5}),{DB:db},{id:1,role:'staff'},path);
 assert.equal(res.status,200);
 assert.equal((await res.json()).ok,true);
 assert.ok(calls.some(x=>x.sql.includes('SET advisor_user_id=?,advisor2_user_id=?')&&
  JSON.stringify(x.args)===JSON.stringify([4,5,7])));
 const none=await studentAffairsRoutes(post(path,{classroom_id:7,teacher_user_id:4,
  teacher2_user_id:null}),{DB:db},{id:1,role:'staff'},path);
 assert.equal(none.status,200);
 assert.ok(calls.some(x=>x.sql.includes('SET advisor_user_id=?,advisor2_user_id=?')&&
  JSON.stringify(x.args)===JSON.stringify([4,null,7])));
});
test('same account cannot occupy both advisor slots',async()=>{
 let touched=false;
 const env={DB:{prepare(){touched=true;throw Error('should not access database')}}};
 const path='/api/affairs/advisor';
 await assert.rejects(studentAffairsRoutes(post(path,{classroom_id:7,teacher_user_id:4,
  teacher2_user_id:4}),env,{id:1,role:'staff'},path),{code:400});
 assert.equal(touched,false);
});
test('one existing advisor can gain a second without overwriting the first',()=>{
 const rooms=new Map([['ม.1/1',{id:7,label:'ม.1/1',
  advisor_user_id:4,advisor2_user_id:null}]]);
 const rows=[{classroom:'ม.1/1',full_name:'ครูสอง',username:'secondteacher',
  password:'',source_row:2}];
 const users=[{id:5,username:'secondteacher',display_name:'ครูสอง',role:'teacher',active:1}];
 const plan=planAdvisorImport(rows,rooms,users);
 assert.equal(plan.ready,true);
 assert.equal(plan.items[0].slot,2);
});
test('all advisor-scoped modules authorize both advisor slots and push both',()=>{
 const worker=read('worker/src/worker.js');
 const affairs=read('worker/src/student-affairs.js');
 const target=read('worker/src/push-target.js');
 const late=read('worker/src/late-qr-push.js');
 const truancy=read('worker/src/truancy-push.js');
 const push=read('worker/src/staff-push.js');
 const ui=read('web/student-affairs.js');
 assert.match(worker,/room\.advisor2_user_id===user\.id/);
 assert.match(worker,/advisor2_user_id=\?/);
 assert.match(worker,/teacher2_user_id/);
 assert.match(affairs,/u2\.display_name AS advisor2_name/);
 assert.match(affairs,/p\.user_id IN \(\?,\?\)/);
 assert.match(target,/c\.advisor2_user_id/);
 assert.match(late,/ps\.user_id IN \(c\.advisor_user_id,c\.advisor2_user_id\)/);
 assert.match(truancy,/s\.user_id IN \(c\.advisor_user_id,c\.advisor2_user_id\)/);
 assert.match(push,/p\.user_id IN \(\?,\?\)/);
 assert.match(ui,/teacher2_user_id/);
});
test('the D1 migration keeps original advisor and classroom records intact',()=>{
 const migration=read('worker/migrations/0035_second_homeroom_advisor.sql');
 assert.match(migration,/ALTER TABLE classrooms ADD COLUMN advisor2_user_id/);
 assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|UPDATE classrooms SET/);
});
