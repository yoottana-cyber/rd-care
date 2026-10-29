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
  {name:'x',category:'serious',points:-99.5},
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
    run:async()=>({meta:{last_row_id:78,changes:1}}),
    all:async()=>({results:[{id:78,student_id:47,affairs_rule_id:9,
     affairs_category:'minor',points_applied:0,warning_no:1,behavior_record_id:null}]})
   };
  }};
 }};
 db.batch=async arr=>arr.map((x,i)=>i===arr.length-1?{success:true,results:[
  {id:78,student_id:47,affairs_rule_id:9,reason:'บันทึกตามระเบียบ',affairs_category:'minor',
   points_applied:0,warning_no:1,behavior_record_id:null}
 ]}:{success:true,meta:{changes:4,last_row_id:900}});
 const env={DB:db};
 const res=await studentAffairsRoutes(req(path,'POST',{student_id:47,rule_id:9,
  points:10000,category:'good',reason:'บันทึกตามระเบียบ'}),env,actor,path);
 assert.equal(res.status,201);
 const value=await res.json();
 assert.equal(value.points,0);
 assert.equal(value.warning_no,1);
 assert.equal(value.category,'minor');
 const insert=calls.find(x=>x.sql.includes('INSERT OR IGNORE INTO behavior_incidents'));
 assert.deepEqual([insert.args[0],insert.args[1],insert.args[2],...insert.args.slice(4)],
  [47,'บันทึกตามระเบียบ',11,null,null,null,null,47,9,9]);
 assert.match(insert.args[3],/^[0-9a-f-]{36}$/);
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
 const app=read('web/app.js'),worker=read('worker/src/worker.js'),ui=read('web/student-affairs.js'),scoring=read('web/score-recording.js');
 assert.match(app,/createStudentAffairs/);
 assert.match(app,/state\.user\?\.role==='admin'\|\|Number\(state\.user\?\.student_affairs\)===1/);
 assert.match(app,/if\(tab==='studentAffairs'\)\{/);
 assert.match(app,/return studentAffairs\.load\(\)/);
 assert.match(scoring,/\/api\/affairs\/behavior\/record\/bulk/);
 assert.match(scoring,/\/api\/affairs\/behavior\/rules/);
 assert.match(worker,/student_affairs_assignments/);
 assert.match(worker,/sendScheduledAttendanceReminders\(env\)/);
 for(const name of ['attendance','people','rules','cases'])
  assert.ok(ui.includes("['"+name+"'"),name);
 assert.match(ui,/data-affairs-remind/);
 assert.match(ui,/data-affairs-head/);
 assert.match(ui,/data-affairs-advisor/);
 assert.match(ui,/affairsNewCase/);
});

test('unassigned teachers are excluded from privileged affairs endpoints',async()=>{
 const env={DB:{prepare(){throw Error('Unauthorized DB access')}}};
 const managed=[
  ['/api/affairs/attendance','GET'],['/api/affairs/people','GET'],
  ['/api/affairs/settings','POST'],['/api/affairs/behavior/rules','POST'],
  ['/api/affairs/cases','POST'],['/api/affairs/remind','POST'],
  ['/api/affairs/behavior/summary','GET']
 ];
 for(const actor of [{id:2,role:'teacher',student_affairs:0}]){
  for(const [path,method] of managed){
   await assert.rejects(()=>studentAffairsRoutes(
    req(path,method,method==='POST'?{name:'bad',category:'minor',points:-1}:undefined),env,actor,path),{code:403});
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
 assert.match(affairs,/\['admin','staff'\]\.includes\(u\?\.role\)\|\|\(u\?\.role==='teacher'&&Number\(u\?\.student_affairs\)===1\)/);
 assert.match(admin,/name="student_affairs"/);
 assert.match(admin,/f\.get\('student_affairs'\)==='on'/);
});

test('administrators may open all student affairs views and read inactive scoring rules',async()=>{
 const statements=[];
 const fakeDb={
  prepare(sql){
   statements.push(sql);
   return {
    all:async()=>({results:sql.includes('FROM affairs_behavior_rules')?
     [{id:41,name:'ระเบียบที่ปิดใช้งาน',category:'minor',points:-2,active:0}]:[]}),
    bind(){return {all:async()=>({results:[]})}}
   };
  }
 };
 const admin={id:99,role:'admin',student_affairs:0},env={DB:fakeDb};
 const people=await studentAffairsRoutes(req('/api/affairs/people'),env,admin,'/api/affairs/people');
 assert.equal(people.status,200);
 assert.deepEqual(await people.json(),{teachers:[],rooms:[],heads:[]});
 const rules=await studentAffairsRoutes(req('/api/affairs/behavior/rules'),env,admin,
  '/api/affairs/behavior/rules');
 assert.equal(rules.status,200);
 const body=await rules.json();
 assert.equal(body.items[0].active,0);
 assert.ok(statements.some(sql=>sql.includes('FROM affairs_behavior_rules')&&!sql.includes('WHERE active=1')));
});
test('admins can maintain policy, ordinary teachers still need an explicit grant',async()=>{
 const actor={id:99,role:'admin',student_affairs:0};
 const path='/api/affairs/behavior/rules';
 const p={name:'ช่วยเหลือกิจกรรมส่วนรวม',category:'good',points:4,active:true};
 const calls=[],db={prepare(sql){
  const call={sql,args:[]};calls.push(call);
  return {bind(...args){call.args=args;return {run:async()=>({meta:{last_row_id:84,changes:1}})};}};
 }};
 const response=await studentAffairsRoutes(req(path,'POST',p),{DB:db},actor,path);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,id:84});
 assert.ok(calls.some(x=>x.sql.includes('INSERT INTO affairs_behavior_rules')));
 assert.ok(calls.some(x=>x.sql.includes('INSERT INTO audit_logs')));
 const teacher={id:11,role:'teacher',student_affairs:0};
 await assert.rejects(()=>studentAffairsRoutes(req(path,'POST',p),{DB:db},teacher,path),{code:403});
});
test('admin session and roster explicitly advertise Student Affairs access',()=>{
 const worker=read('worker/src/worker.js');
 const matches=worker.match(/CASE WHEN u\.role IN \('admin','staff'\)/g)||[];
 assert.equal(matches.length,2);
 assert.match(worker,/student_affairs_assignments/);
});
