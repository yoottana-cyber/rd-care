import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {studentPushRoutes,studentPushTarget} from '../worker/src/student-push.js';
const url='https://rd.test';
const account={id:31,role:'student',student_id:77,active:1,must_change_password:0};
const keys={VAPID_PUBLIC_KEY:'mock',VAPID_PRIVATE_KEY:'mock',VAPID_SUBJECT:'mailto:admin@example.com'};
const endpoint='https://fcm.googleapis.com/fcm/send/testing-device';
const sub={endpoint,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
const body=(path,data)=>new Request(url+path,{method:'POST',body:JSON.stringify(data)});
function database({owner=null,staff=null,guardian=null,devices=0,targetStudent=77}={}){
 const queries=[];
 const db={queries,prepare(sql){
  const call={sql,args:[]};queries.push(call);
  return {bind(...args){call.args=args;return this},
   async first(){
    if(sql.includes('FROM staff_push_subscriptions WHERE endpoint='))return staff?{id:staff}:null;
    if(sql.includes('FROM guardian_push_subscriptions WHERE endpoint='))return guardian?{id:guardian}:null;
    if(sql.includes('SELECT student_account_id FROM student_push_subscriptions'))return owner?{student_account_id:owner}:null;
    if(sql.includes('COUNT(*) AS total FROM student_push_subscriptions'))return {total:devices};
    if(sql.includes('SELECT id FROM student_push_subscriptions WHERE endpoint='))return owner===call.args[1]?{id:9}:null;
    if(sql.includes('SELECT e.school_date,e.id FROM'))return call.args[1]===targetStudent?{id:5,school_date:'2026-10-29'}:null;
    return null;
   },
   async run(){return {meta:{changes:1}}},
   async all(){return {results:[]}}
  };
 }};
 return db;
}
test('only active student accounts may subscribe, not guardians or inactive students',async()=>{
 for(const user of [{...account,role:'guardian'}, {...account,active:0},{...account,student_id:null}]){
  const db=database();
  await assert.rejects(studentPushRoutes(body('/api/portal/student-push/subscribe',sub),{...keys,DB:db},
   user,'/api/portal/student-push/subscribe'),{code:403});
  assert.equal(db.queries.length,0);
 }
});
test('student may subscribe own device but not steal another student/guardian/staff endpoint',async()=>{
 for(const store of [database({owner:99}),database({guardian:5}),database({staff:8})])
  await assert.rejects(studentPushRoutes(body('/api/portal/student-push/subscribe',sub),{...keys,DB:store},
   account,'/api/portal/student-push/subscribe'),{code:409});
 const db=database();
 const result=await studentPushRoutes(body('/api/portal/student-push/subscribe',sub),{...keys,DB:db},
  account,'/api/portal/student-push/subscribe');
 assert.equal((await result.json()).subscribed,true);
 const insert=db.queries.find(q=>q.sql.includes('INSERT INTO student_push_subscriptions'));
 assert.deepEqual(insert.args,[account.id,endpoint,sub.keys.p256dh,sub.keys.auth]);
});
test('student device limit and subscribe errors preserve existing account privacy',async()=>{
 await assert.rejects(studentPushRoutes(body('/api/portal/student-push/subscribe',sub),{...keys,DB:database({devices:5})},
 account,'/api/portal/student-push/subscribe'),{code:429});
 const db=database({owner:account.id});
 const unsub=await studentPushRoutes(body('/api/portal/student-push/unsubscribe',{endpoint}),{DB:db},account,
  '/api/portal/student-push/unsubscribe');
 assert.equal((await unsub.json()).subscribed,false);
 assert.deepEqual(db.queries.at(-1).args,[endpoint,account.id]);
});
test('student push event deep link is limited to linked student and active incident',async()=>{
 const req=new Request(url+'/api/portal/student-push/target?kind=late&id=5');
 const result=await studentPushTarget(req,{DB:database()},account);
 const record=await result.json();
 assert.equal(record.student_id,77);
 assert.equal(record.school_date,'2026-10-29');
 await assert.rejects(studentPushTarget(req,{DB:database({targetStudent:55})},account),{code:404});
 await assert.rejects(studentPushTarget(new Request(url+'/api/portal/student-push/target?kind=late&id=5%20OR%201'),
  {DB:database()},account),{code:400});
});
test('student Push uses a separate opt-in subscription and delivery ledger',()=>{
 const migration=readFileSync(new URL('../worker/migrations/0036_student_web_push.sql',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../worker/src/student-push.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../worker/src/portal.js',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../web/sw.js',import.meta.url),'utf8');
 assert.match(migration,/CREATE TABLE IF NOT EXISTS student_push_subscriptions/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS student_push_deliveries/);
 assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM/);
 assert.match(dispatch,/student_push_deliveries/);
 assert.match(dispatch,/attempts<3/);
 assert.match(dispatch,/state='delivered'/);
 assert.match(dispatch,/student_id=\?/);
 assert.match(server,/deliverStudentPush\(env/);
 assert.match(portal,/studentPushRoutes\(req,env,a,path\)/);
 assert.match(sw,/studentNotice/);
 assert.match(sw,/มีข้อมูลการเข้าเรียนให้ตรวจสอบ/);
});
