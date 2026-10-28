import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schoolScoreMonitorSummary,schoolScoreMonitorHistory,allowSchoolScoreMonitor} from '../worker/src/teacher-score-monitor.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
import {createTeacherScoreMonitor} from '../web/teacher-score-monitor.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const request=path=>new Request('https://rd.test'+path);
const teacher={id:12,role:'teacher',student_affairs:0};
const staff={id:23,role:'staff'};
function fakeDb(){
 const statements=[];
 const DB={
  prepare(sql){
   const entry={sql,args:[]};statements.push(entry);
   const respond={
    first:async()=>sql.includes('FROM students WHERE id=')?{id:56}:
     {good_total:15,behavior_deducted:8,behavior_adjusted:3},
    all:async()=>({results:sql.includes('ORDER BY c.grade')?
     [{grade:2,student_id:56,student_no:'0015',full_name:'นักเรียนตัวอย่าง',
      classroom_label:'ม.2/1',good_total:15,behavior_deducted:8,behavior_adjusted:3,events:4}]:
     [{id:3,reason:'ตามเกณฑ์',points:-5,teacher_name:'ครู ก',score_type:'behavior'}]})
   };
   return {bind(...args){entry.args=args;return respond},...respond};
  }
 };
 return {DB,statements};
}
test('every authenticated teacher including non-affairs may view schoolwide summary, but guardians cannot',async()=>{
 assert.equal(allowSchoolScoreMonitor(teacher),true);
 assert.equal(allowSchoolScoreMonitor(staff),true);
 assert.equal(allowSchoolScoreMonitor({role:'admin'}),true);
 for(const role of ['guardian','student',null,'unknown'])
  assert.equal(allowSchoolScoreMonitor({role}),false);
 const env=fakeDb();
 const path='/api/affairs/behavior/monitor/summary';
 const response=await studentAffairsRoutes(request(path),{DB:env.DB},teacher,path);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.read_only,true);
 assert.equal(body.items[0].student_id,56);
 assert.equal(body.items[0].behavior_remaining,5);
 assert.equal(body.items[0].good_total,15);
 assert.equal(body.items[0].behavior_adjusted,3);
 const query=env.statements.find(x=>x.sql.includes('ORDER BY c.grade'));
 assert.match(query.sql,/s\.active=1/);
 assert.match(query.sql,/b\.deleted_at IS NULL/);
 assert.doesNotMatch(query.sql,/advisor_user_id=\?|teacher_user_id=\?/);
 assert.equal(query.args.length,1);
 await assert.rejects(()=>studentAffairsRoutes(request(path),{DB:env.DB},
  {id:9,role:'guardian'},path),{code:403});
});
test('all-teacher history works for another classroom, but explicitly prevents editing or delete permissions',async()=>{
 const env=fakeDb(),path='/api/affairs/behavior/monitor/history';
 const response=await studentAffairsRoutes(request(path+'?student_id=56&limit=10'),
  {DB:env.DB},teacher,path);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.read_only,true);
 assert.equal(body.items[0].can_delete,0);
 assert.equal(body.items[0].teacher_name,'ครู ก');
 assert.equal(body.behavior_remaining,5);
 const detail=env.statements.find(x=>x.sql.includes('LEFT JOIN affairs_adjustment_rules'));
 assert.match(detail.sql,/b\.deleted_at IS NULL/);
 assert.match(detail.sql,/ORDER BY b\.id DESC LIMIT \? OFFSET \?/);
 assert.doesNotMatch(detail.sql,/AS can_delete/);
 assert.deepEqual(detail.args,[56,11,0]);
 assert.equal(env.statements.some(x=>/INSERT|UPDATE|DELETE/.test(x.sql)),false);
});
test('guardians and student users cannot read score-monitor history',async()=>{
 const env=fakeDb(),path='/api/affairs/behavior/monitor/history';
 for(const role of ['guardian','student']){
  await assert.rejects(()=>studentAffairsRoutes(request(path+'?student_id=56'),
   {DB:env.DB},{id:7,role},path),{code:403});
 }
 assert.equal(env.statements.length,0);
});
test('invalid history queries are rejected before database access',async()=>{
 const env=fakeDb();
 for(const query of ['student_id=0','student_id=bad','student_id=56&limit=201',
  'student_id=56&offset=-1','student_id=56&limit=1.4']){
  await assert.rejects(()=>schoolScoreMonitorHistory(request('/api/affairs/behavior/monitor/history?'+query),
   {DB:env.DB},teacher),{code:400});
 }
 assert.equal(env.statements.length,0);
});
test('server-only read-only guard returns no result for blocked users',async()=>{
 const env=fakeDb();
 await assert.rejects(()=>schoolScoreMonitorSummary({DB:env.DB},{role:'student'}),{code:403});
 await assert.rejects(()=>schoolScoreMonitorHistory(request('/api/affairs/behavior/monitor/history?student_id=56'),
  {DB:env.DB},{role:'guardian'}),{code:403});
 assert.equal(env.statements.length,0);
});
test('teacher score monitor is a standalone navigation page and popup is read-only regardless of response flags',()=>{
 const app=source('web/app.js'),nav=source('web/navigation-ui.js');
 const page=source('web/teacher-score-monitor.js'),popup=source('web/score-history-popup.js');
 for(const term of ['createTeacherScoreMonitor','teacherScoreMonitor.load()',
  "['scoreMonitor','ติดตามคะแนนพฤติกรรม','📊']", "['scoreMonitor','📊','ติดตามคะแนนพฤติกรรม'"])
  assert.ok(app.includes(term),term);
 assert.match(nav,/scoreMonitor:'ติดตามคะแนนความดี/);
 for(const term of ['scoreMonitorGrade','scoreMonitorQuery','scoreMonitorLimit','scoreMonitorRecordFilter',
  'scoreMonitorRows','scoreMonitorFound','scorePopup.open','readOnly:true',
  'monitor/summary','ตรวจสอบ','ดูประวัติ'])assert.ok(page.includes(term),term);
 assert.match(popup,/readOnly\?\(data\.items\|\|\[\]\)\.map\(row=>\(\{\.\.\.row,can_delete:0\}\)\)/);
 assert.match(popup,/monitor\/history/);
 assert.doesNotMatch(page,/data-score-delete|behavior\/adjust\/bulk|record\/bulk/);
});
test('score monitor can initialize without any write calls',()=>{
 const screen=createTeacherScoreMonitor({api:()=>{throw Error('API must not load during constructor')},
  mount:()=>{},safeRun:x=>x(),toast:()=>{},scorePopup:{open:()=>{}},
  getTab:()=> 'scoreMonitor',escapeHtml:value=>String(value)});
 assert.equal(typeof screen.load,'function');
});
