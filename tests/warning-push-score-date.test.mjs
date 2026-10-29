import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectedScoreDate,incidentInsert,commitBehaviorIncidents} from '../worker/src/conduct-policy.js';
import {NOTIFICATION_CATEGORIES} from '../worker/src/notification-policy.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('school score date validates real calendar days and never permits future dates',()=>{
 assert.equal(selectedScoreDate('2026-10-15'),'2026-10-15');
 assert.equal(selectedScoreDate(undefined),null);
 for(const value of ['2026-02-30','2026-13-01','2026-00-01','2999-01-01','15/10/2026',12,'1999-12-31'])
  assert.throws(()=>selectedScoreDate(value),{code:400});
});
test('teacher page sends chosen date in merit and misconduct submissions and retry fingerprint',()=>{
 const ui=read('web/score-recording.js');
 assert.match(ui,/id="scoreSchoolDate"/);
 assert.match(ui,/name="school_date"/);
 assert.match(ui,/school_date:u.schoolDate/);
 assert.match(ui,/u\.reason,u\.schoolDate/);
 assert.match(ui,/bangkokScoreToday/);
});
test('manual incident insert includes date for ledger and trigger to preserve score history',()=>{
 const calls=[];
 const db={prepare(sql){const rec={sql,args:[]};calls.push(rec);return {bind(...args){rec.args=args;return rec}}}};
 const req='8c0b3388-2cc5-4ff8-9e0e-a432a08dc88c';
 incidentInsert(db,17,{id:8},'บันทึกย้อนหลัง',3,req,'2026-10-15');
 const entry=calls[0];
 assert.match(entry.sql,/recorded_school_date,created_at/);
 assert.match(entry.sql,/WHEN \?=date\('now','\+7 hours'\)/);
 assert.deepEqual(entry.args,[17,'บันทึกย้อนหลัง',3,req,
  '2026-10-15','2026-10-15','2026-10-15','2026-10-15',17,8,8]);
 const migration=read('worker/migrations/0046_warning_push_selected_score_date.sql');
 assert.match(migration,/NEW\.created_at/);
 assert.match(migration,/ALTER TABLE behavior_incidents ADD COLUMN recorded_school_date/);
});
test('request retry date mismatch is rejected even with same UUID and student',async()=>{
 let result=[];
 const req='8c0b3388-2cc5-4ff8-9e0e-a432a08dc88c',reason='บันทึก';
 const db={prepare(sql){return {bind(){return this}}},async batch(){
  return [{meta:{changes:0}},{results:result}]}};
 result=[{id:11,student_id:17,affairs_rule_id:8,reason,
  recorded_school_date:'2026-10-15',points_applied:0,warning_no:1}];
 await assert.rejects(
  commitBehaviorIncidents(db,[17],{id:8},reason,3,req,'2026-10-16'),{code:409});
 const okay=await commitBehaviorIncidents(db,[17],{id:8},reason,3,req,'2026-10-15');
 assert.equal(okay[0].id,11);
});
test('authorized student and guardian history includes warning records with selected school date',()=>{
 const backend=read('worker/src/portal.js');
 const ui=read('web/portal-ui.js');
 assert.match(backend,/FROM behavior_incidents i/);
 assert.match(backend,/i\.points_applied=0/);
 assert.match(backend,/i\.warning_no>0/);
 assert.match(backend,/\.bind\(id,from,to,id,from,to\)/);
 assert.match(ui,/ตักเตือนครั้งที่/);
 assert.match(ui,/scoreNoticeIntent/);
 assert.match(ui,/\['home','attendance','behaviorHistory','late'/);
 assert.match(ui,/data-portal-panel="behaviorHistory"/);
});
test('admin can separately enable student and guardian warnings, without changing score switches',()=>{
 const catalog=NOTIFICATION_CATEGORIES.map(x=>x.key);
 assert.equal(catalog.length,13);
 for(const key of ['score_student','score_guardian','warning_student','warning_guardian'])
  assert.ok(catalog.includes(key));
 const dispatch=read('worker/src/score-push.js');
 assert.match(dispatch,/warning_student/);
 assert.match(dispatch,/warning_guardian/);
 assert.match(dispatch,/i\.warning_no>0/);
 assert.match(dispatch,/sendScoreChangePush\(device,env,audience,\{warning\}\)/);
 assert.match(read('web/sw.js'),/conduct_warning/);
});
