import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pushTarget} from '../worker/src/push-target.js';
import {safePushEventInfo} from '../worker/src/staff-push.js';

const request=(kind,id)=>new Request('https://rd.test/api/push/target?kind='+kind+'&id='+id);
const mockDb=(row)=>{const calls=[];return {calls,prepare(sql){
 return {bind(...args){calls.push({sql,args});return {first:async()=>row}}};
}};};
test('push payload whitelists event date, course, period or arrival time only',()=>{
 const meta={eventId:45,date:'2026-10-27',period:4,subject:'วิทยาศาสตร์',arrival:'08:32',
  student_no:'12345',full_name:'SECRET',reason:'SECRET',student_id:9};
 assert.deepEqual(safePushEventInfo(meta,'truancy'),{eventId:45,date:'2026-10-27',period:4,subject:'วิทยาศาสตร์'});
 assert.deepEqual(safePushEventInfo(meta,'late'),{eventId:45,date:'2026-10-27',arrival:'08:32'});
 assert.deepEqual(safePushEventInfo({eventId:0},'late'),{});
});
test('push target access is limited by guardian relation and teacher advisory room',async()=>{
 const db=mockDb({id:8,student_id:12,school_date:'2026-10-27',full_name:'Tester'});
 const guardian={id:5,role:'guardian',active:1,must_change_password:0};
 const result=await pushTarget(request('truancy',8),{DB:db},guardian,'guardian');
 assert.equal((await result.json()).id,8);
 assert.match(db.calls[0].sql,/guardian_student_links/);
 assert.deepEqual(db.calls[0].args,[8,5]);
 await pushTarget(request('late',9),{DB:db},{role:'teacher',id:7},'advisor');
 assert.match(db.calls[1].sql,/c\.advisor_user_id/);
 assert.match(db.calls[1].sql,/e\.active=1/);
 assert.deepEqual(db.calls[1].args,[9,'teacher',7,7]);
});
test('revoked, missing or unauthorized event never returns detail',async()=>{
 const db=mockDb(null);
 await assert.rejects(()=>pushTarget(request('late',9),{DB:db},{id:2,role:'guardian',active:1},'guardian'),{code:404});
 await assert.rejects(()=>pushTarget(request('truancy',8),{DB:db},{id:4,role:'student',active:1},'guardian'),{code:403});
 await assert.rejects(()=>pushTarget(request('late','1 OR 1'),{DB:db},{id:1,role:'admin'},'advisor'),{code:400});
});
function sw(){
 const events={},notifications=[],opened=[];
 const self={location:{origin:'https://rd-care.pages.dev'},
  registration:{scope:'https://rd-care.pages.dev/',showNotification:async(title,options)=>notifications.push({title,options})},
  clients:{matchAll:async()=>[],openWindow:async(url)=>opened.push(url)},
  addEventListener:(kind,fn)=>events[kind]=fn,skipWaiting:async()=>{},clientsClaim:async()=>{}};
 runInNewContext(readFileSync(new URL('../web/sw.js',import.meta.url),'utf8'),{self,URL});
 return {events,notifications,opened};
}
async function send(s,metadata){
 let promise;
 s.events.push({data:{json:()=>metadata},waitUntil:p=>promise=p});
 await promise;
 return s.notifications.at(-1);
}
async function click(s,url){
 let promise;
 s.events.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>promise=p});
 await promise;
 return s.opened.at(-1);
}
test('advisor push shows topic and jumps directly to its own truancy case',async()=>{
 const s=sw();
 const n=await send(s,{kind:'urgent_review',audience:'advisor',eventId:71,
  date:'2026-10-27',period:3,subject:'คณิตศาสตร์',full_name:'SECRET'});
 assert.match(n.title,/หนีเรียน/);
 assert.match(n.options.body,/คาบ 3/);
 assert.match(n.options.body,/คณิตศาสตร์/);
 assert.doesNotMatch(n.options.body,/SECRET/);
 assert.match(n.options.data.url,/tab=advisorCenter&notice_kind=truancy&notice_id=71/);
 assert.match(await click(s,n.options.data.url),/notice_id=71/);
});
test('guardian QR push contains event time and routes into authenticated portal',async()=>{
 const s=sw();
 const a=await send(s,{kind:'late_arrival',audience:'guardian',eventId:82,
  date:'2026-10-27',arrival:'09:50'});
 const b=await send(s,{kind:'late_arrival',audience:'guardian',eventId:83,
  date:'2026-10-27',arrival:'09:51'});
 assert.match(a.options.body,/09:50/);
 assert.match(a.options.data.url,/portal_notice=late&notice_id=82/);
 assert.notEqual(a.options.tag,b.options.tag);
 assert.match(await click(s,a.options.data.url),/portal_notice=late&notice_id=82/);
});
test('period attendance review opens its own pending advisor task',async()=>{
 const s=sw();
 const n=await send(s,{kind:'attendance_review',audience:'advisor',
  eventId:93,date:'2026-10-27',period:5,subject:'ภาษาไทย'});
 assert.match(n.title,/ขาดรายคาบ/);
 assert.match(n.options.body,/คาบ 5/);
 assert.match(n.options.data.url,/notice_kind=attendance_review&notice_id=93/);
 assert.match(await click(s,n.options.data.url),/notice_id=93/);
});
test('push testing never falsely labels an actual student incident',async()=>{
 const s=sw();
 const n=await send(s,{kind:'push_test',audience:'guardian'});
 assert.match(n.title,/ทดสอบ/);
 assert.doesNotMatch(n.title+n.options.body,/หนีเรียน|มาสาย/);
});
test('guardian cannot request private staff-only attendance review event',async()=>{
 const db=mockDb({id:93,student_id:9});
 await assert.rejects(()=>pushTarget(request('attendance_review',93),{DB:db},
  {id:5,role:'guardian',active:1,must_change_password:0},'guardian'),{code:403});
 assert.equal(db.calls.length,0);
});
test('forged external redirect is not followed from notification clicks',async()=>{
 const s=sw();
 assert.equal(await click(s,'https://not-school.example/phish'),'https://rd-care.pages.dev/');
});
