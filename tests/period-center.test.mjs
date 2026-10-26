import test from 'node:test';
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
