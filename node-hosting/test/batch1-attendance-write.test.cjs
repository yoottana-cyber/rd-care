'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 weekday,bangkokToday,requireWriteDate,allowedDaily,allowedPeriod,
 validateRoster,planAttendance
}=require('../src/attendance-write-contract.cjs');
const teacher={kind:'staff',id:10,role:'teacher'};
const affairs={kind:'staff',id:20,role:'staff'};
const admin={kind:'staff',id:99,role:'admin'};
const room={id:31,advisor_user_id:10,advisor2_user_id:20};
const date='2026-10-30';
const slot={id:44,active:1,classroom_id:31,teacher_user_id:20,day_of_week:5};
const enrolled=[101,102];
const entries=[{student_id:101,status:'present'},{student_id:102,status:'absent'}];
const input={kind:'daily',classroom_id:31,date,entries};
function expectedError(fn,status,code){
 assert.throws(fn,e=>e?.status===status&&e?.message===code);
}
test('Thailand timezone and school-day weekdays handle UTC boundary',()=>{
 assert.equal(weekday('2026-10-30'),5);
 assert.equal(bangkokToday(new Date('2026-10-29T18:30:00Z')),'2026-10-30');
 assert.equal(requireWriteDate('2026-10-16',date),'2026-10-16');
 expectedError(()=>requireWriteDate('2026-10-15',date),400,'date_outside_write_window');
 expectedError(()=>requireWriteDate('2026-10-31',date),400,'date_outside_write_window');
 expectedError(()=>requireWriteDate('2026-02-29',date),400,'invalid_date');
});
test('primary AND secondary advisors are permitted daily, staff with no assignment denied',()=>{
 assert.equal(allowedDaily(teacher,room),true);
 assert.equal(allowedDaily(affairs,room),true);
 assert.equal(allowedDaily(admin,room),true);
 expectedError(()=>allowedDaily({...teacher,id:55},room),403,'forbidden');
 expectedError(()=>allowedDaily({...affairs,id:55},room),403,'forbidden');
 expectedError(()=>allowedDaily({kind:'portal',role:'guardian',id:10},room),403,'forbidden');
});
test('subject teacher/affairs may only submit their active own period',()=>{
 assert.equal(allowedPeriod(affairs,room,slot,date),true);
 assert.equal(allowedPeriod(admin,room,slot,date),true);
 expectedError(()=>allowedPeriod(teacher,room,slot,date),403,'forbidden');
 expectedError(()=>allowedPeriod(affairs,room,{...slot,active:0},date),400,'invalid_timetable');
 expectedError(()=>allowedPeriod(affairs,room,{...slot,day_of_week:1},date),400,'invalid_timetable');
 expectedError(()=>allowedPeriod(affairs,room,{...slot,classroom_id:7},date),400,'invalid_timetable');
});
test('complete exact roster, 100 max, no duplicates, daily no truancy',()=>{
 assert.deepEqual(validateRoster(entries,enrolled,'daily'),entries);
 assert.deepEqual(validateRoster([{student_id:101,status:'truancy'},entries[1]],enrolled,'period'),
  [{student_id:101,status:'truancy'},entries[1]]);
 for(const bad of [
  [entries[0]], [entries[0],entries[0]],
  [{student_id:103,status:'present'},entries[1]],
  [{student_id:101,status:'truancy'},entries[1]],
  [{student_id:101,status:'fake'},entries[1]]
 ]){
  expectedError(()=>validateRoster(bad,enrolled,'daily'),400,
   bad.length!==enrolled.length?'incomplete_roster':'invalid_entries');
 }
 expectedError(()=>validateRoster(entries,[], 'daily'),400,'invalid_roster');
});
test('daily full roster plan always blocks mutations until outbox/push ported',()=>{
 const plan=planAttendance(input,{actor:teacher,room,enrolled,today:date});
 assert.equal(plan.kind,'daily');
 assert.equal(plan.absence_count,1);
 assert.equal(plan.entries.length,2);
 assert.equal(plan.mutation_allowed,false);
 assert.equal(plan.blocker,'daily_absence_outbox_push_not_ported');
 assert.equal(Object.hasOwn(plan,'sql'),false);
});
test('period truancy always blocks mutation until business triggers/notifications migrated',()=>{
 const request={...input,kind:'period',timetable_id:44,
  entries:[{student_id:101,status:'truancy'},entries[1]],teaching_note:'Finished page 5'};
 const plan=planAttendance(request,{actor:affairs,room,slot,enrolled,today:date});
 assert.equal(plan.truancy_count,1);
 assert.equal(plan.teaching_note,'Finished page 5');
 assert.equal(plan.mutation_allowed,false);
 assert.equal(plan.blocker,'period_truancy_outbox_behavior_push_not_ported');
 expectedError(()=>planAttendance({...request,timetable_id:45},{actor:affairs,room,slot,enrolled,today:date}),400,'invalid_timetable');
 expectedError(()=>planAttendance({...request,teaching_note:'x'.repeat(2001)},{actor:affairs,room,slot,enrolled,today:date}),400,'invalid_teaching_note');
});
test('wrong room, future date and malformed actor deny plan before any DB write',()=>{
 expectedError(()=>planAttendance({...input,classroom_id:88},{actor:teacher,room,enrolled,today:date}),400,'invalid_room');
 expectedError(()=>planAttendance({...input,date:'2026-11-01'},{actor:teacher,room,enrolled,today:date}),400,'date_outside_write_window');
 expectedError(()=>planAttendance(input,{actor:{kind:'portal',role:'student',id:10},room,enrolled,today:date}),403,'forbidden');
});
