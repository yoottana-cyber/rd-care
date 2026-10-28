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
 assert.match(timetable,/\/api\/school\/period-clock/);
 assert.match(center,/\/api\/school\/period-clock/);
 assert.match(api,/if\(req\.method==='GET'&&path==='\/api\/school\/period-clock'\)/);
 assert.match(api,/requireRole\(user,\['teacher','staff','admin'\]\)/);
 assert.match(api,/SELECT first_period_start_time,period_duration_minutes/);
 assert.doesNotMatch(api,/path==='\/api\/school\/period-clock'[\s\S]{0,400}UPDATE school_settings/);
});
test('migration does not modify attendance, timetable, late QR or session permissions',()=>{
 const sql=read('worker/migrations/0028_school_period_clock.sql');
 assert.match(sql,/ALTER TABLE school_settings ADD COLUMN first_period_start_time/);
 assert.match(sql,/ALTER TABLE school_settings ADD COLUMN period_duration_minutes/);
 assert.match(sql,/CHECK\(period_duration_minutes IN \(40,45,50\)\)/);
 assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|UPDATE attendance|UPDATE timetable|late_cutoff_time/);
});
