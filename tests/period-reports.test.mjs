import test from 'node:test';
import assert from 'node:assert/strict';
import {periodWeekStatus,periodCourseReport,verifyWeekStart} from '../worker/src/period-reports.js';

function request(path){return new Request('https://local.test'+path)}
function database(){
 const calls=[];
 return {calls,prepare(sql){
  const entry={sql,values:[]};
  calls.push(entry);
  return {bind(...values){entry.values=values;return {
   all:async()=>({results:[{timetable_id:5,school_date:'2026-10-26',recorded:24,absent:2}]}),
   first:async()=>null
  }}};
 }};
}
test('weekly status never leaks another role attendance rows',async()=>{
 const db=database();
 await assert.rejects(()=>periodWeekStatus(request('/api/my-timetable/week-status?start=2026-10-26'),{DB:db},{id:7,role:'staff'}),{code:403});
 assert.equal(db.calls.length,0);
});
test('week start must be a valid Monday; reporting dates are bounded',async()=>{
 assert.equal(verifyWeekStart('2026-10-26'),'2026-10-26');
 assert.throws(()=>verifyWeekStart('2026-10-28'),{code:400});
 const db=database();
 await assert.rejects(()=>periodWeekStatus(request('/api/my-timetable/week-status?start=2026-10-28'),{DB:db},{id:7,role:'teacher'}),{code:400});
 await assert.rejects(()=>periodCourseReport(request('/api/my-timetable/report?from=2026-01-01&to=2026-10-01'),{DB:db},{id:7,role:'teacher'}),{code:400});
 assert.equal(db.calls.length,0);
});
test('teacher weekly status joins own timetable and returns saved counts',async()=>{
 const db=database();
 const res=await periodWeekStatus(request('/api/my-timetable/week-status?start=2026-10-26'),{DB:db},{id:7,role:'teacher'});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.items[0].recorded,24);
 assert.deepEqual(db.calls[0].values,[7,'2026-10-26','2026-11-01']);
 assert.match(db.calls[0].sql,/t\.teacher_user_id=\?/);
});
test('teacher cannot access another teacher subject details',async()=>{
 const db=database();
 await assert.rejects(()=>periodCourseReport(request('/api/my-timetable/report?from=2026-10-01&to=2026-10-26&timetable_id=9'),{DB:db},{id:7,role:'teacher'}),{code:404});
 assert.equal(db.calls.length,1);
 assert.deepEqual(db.calls[0].values,[9,7]);
});
test('course report is scoped to owner and returns aggregate rows',async()=>{
 const db=database();
 const res=await periodCourseReport(request('/api/my-timetable/report?from=2026-10-01&to=2026-10-26'),{DB:db},{id:7,role:'teacher'});
 assert.equal(res.status,200);
 assert.deepEqual(db.calls[0].values,['2026-10-01','2026-10-26',7]);
 assert.match(db.calls[0].sql,/t\.teacher_user_id=\?/);
});
