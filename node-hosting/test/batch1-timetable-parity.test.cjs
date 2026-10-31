'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateLesson,planTimetableAction}
 =require('../src/timetable-d1-parity.cjs');
const teacher={id:7,role:'teacher'};
const staffTeacher={id:7,role:'staff'};
const other={id:8,role:'teacher'};
const lesson={classroom_id:30,day_of_week:1,period:2,end_period:3,
 subject_code:'ว30101',subject:'ภาษาไทย',teacher_user_id:7};
const existing={id:55,teacher_user_id:7,approval_status:'approved'};
function deny(fn,status,code){assert.throws(fn,e=>e?.status===status&&e?.message===code)}
test('period 1..10, maximum two consecutive lessons and subject-code required',()=>{
 assert.equal(validateLesson(lesson).end_period,3);
 assert.equal(validateLesson({...lesson,end_period:null}).end_period,2);
 for(const bad of [
  {...lesson,period:0},{...lesson,period:11},
  {...lesson,end_period:4},{...lesson,end_period:11},
  {...lesson,day_of_week:8},{...lesson,classroom_id:0}
 ])deny(()=>validateLesson(bad),400,'invalid_timetable_period');
 for(const bad of [
  {...lesson,subject_code:''},{...lesson,subject:''},
  {...lesson,subject_code:'x'.repeat(31)},
  {...lesson,subject:'x'.repeat(121)},
  {...lesson,subject:'bad<>'}
 ])deny(()=>validateLesson(bad),400,'invalid_timetable_subject');
});
test('teacher and student affairs staff teach own lesson without administrator edit bypass',()=>{
 for(const who of [teacher,staffTeacher]){
  const x=planTimetableAction('insert',{actor:who,body:lesson});
  assert.equal(x.teacher_user_id,7);
  assert.equal(x.mutation_allowed,false);
 }
 deny(()=>planTimetableAction('insert',{actor:{id:7,role:'admin'},body:lesson}),403,'forbidden');
 deny(()=>planTimetableAction('update',{actor:other,existing,body:lesson}),403,'forbidden');
 deny(()=>planTimetableAction('update',{actor:{id:99,role:'admin'},existing,body:lesson}),403,'forbidden');
});
test('existing attendance preserves timetable; archive retains history instead of deleting row',()=>{
 deny(()=>planTimetableAction('update',{actor:teacher,existing,body:lesson,hasHistory:true}),
  409,'timetable_attendance_history_exists');
 deny(()=>planTimetableAction('archive',{actor:teacher,existing,hasHistory:true}),
  409,'timetable_attendance_history_exists');
 const archived=planTimetableAction('archive',{actor:teacher,existing});
 assert.equal(archived.active,0);
 assert.equal(archived.approval_status,'archived');
 assert.equal(archived.mutation_allowed,false);
 deny(()=>planTimetableAction('update',{actor:teacher,existing:{...existing,approval_status:'archived'},body:lesson}),404,'not_found');
});
