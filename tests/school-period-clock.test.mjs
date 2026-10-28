import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {periodClockRows,lessonClockLabel,PERIOD_DURATION_CHOICES} from '../web/period-clock.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('three official duration options and ten periods have correct boundaries',()=>{
 assert.deepEqual(PERIOD_DURATION_CHOICES,[50,45,40]);
 for(const [minutes,last] of [[50,'16:50'],[45,'16:00'],[40,'15:10']]){
  const rows=periodClockRows('08:30',minutes);
  assert.equal(rows.length,10);
  assert.deepEqual(rows[0],{period:1,start:'08:30',
   end:minutes===50?'09:20':minutes===45?'09:15':'09:10'});
  assert.equal(rows.at(-1).end,last);
  assert.equal(rows[0].end,rows[1].start);
  assert.equal(lessonClockLabel(1,2,rows),'08:30–'+rows[1].end+' น.');
  assert.equal(lessonClockLabel(10,10,rows),rows[9].start+'–'+last+' น.');
 }
});
test('lesson clock supports different first period start independently of late QR cutoff',()=>{
 const rows=periodClockRows('09:00',45);
 assert.equal(lessonClockLabel(1,1,rows),'09:00–09:45 น.');
 assert.equal(lessonClockLabel(2,3,rows),'09:45–11:15 น.');
 assert.equal(lessonClockLabel(4,4,rows),'11:15–12:00 น.');
 assert.equal(lessonClockLabel(0,12,rows),'');
});
test('invalid values and overnight school timetable fail safely',()=>{
 for(const [start,minutes] of [['24:00',50],['18:00',50],['08:30',60],
  ['08:30','45'],['bad',45],['23:50',40]]){
  assert.throws(()=>periodClockRows(start,minutes),RangeError);
 }
});
test('administrator settings and teacher screens use the same period clock module',()=>{
 const admin=read('web/school-settings.js');
 const timetable=read('web/my-timetable.js');
 const center=read('web/period-center.js');
 const api=read('worker/src/worker.js');
 for(const source of [admin,timetable,center]){
  assert.match(source,/from '.\/period-clock\.js'/);
 }
 assert.match(admin,/name="period_duration_minutes"/);
 assert.match(admin,/first_period_start_time/);
 assert.match(admin,/rdPeriodClockPreview/);
 assert.match(admin,/lunch_after_period/);
 assert.match(admin,/between_period_break_minutes/);
 assert.match(timetable,/\/api\/school\/period-clock/);
 assert.match(center,/\/api\/school\/period-clock/);
 assert.match(api,/if\(req\.method==='GET'&&path==='\/api\/school\/period-clock'\)/);
 assert.match(api,/requireRole\(user,\['teacher','staff','admin'\]\)/);
 assert.match(api,/SELECT first_period_start_time,period_duration_minutes/);
 assert.match(api,/lunch_after_period,lunch_break_minutes,between_period_break_minutes/);
 assert.doesNotMatch(api,/path==='\/api\/school\/period-clock'[\s\S]{0,400}UPDATE school_settings/);
});
test('lunch break after period four replaces recess at the same boundary',()=>{
 const options={lunch_after_period:4,lunch_break_minutes:60,between_period_break_minutes:5};
 const rows=periodClockRows('08:30',50,10,options);
 assert.equal(rows[0].start,'08:30');
 assert.equal(rows[1].start,'09:25');
 assert.equal(rows[3].end,'12:05');
 assert.deepEqual(rows[4].breakBefore,{
  kind:'lunch',after_period:4,minutes:60,start:'12:05',end:'13:05'
 });
 assert.equal(rows[4].start,'13:05');
 assert.equal(rows[4].end,'13:55');
 assert.equal(rows[9].end,'18:25');
 assert.match(lessonClockLabel(4,5,rows),/มีช่วงพัก/);
 assert.doesNotMatch(lessonClockLabel(5,5,rows),/มีช่วงพัก/);
});
test('shortened school day and lunch after period five compute properly',()=>{
 for(const minutes of [40,45,50]){
  const options={lunch_after_period:5,lunch_break_minutes:45,between_period_break_minutes:0};
  const rows=periodClockRows('08:00',minutes,10,options);
  assert.equal(rows[5].breakBefore.kind,'lunch');
  assert.equal(rows[5].breakBefore.minutes,45);
  assert.equal(rows.at(-1).end,
   minutes===40?'15:25':minutes===45?'16:15':'17:05');
 }
});
test('no configured lunch/recess keeps the previous continuous schedule',()=>{
 const old=periodClockRows('08:30',50);
 const explicit=periodClockRows('08:30',50,10,{
  lunch_after_period:0,lunch_break_minutes:0,between_period_break_minutes:0
 });
 assert.deepEqual(explicit,old);
 assert.equal(old.at(-1).end,'16:50');
 assert.equal(old.some(x=>'breakBefore' in x),false);
});
test('reject invalid break positions, inconsistent lunch settings and overnight times',()=>{
 const base={lunch_after_period:4,lunch_break_minutes:60,between_period_break_minutes:5};
 for(const broken of [
  {lunch_after_period:-1},{lunch_after_period:10},{lunch_break_minutes:0},
  {lunch_break_minutes:200},{lunch_break_minutes:'60'},
  {between_period_break_minutes:31},{between_period_break_minutes:-1},
  {lunch_after_period:0,lunch_break_minutes:60}
 ])assert.throws(()=>periodClockRows('08:30',50,10,{...base,...broken}),RangeError);
 assert.throws(()=>periodClockRows('18:00',50,10,{
  lunch_after_period:5,lunch_break_minutes:180,between_period_break_minutes:30
 }),RangeError);
});
test('migration does not modify attendance, timetable, late QR or session permissions',()=>{
 const sql=read('worker/migrations/0028_school_period_clock.sql');
 const extra=read('worker/migrations/0029_school_lunch_and_recess.sql');
 assert.match(extra,/ADD COLUMN lunch_after_period/);
 assert.match(extra,/ADD COLUMN lunch_break_minutes/);
 assert.match(extra,/ADD COLUMN between_period_break_minutes/);
 assert.doesNotMatch(extra,/DROP TABLE|DELETE FROM|UPDATE attendance|UPDATE timetable/);
 assert.match(sql,/ALTER TABLE school_settings ADD COLUMN first_period_start_time/);
 assert.match(sql,/ALTER TABLE school_settings ADD COLUMN period_duration_minutes/);
 assert.match(sql,/CHECK\(period_duration_minutes IN \(40,45,50\)\)/);
 assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|UPDATE attendance|UPDATE timetable|late_cutoff_time/);
});
