import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {studentMessagePanel} from '../web/student-message-ui.js';
import {affairsMessageRoutes,portalStudentMessages} from '../worker/src/student-direct-messages.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('private inbox escapes sender-generated text and displays receipt controls',()=>{
 const html=studentMessagePanel({items:[{
  id:13,subject:'<script>alert(1)</script>',body:'กรุณามาพบฝ่ายกิจการนักเรียน',
  sender_name:'ครูฝ่ายกิจการ',created_at:'2026-10-29',read_at:null
 }],unread:1,focusId:13});
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/data-student-message-read="13"/);
 assert.match(html,/id="studentMessageFocus"/);
 assert.match(html,/1 ยังไม่อ่าน/);
});

test('only Student Affairs personnel may send messages',async()=>{
 await assert.rejects(
  affairsMessageRoutes({method:'POST'}, {},{role:'teacher',id:4},'/api/affairs/messages/send'),
  {code:403}
 );
 await assert.rejects(
  affairsMessageRoutes({method:'POST'}, {},{role:'student',id:6},'/api/affairs/messages/send'),
  {code:403}
 );
});

test('student and guardian inbox identities are isolated',async()=>{
 await assert.rejects(
  portalStudentMessages({method:'GET'}, {},{role:'guardian',student_id:7,active:1},'/api/portal/messages'),
  {code:403}
 );
 const binds=[];
 const DB={prepare(sql){return {
  bind(...args){binds.push({sql,args});return {
   all:async()=>({results:[{id:1,subject:'School note'}]}),
   first:async()=>({total:1}),
   run:async()=>({meta:{changes:0}})
  }}
 }}};
 const student={id:101,role:'student',student_id:19,active:1,must_change_password:0};
 const response=await portalStudentMessages({method:'GET'},{DB},student,'/api/portal/messages');
 assert.equal(response.status,200);
 assert.equal((await response.json()).unread,1);
 assert.deepEqual(binds.map(x=>x.args),[[19],[19]]);
 await assert.rejects(
  portalStudentMessages({method:'POST'},{DB},student,'/api/portal/messages/999/read'),
  {code:404}
 );
 assert.deepEqual(binds.at(-1).args,[999,19]);
});

test('sent message API validates student account and tracks messages independently of guardian',()=>{
 const module=read('worker/src/student-direct-messages.js');
 const portal=read('worker/src/portal.js'),worker=read('worker/src/worker.js');
 const affairs=read('web/student-affairs.js'),ui=read('web/portal-ui.js');
 const sw=read('web/sw.js'),push=read('worker/src/staff-push.js');
 const sql=read('worker/migrations/0037_student_direct_messages.sql');
 assert.match(module,/role==='teacher'&&Number\(u\?\.student_affairs\)===1/);
 assert.match(module,/WHERE id=\? AND student_id=\?/);
 assert.match(module,/JOIN portal_accounts a ON a.id=p.student_account_id/);
 assert.match(module,/push_devices/);
 assert.match(portal,/portalStudentMessages/);
 assert.match(worker,/affairsMessageRoutes/);
 assert.match(worker,/deliverStudentMessages/);
 assert.match(affairs,/id="affairsMessageCompose"/);
 assert.match(ui,/studentMessagePanel/);
 assert.match(ui,/\/api\/portal\/messages/);
 assert.match(sw,/student_message/);
 assert.match(sw,/safeStudentMessage/);
 assert.match(push,/kind:'student_message',audience:'student',messageId/);
 assert.doesNotMatch(push,/kind:'student_message'.*subject/);
 assert.match(sql,/REFERENCES students\(id\)/);
 assert.match(sql,/REFERENCES student_push_subscriptions\(id\)/);
 assert.match(read('web/sw.js'),/student-message-ui\.js/);
});
