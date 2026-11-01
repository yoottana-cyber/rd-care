import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bangkokToday,weekday} from '../worker/src/core.js';
import {attendanceReminderScheduleReason,sendScheduledAttendanceReminders,studentAffairsRoutes}
 from '../worker/src/student-affairs.js';

const policy={auto_enabled:1,reminder_time:'08:30',weekdays:'1,2,3,4,5'};
test('automatic daily check-in reminders explain switch, weekday and time gates',()=>{
 const monday='2026-11-02',sunday='2026-11-01';
 assert.equal(attendanceReminderScheduleReason({...policy,auto_enabled:0},monday,'09:00'),'switch_off');
 assert.equal(attendanceReminderScheduleReason(policy,sunday,'10:00'),'weekday_excluded');
 assert.equal(attendanceReminderScheduleReason(policy,monday,'08:29'),'before_time');
 assert.equal(attendanceReminderScheduleReason(policy,monday,'08:30'),'ready');
});
test('global notification category is a separate gate from enabled affairs schedule',async()=>{
 const today=bangkokToday();
 const setting={auto_enabled:1,reminder_time:'00:00',weekdays:String(weekday(today))};
 const sql=[];
 const env={DB:{prepare(q){
  sql.push(q);
  if(q.includes('FROM affairs_settings'))return {first:async()=>setting};
  if(q.includes('FROM notification_preferences'))return {bind:()=>({first:async()=>({enabled:0})})};
  throw Error('Unexpected access when category is disabled: '+q);
 }}};
 const r=await sendScheduledAttendanceReminders(env);
 assert.equal(r.state,'category_disabled');
 assert.equal(r.count,0);
 assert.equal(sql.length,2);
});
test('student affairs status endpoint is staff-only and reports why the scheduler is idle',async()=>{
 const today=bangkokToday(),seen=[];
 const db={prepare(sql){
  seen.push(sql);
  if(sql.includes('FROM affairs_settings'))return {first:async()=>({
   auto_enabled:0,reminder_time:'08:30',weekdays:'1,2,3,4,5'})};
  if(sql.includes('FROM classrooms c'))return {bind:()=>({all:async()=>({results:[]})})};
  if(sql.includes('FROM affairs_attendance_reminders'))return {bind:()=>({all:async()=>({results:[]})})};
  throw Error('unexpected DB query: '+sql);
 }};
 const path='/api/affairs/reminder-status',url='https://rd.test'+path;
 const req=new Request(url,{method:'GET'});
 const out=await studentAffairsRoutes(req,{DB:db},{id:1,role:'staff'},path);
 assert.equal(out.status,200);
 const data=await out.json();
 assert.equal(data.today,today);
 assert.equal(data.reason,'switch_off');
 assert.equal(data.pending_rooms,0);
 assert.equal(data.incomplete_rooms,0);
 const oldCount=seen.length;
 await assert.rejects(()=>studentAffairsRoutes(req,{DB:db},{id:2,role:'teacher',student_affairs:0},path),{code:403});
 assert.equal(seen.length,oldCount,'ordinary teacher must not inspect school-wide status');
});
test('student affairs UI clearly describes Node.js Cron and daily skip states',()=>{
 const ui=readFileSync(new URL('../web/student-affairs.js',import.meta.url),'utf8');
 assert.match(ui,/Node\.js Cron ของโรงเรียน/);
 assert.match(ui,/api\/affairs\/reminder-status/);
 for(const reason of ['switch_off','weekday_excluded','before_time','category_disabled','holiday',
  'no_subscriptions','ready','already_attempted'])assert.ok(ui.includes(reason),reason);
 assert.doesNotMatch(ui,/ตรวจทุก 5 นาทีผ่าน Cloudflare Cron/);
 const worker=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 assert.match(worker,/RD DAILY REMINDER:/);
 assert.match(worker,/Promise\.allSettled/);
 assert.match(worker,/school_daily_reminder_job_failed/);
});


test('read-only status reports unsubscribed advisors without sending anything',async()=>{
 const today=bangkokToday(),w=weekday(today);
 let sends=0;
 const room={id:5,grade:2,label:'Room 2/5',advisor_user_id:19,advisor2_user_id:null,
  students:30,checked:0};
 const db={prepare(sql){
  if(sql.includes('FROM affairs_settings'))return {first:async()=>({
   auto_enabled:1,reminder_time:'00:00',weekdays:String(w)})};
  if(sql.includes('FROM notification_preferences'))return {bind:()=>({first:async()=>({enabled:1})})};
  if(sql.includes('FROM affairs_non_school_days'))return {bind:()=>({first:async()=>null})};
  if(sql.includes('FROM classrooms c'))return {bind:()=>({all:async()=>({results:[room]})})};
  if(sql.includes('FROM affairs_attendance_reminders'))return {bind:()=>({all:async()=>({results:[]})})};
  if(sql.includes('FROM staff_push_subscriptions'))return {bind:()=>({all:async()=>({results:[]})})};
  sends++;
  throw Error('Unexpected database mutation or query: '+sql);
 }};
 const path='/api/affairs/reminder-status';
 const response=await studentAffairsRoutes(new Request('https://rd.test'+path),{DB:db},
  {id:77,role:'staff'},path);
 const body=await response.json();
 assert.equal(body.today,today);
 assert.equal(body.reason,'no_subscriptions');
 assert.equal(body.pending_rooms,1);
 assert.equal(body.opted_in_advisors,0);
 assert.equal(sends,0);
});
