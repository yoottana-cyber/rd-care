import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NOTIFICATION_CATEGORIES,notificationPolicyRoutes,notificationEnabled}
 from '../worker/src/notification-policy.js';
import {deliverScorePush} from '../worker/src/score-push.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const path='/api/admin/notification-preferences';
const request=(method,body)=>new Request('https://rd.test'+path,{
 method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
function db(initial={}){
 const prefs=new Map(Object.entries(initial)),calls=[];
 return {calls,prefs,prepare(sql){
  const query={sql,args:[]};calls.push(query);
  return {bind(...args){query.args=args;return this},
   async first(){if(sql.includes('SELECT enabled FROM notification_preferences'))
    return {enabled:prefs.has(query.args[0])?Number(prefs.get(query.args[0])):1};
    return null;},
   async all(){return {results:[...prefs].map(([event_key,enabled])=>({event_key,enabled:Number(enabled)}))}},
   async run(){return {meta:{changes:1}}}};
 },async batch(stmts){const q=calls.find(x=>x.sql.includes('INSERT INTO notification_preferences'));prefs.set(q.args[0],q.args[1]);return [{meta:{changes:1}},{meta:{changes:1}}]}}
}
test('admin sees all 13 event switches including student and guardian deduction notices',async()=>{
 const store=db({score_student:0});
 const response=await notificationPolicyRoutes(request('GET'),{DB:store},{role:'admin',id:1},path);
 assert.equal(response.status,200);
 const items=(await response.json()).items;
 assert.equal(items.length,13);
 assert.equal(items.find(x=>x.key==='score_student').enabled,false);
 assert.equal(items.find(x=>x.key==='score_guardian').enabled,true);
 assert.equal(new Set(items.map(x=>x.key)).size,items.length);
 assert.equal(NOTIFICATION_CATEGORIES.length,13);
});
test('notification choices are strict booleans and only admin may change schoolwide policy',async()=>{
 const store=db(),env={DB:store};
 await assert.rejects(notificationPolicyRoutes(request('GET'),env,{role:'teacher'},path),{code:403});
 await assert.rejects(notificationPolicyRoutes(request('POST',{key:'score_guardian',enabled:false}),
  env,{role:'staff',id:3},path),{code:403});
 for(const body of [{key:'bad',enabled:true},{key:'score_student',enabled:'false'},
  {key:'score_student',enabled:false,extra:1}]){
  await assert.rejects(notificationPolicyRoutes(request('POST',body),env,{role:'admin',id:1},path),{code:400});
 }
 assert.equal(store.calls.length,0);
 const saved=await notificationPolicyRoutes(request('POST',{key:'score_student',enabled:false}),
  env,{role:'admin',id:1},path);
 assert.equal(saved.status,200);
 assert.equal(store.prefs.get('score_student'),0);
 assert.equal(await notificationEnabled(env,'score_student'),false);
 assert.ok(store.calls.some(x=>x.sql.includes('INSERT INTO audit_logs')));
});
test('score push skips when both recipient categories disabled, and never sends for warnings',async()=>{
 const env={DB:db({score_student:0,score_guardian:0,warning_student:0,warning_guardian:0}),
  VAPID_PUBLIC_KEY:'x',VAPID_PRIVATE_KEY:'x',VAPID_SUBJECT:'mailto:example@test.org'};
 const res=await deliverScorePush(env);
 assert.deepEqual(res,{enabled:false,processed:0,delivered:0});
 assert.equal(env.DB.calls.some(x=>x.sql.includes('behavior_score_push_events')),false);
 const dispatch=read('worker/src/score-push.js');
 assert.match(dispatch,/i\.points_applied<0/);
 assert.match(dispatch,/b\.deleted_at IS NULL/);
 assert.match(dispatch,/a\.active=1/);
 assert.match(dispatch,/guardian_student_links/);
 assert.match(dispatch,/behavior_score_push_deliveries/);
 assert.match(dispatch,/e\.created_at>=p\.updated_at/);
});
test('all existing event senders consult admin preference at delivery',()=>{
 for(const [name,flag] of [
  ['worker/src/student-push.js',"type+'_student'"],
  ['worker/src/truancy-push.js',"'truancy_guardian'"],
  ['worker/src/late-qr-push.js',"'late_advisor'"],
  ['worker/src/staff-push.js',"'review_advisor'"],
  ['worker/src/student-affairs.js',"'daily_reminder_advisor'"],
  ['worker/src/student-direct-messages.js',"'student_message'"]])
  assert.ok(read(name).includes(flag),name);
 const worker=read('worker/src/worker.js');
 assert.match(worker,/notificationPolicyRoutes\(req,env,user,path\)/);
 assert.match(worker,/deliverScorePush\(env\)/);
 assert.match(read('web/admin-settings.js'),/ตั้งค่าการแจ้งเตือน/);
 assert.match(read('web/sw.js'),/score_change/);
 assert.match(read('web/sw.js'),/score_notice=1/);
});
