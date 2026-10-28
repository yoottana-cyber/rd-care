import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {weekMonday,lessonPeriod,buildWeekRows} from '../web/period-center.js';

test('weekly grid aligns weekdays and displays one cell spanning double periods',()=>{
 assert.equal(weekMonday('2026-10-29'),'2026-10-26');
 const lessons=[
  {id:8,day_of_week:1,period:1,end_period:2,subject:'วิทยาการคำนวณ',classroom_label:'ม.2/4',approval_status:'approved'},
  {id:9,day_of_week:1,period:7,end_period:8,subject:'Google Sites',classroom_label:'ม.3/8',approval_status:'approved'}
 ];
 const days=buildWeekRows(lessons,'2026-10-26');
 assert.equal(days.length,5);
 assert.equal(days[0].date,'2026-10-26');
 assert.equal(days[0].cells.reduce((n,c)=>n+c.span,0),10);
 assert.deepEqual(days[0].cells.filter(c=>c.lesson).map(c=>[c.lesson.id,c.span]),[[8,2],[9,2]]);
 assert.equal(lessonPeriod(lessons[0]),'1-2');
 assert.equal(lessonPeriod({period:10,end_period:10}),'10');
});
test('Saturday and Sunday render when teacher schedules weekend lessons',()=>{
 const lessons=[{id:10,day_of_week:7,period:10,end_period:10,approval_status:'approved'}];
 const days=buildWeekRows(lessons,'2026-10-26');
 assert.equal(days.length,7);
 assert.equal(days[6].dayLabel,'อาทิตย์');
 assert.equal(days[6].date,'2026-11-01');
 assert.equal(days[6].cells.find(x=>x.lesson?.id===10).period,10);
});
test('archived and inactive lessons do not appear in calendar',()=>{
 const lessons=[
 {id:7,day_of_week:1,period:1,approval_status:'archived'},
 {id:8,day_of_week:1,period:2,approval_status:'rejected'},
 {id:9,day_of_week:1,period:3,approval_status:'approved',active:0}
 ];
 assert.equal(buildWeekRows(lessons,'2026-10-26')[0].cells.filter(x=>x.lesson).length,0);
});

test('weekly period headings keep number and clock on separate lines and preserve ten column layout',()=>{
 const page=readFileSync(new URL('../web/period-center.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/period-center.css',import.meta.url),'utf8');
 assert.match(page,/Array\.from\(\{length:10\}/);
 assert.match(page,/class="period-column-head"/);
 assert.match(page,/class="period-column-number"/);
 assert.match(page,/class="period-column-time"/);
 assert.match(page,/periodClock\[i\]/);
 assert.match(page,/class="period-slot-meta"/);
 assert.match(page,/class="period-slot-time"/);
 assert.match(css,/\.period-column-head \.period-column-number\s*\{\s*display:block/);
 assert.match(css,/\.period-column-head \.period-column-time\s*\{\s*display:block/);
 assert.match(css,/min-width:1530px/);
 assert.match(css,/\.period-grid-scroll\{[^}]*overflow-x:auto/);
 assert.match(css,/\[data-theme="dark"\] \.period-column-head \.period-column-time/);
});
