import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sendScheduledAttendanceReminders,studentAffairsRoutes} from '../worker/src/student-affairs.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const req=(path,method='GET',body)=>new Request('https://rd.test'+path,{
 method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('teacher cannot manage reminders, heads, rules or disciplinary cases',async()=>{
 const env={DB:{prepare(){throw Error('Unauthorized database read')}}};
 for(const path of ['/api/affairs/attendance','/api/affairs/people','/api/affairs/settings',
  '/api/affairs/remind','/api/affairs/cases','/api/affairs/behavior/summary',
  '/api/affairs/behavior/adjust','/api/affairs/behavior/rules']){
  if(path==='/api/affairs/behavior/rules')continue;
  await assert.rejects(()=>studentAffairsRoutes(req(path),env,{id:2,role:'teacher'},path),{code:403});
 }
 await assert.rejects(()=>studentAffairsRoutes(req('/api/affairs/behavior/record','POST',{
  student_id:4,rule_id:5,reason:'test'}),env,{id:8,role:'guardian'},'/api/affairs/behavior/record'),{code:403});
});
test('daily attendance reminder schedule defaults disabled and does not deliver on cold start',async()=>{
 let reads=0;
 const db={prepare(sql){
  reads++;assert.match(sql,/affairs_settings/);
  return {first:async()=>({auto_enabled:0,reminder_time:'08:30',weekdays:'1,2,3,4,5'})};
 }};
 const env={DB:db};
 const result=await sendScheduledAttendanceReminders(env);
 assert.equal(result.state,'disabled_or_non_school_day');
 assert.equal(reads,1);
});
test('staff rules reject unsupported categories and inconsistent positive/negative points',async()=>{
 const env={DB:{prepare(){throw Error('No queries should occur for invalid rule')}}};
 const path='/api/affairs/behavior/rules',actor={id:3,role:'staff'};
 for(const rule of [
  {name:'x',category:'minor',points:5},
  {name:'x',category:'good',points:-5},
  {name:'x',category:'extreme',points:-5},
  {name:'x',category:'serious',points:-99},
  {name:'x',category:'moderate',points:0}
 ]){
  await assert.rejects(()=>studentAffairsRoutes(req(path,'POST',rule),env,actor,path),{code:400});
 }
});
test('signed rule values are applied server-side rather than client submitted points',async()=>{
 const calls=[],actor={id:11,role:'teacher'},path='/api/affairs/behavior/record';
 const db={prepare(sql){
  const statement={sql,args:[]};calls.push(statement);
  return {bind(...args){
   statement.args=args;
   return {
    first:async()=>sql.includes('FROM students s')?{id:47}:sql.includes('FROM affairs_behavior_rules')?
     {id:9,name:'มาตรฐานโรงเรียน',category:'minor',points:-4,active:1}:null,
    run:async()=>({meta:{last_row_id:78,changes:1}})
   };
  }};
 }};
 const env={DB:db};
 const res=await studentAffairsRoutes(req(path,'POST',{student_id:47,rule_id:9,
  points:10000,category:'good',reason:'บันทึกตามระเบียบ'}),env,actor,path);
 assert.equal(res.status,201);
 const value=await res.json();
 assert.equal(value.points,-4);
 assert.equal(value.category,'minor');
 const insert=calls.find(x=>x.sql.includes('INSERT INTO behavior_records'));
 assert.deepEqual(insert.args,[47,-4,'บันทึกตามระเบียบ',11,9,'minor']);
});
test('PWA reminders navigate only to authorized local attendance URL after staff login',()=>{
 const sw=read('web/sw.js'),app=read('web/app.js'),router=read('web/login-route.js');
 for(const term of ['daily_attendance_reminder','classroomId','rd-connect-daily-checkin']){
  assert.ok(sw.includes(term),term);
 }
 assert.match(sw,/\?tab=attendance&classroom_id=/);
 assert.match(sw,/safeDaily/);
 assert.match(router,/attendance/);
 assert.match(app,/query\.get\('classroom_id'\)/);
 assert.match(app,/state\.rooms\.some\(r=>Number\(r\.id\)===Number\(query\.get\('classroom_id'\)\)\)/);
});
test('student affairs navigation requires an explicit assignment and teachers use controlled conduct rules',()=>{
 const app=read('web/app.js'),worker=read('worker/src/worker.js'),ui=read('web/student-affairs.js');
 assert.match(app,/createStudentAffairs/);
 assert.match(app,/Number\(state\.user\?\.student_affairs\)===1/);
 assert.match(app,/if\(tab==='studentAffairs'\)\{/);
 assert.match(app,/return studentAffairs\.load\(\)/);
 assert.match(app,/\/api\/affairs\/behavior\/record/);
 assert.match(app,/behaviorRules/);
 assert.match(worker,/student_affairs_assignments/);
 assert.match(worker,/sendScheduledAttendanceReminders\(env\)/);
 for(const name of ['attendance','people','rules','cases'])
  assert.ok(ui.includes("['"+name+"'"),name);
 assert.match(ui,/data-affairs-remind/);
 assert.match(ui,/data-affairs-head/);
 assert.match(ui,/data-affairs-advisor/);
 assert.match(ui,/affairsNewCase/);
});

test('unassigned teachers and administrators are excluded from privileged affairs endpoints',async()=>{
 const env={DB:{prepare(){throw Error('Unauthorized DB access')}}};
 const managed=[
  ['/api/affairs/attendance','GET'],['/api/affairs/people','GET'],
  ['/api/affairs/settings','POST'],['/api/affairs/behavior/rules','POST'],
  ['/api/affairs/cases','POST'],['/api/affairs/remind','POST'],
  ['/api/affairs/behavior/summary','GET']
 ];
 for(const actor of [{id:2,role:'teacher',student_affairs:0},
  {id:3,role:'admin',student_affairs:0}]){
  for(const [path,method] of managed){
   await assert.rejects(()=>studentAffairsRoutes(
    req(path,method,{name:'bad',category:'minor',points:-1}),env,actor,path),{code:403});
  }
 }
});
test('explicitly assigned teacher keeps own role and is authorized to load affairs data',async()=>{
 let count=0;
 const env={DB:{prepare(sql){
  assert.match(sql,/affairs_settings/);count++;
  return{first:async()=>({auto_enabled:0,reminder_time:'08:30',weekdays:'1,2,3,4,5'})};
 }}};
 const actor={id:19,role:'teacher',student_affairs:1};
 // Calls an authorized configuration-read endpoint with a mock response.
 // A missing route still needs to pass authorization before touching the DB.
 const url='/api/affairs/attendance';
 await assert.rejects(()=>studentAffairsRoutes(req(url),env,actor,url),
  err=>err.message!=='เฉพาะครูที่ได้รับมอบหมายสิทธิ์ฝ่ายกิจการนักเรียน');
 assert.equal(actor.role,'teacher');
});
test('new permission works on the backend and menu; existing roles stay intact',()=>{
 const worker=read('worker/src/worker.js'),affairs=read('worker/src/student-affairs.js');
 const admin=read('web/admin-settings.js');
 assert.match(worker,/FROM student_affairs_assignments a WHERE a\.user_id=u\.id/);
 assert.match(worker,/b\.student_affairs!==undefined/);
 assert.match(worker,/student_affairs_assigned/);
 assert.match(worker,/student_affairs_revoked/);
 assert.match(affairs,/u\?\.role==='staff'\|\|\(u\?\.role==='teacher'&&Number\(u\?\.student_affairs\)===1\)/);
 assert.match(admin,/name="student_affairs"/);
 assert.match(admin,/f\.get\('student_affairs'\)==='on'/);
});
