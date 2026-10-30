'use strict';
// RD CONNECT stage B1-write — FAIL-CLOSED attendance submission planning.
// Matches the Cloudflare D1 rules: complete enrollment roster, <=14 days
// old (Bangkok), room advisor/admin daily, timetable owner/admin period.
// No public HTTP route imports this module, and it executes NO SQL writes.
// Subsequent implementation must port all truancy/behavior/outbox side effects.
const {validDate,asId}=require('./school-read-service.cjs');
const DAILY=new Set(['present','absent','late','leave']);
const PERIOD=new Set([...DAILY,'truancy']);
const fail=(status,code)=>{const e=Error(code);e.status=status;throw e};
function weekday(date){
 if(!validDate(date))fail(400,'invalid_date');
 return ((new Date(date+'T00:00:00Z').getUTCDay()+6)%7)+1;
}
function bangkokToday(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail(400,'invalid_now');
 const parts=new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(now);
 const data=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return data.year+'-'+data.month+'-'+data.day;
}
function requireWriteDate(date,today=bangkokToday()){
 if(!validDate(date)||!validDate(today))fail(400,'invalid_date');
 const days=(Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
 if(days>0||days< -14)fail(400,'date_outside_write_window');
 return date;
}
function requireStaff(actor){
 if(!actor||actor.kind!=='staff'||!['teacher','staff','admin'].includes(actor.role)||
  !asId(actor.id))fail(403,'forbidden');
 return Number(actor.id);
}
function allowedDaily(actor,room){
 const id=requireStaff(actor);
 if(actor.role==='admin')return true;
 // Student affairs staff are NOT school-wide daily attendance writers.
 if(!room||!room.id||(!room.advisor_user_id&&!room.advisor2_user_id))fail(403,'forbidden');
 if(Number(room.advisor_user_id)!==id&&Number(room.advisor2_user_id)!==id)
  fail(403,'forbidden');
 return true;
}
function allowedPeriod(actor,room,slot,date){
 const id=requireStaff(actor);
 if(!slot||Number(slot.active)!==1||!asId(slot.id)||!room||
   Number(slot.classroom_id)!==Number(room.id)||
   Number(slot.day_of_week)!==weekday(date))
  fail(400,'invalid_timetable');
 // Advisor assignment NEVER grants period attendance rights.
 if(actor.role!=='admin'&&Number(slot.teacher_user_id)!==id)
  fail(403,'forbidden');
 return true;
}
function validateRoster(entries,enrolled,kind){
 if(!['daily','period'].includes(kind))fail(400,'invalid_kind');
 const status=kind==='daily'?DAILY:PERIOD;
 if(!Array.isArray(enrolled)||!enrolled.length||enrolled.length>100)
  fail(400,'invalid_roster');
 const expected=new Set(enrolled);
 if(expected.size!==enrolled.length||[...expected].some(x=>!asId(x)))
  fail(400,'invalid_roster');
 if(!Array.isArray(entries)||entries.length!==expected.size)
  fail(400,'incomplete_roster');
 const seen=new Set();
 const out=[];
 for(const entry of entries){
  if(!entry||!Number.isSafeInteger(entry.student_id)||!expected.has(entry.student_id)||
    seen.has(entry.student_id)||!status.has(entry.status))
   fail(400,'invalid_entries');
  seen.add(entry.student_id);
  out.push({student_id:entry.student_id,status:entry.status});
 }
 return out;
}
function planAttendance(body,{actor,room,slot,enrolled,today=bangkokToday()}={}){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'invalid_request');
 const date=requireWriteDate(body.date,today);
 const kind=body.kind;
 if(kind!=='daily'&&kind!=='period')fail(400,'invalid_kind');
 if(!room||Number(room.id)!==Number(body.classroom_id)||!asId(room.id))
  fail(400,'invalid_room');
 if(kind==='daily')allowedDaily(actor,room);
 else allowedPeriod(actor,room,slot,date);
 const entries=validateRoster(body.entries,enrolled,kind);
 const result={kind,date,classroom_id:Number(room.id),
  actor_id:requireStaff(actor),entries,requires_business_trigger_parity:kind==='period'};
 if(kind==='period'){
  if(body.timetable_id!==slot.id)fail(400,'invalid_timetable');
  result.timetable_id=Number(slot.id);
  if(Object.prototype.hasOwnProperty.call(body,'teaching_note')){
   if(typeof body.teaching_note!=='string'||body.teaching_note.length>2000)
    fail(400,'invalid_teaching_note');
   result.teaching_note=body.teaching_note.trim();
  }
  result.truancy_count=entries.filter(x=>x.status==='truancy').length;
  // Period absence may create advisor review/outbox events; truancy
  // additionally depends on behavior -10 triggers and Push consumers.
  result.mutation_allowed=false;
  result.blocker='period_truancy_outbox_behavior_push_not_ported';
 }else{
  // Daily absence may cancel pending period review/outbox notifications;
  // do not persist it until full atomic side effects are ported.
  result.absence_count=entries.filter(x=>x.status==='absent').length;
  result.mutation_allowed=false;
  result.blocker='daily_absence_outbox_push_not_ported';
 }
 return result;
}
module.exports={DAILY,PERIOD,weekday,bangkokToday,requireWriteDate,
 allowedDaily,allowedPeriod,validateRoster,planAttendance};
