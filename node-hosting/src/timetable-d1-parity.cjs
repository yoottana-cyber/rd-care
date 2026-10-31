'use strict';
// RD CONNECT school timetable business contract from Worker teacher-timetable.js.
// OFFLINE ONLY — do not expose public write paths. This validation is stricter
// than generic stage-7 lab prototype (which lacks subject_code/history rules).
const fail=(status,code)=>{const e=Error(code);e.status=status;throw e};
const ID=n=>Number.isSafeInteger(n)&&n>0;
function validateLesson(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  fail(400,'invalid_lesson');
 const room=input.classroom_id,day=input.day_of_week,start=input.period;
 const end=input.end_period==null?start:input.end_period;
 const subjectCode=typeof input.subject_code==='string'?input.subject_code.trim():'';
 const subject=typeof input.subject==='string'?input.subject.trim():'';
 if(!ID(room)||!Number.isInteger(day)||day<1||day>7||
    !Number.isInteger(start)||start<1||start>10||
    !Number.isInteger(end)||end<start||end>10||end-start>1)
  fail(400,'invalid_timetable_period');
 if(!subjectCode||subjectCode.length>30||!subject||subject.length>120||
   /[\u0000-\u001f\u007f<>]/.test(subjectCode+subject))
  fail(400,'invalid_timetable_subject');
 return {classroom_id:room,day_of_week:day,period:start,
  end_period:end,subject_code:subjectCode,subject};
}
function ownerOrAdmin(actor,lesson){
 if(!actor||!ID(actor.id)||!['teacher','staff','admin'].includes(actor.role))
  fail(403,'forbidden');
 if(!lesson||!ID(lesson.id))fail(404,'not_found');
 // D1 teacher timetable routes intentionally restrict owner,
 // including a student-affairs staff teacher. No auto admin override.
 if(Number(lesson.teacher_user_id)!==actor.id)
  fail(403,'forbidden');
 if(lesson.approval_status==='archived')fail(404,'not_found');
 return true;
}
function ensureNoAttendance(lesson,hasHistory){
 if(!lesson||!ID(lesson.id))fail(404,'not_found');
 if(hasHistory===true)fail(409,'timetable_attendance_history_exists');
 return true;
}
function planTimetableAction(action,{actor,existing,body,hasHistory=false}={}){
 if(!['insert','update','archive'].includes(action))
  fail(405,'method_not_allowed');
 if(action==='insert'){
  if(!actor||!ID(actor.id)||!['teacher','staff'].includes(actor.role))
   fail(403,'forbidden');
  const lesson=validateLesson(body);
  return {action,teacher_user_id:actor.id,lesson,
   approval_status:'approved',active:1,mutation_allowed:false};
 }
 ownerOrAdmin(actor,existing);
 ensureNoAttendance(existing,hasHistory);
 if(action==='archive')
  return {action,id:existing.id,teacher_user_id:actor.id,
   active:0,approval_status:'archived',mutation_allowed:false};
 const lesson=validateLesson(body);
 return {action,id:existing.id,teacher_user_id:actor.id,
  lesson,active:1,approval_status:'approved',mutation_allowed:false};
}
module.exports={validateLesson,ownerOrAdmin,ensureNoAttendance,planTimetableAction};
