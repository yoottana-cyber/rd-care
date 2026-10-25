import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderAttendanceCharts} from '../web/dashboard-charts.js';

test('attendance charts use only actual daily D1 status counts with readable labels',()=>{
 const trend=[
 {date:'2026-10-19',present:10,absent:1,late:2,leave:1},
 {date:'2026-10-20',present:11,absent:0,late:1,leave:0},
 {date:'2026-10-21',present:12,absent:1,late:0,leave:1},
 {date:'2026-10-22',present:12,absent:1,late:1,leave:0},
 {date:'2026-10-23',present:12,absent:1,late:0,leave:1},
 {date:'2026-10-24',present:0,absent:0,late:0,leave:0},
 {date:'2026-10-25',present:13,absent:1,late:0,leave:0}
 ];
 const markup=renderAttendanceCharts({daily_statuses:trend[6],daily_trend:trend});
 assert.match(markup,/ย้อนหลัง 7 วัน/);
 assert.match(markup,/สัดส่วนการมาเรียน/);
 assert.match(markup,/เช็กชื่อรวม 14 รายการ/);
 assert.match(markup,/25\/10/);
 for(const key of ['มาเรียน','ขาด','สาย','ลา'])assert.ok(markup.includes(key));
 assert.doesNotMatch(markup,/NaN|Infinity/);
});
test('no attendance does not imply student absence or a false percentage',()=>{
 const markup=renderAttendanceCharts({daily_statuses:{present:0,absent:0,late:0,leave:0},daily_trend:[]});
 assert.match(markup,/ยังไม่มีบันทึกเช็กชื่อ/);
 assert.match(markup,/ไม่มีข้อมูลการมาเรียนในช่วงนี้/);
 assert.doesNotMatch(markup,/>100%|NaN/);
});
test('D1 dashboard query joins scoped classroom enrollments and aggregates daily status in seven-day window',()=>{
 const code=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 const start=code.indexOf('async function dashboard(');
 const end=code.indexOf('async function ',start+10);
 const dashboard=code.slice(start,end);
 assert.match(dashboard,/GROUP BY d\.school_date,d\.status/);
 assert.match(dashboard,/attendance_daily/);
 assert.match(dashboard,/student_enrollments/);
 assert.match(dashboard,/filter\+" GROUP BY/);
 assert.match(dashboard,/daily_statuses/);
 assert.match(dashboard,/daily_trend/);
 assert.match(dashboard,/date\(\?,'-6 days'\)/);
});
test('charts load into staff dashboard and are precached for mobile PWA',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../web/sw.js',import.meta.url),'utf8');
 assert.match(app,/renderAttendanceCharts\(s\)/);
 assert.match(sw,/dashboard-charts\.js/);
 assert.match(sw,/charts\.css/);
 assert.match(sw,/rd-care-shell-v(19|20|21|22|23)/);
});
