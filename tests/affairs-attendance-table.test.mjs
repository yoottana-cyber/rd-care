import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attendanceStatus,attendanceRoomRows,dailyAttendanceSummary, dailyAttendanceSummaryTable,
 filterAttendanceRooms,attendanceRoomTable} from '../web/affairs-attendance-table.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const records=[
 {id:6,grade:2,label:'ม.2/10',students:40,checked:20,missing:20,complete:false,
  advisor_user_id:11,advisor2_user_id:12,advisor_name:'ครู ก',advisor2_name:'ครู ข'},
 {id:4,grade:2,label:'ม.2/2',students:35,checked:35,missing:0,complete:true,
  advisor_user_id:14,advisor_name:'ครู ทดสอบ'},
 {id:3,grade:1,label:'ม.1/1',students:38,checked:0,missing:38,complete:false,
  advisor_user_id:null,advisor2_user_id:null,advisor_name:null,advisor2_name:null},
 {id:9,grade:3,label:'ม.3/1',students:0,checked:0,missing:0,complete:false},
 {id:8,grade:4,label:'ม.4/7',students:30,checked:16,missing:14,complete:false,
  advisor_user_id:23,advisor_name:'ครู ค'}
];
const today='2026-10-29';
const reminders=[
 {classroom_id:6,kind:'manual',state:'sent',delivered:2},
 {classroom_id:8,kind:'auto',state:'no_subscription',delivered:0}
];
test('daily summary table aggregates classrooms by grade and never counts empty rooms',()=>{
 const data=dailyAttendanceSummary(records);
 assert.deepEqual(data.total,{rooms:4,complete:1,pending:3,students:143,checked:71});
 assert.deepEqual(data.grades[1],{grade:2,rooms:2,complete:1,pending:1,students:75,checked:55});
 assert.equal(data.grades.length,6);
 const html=dailyAttendanceSummaryTable(records);
 assert.match(html,/ตารางตรวจสอบการเช็กชื่อรายวัน/);
 assert.match(html,/รวมทุกระดับชั้น/);
 assert.match(html,/ม\.1/);
 assert.match(html,/ม\.6/);
 assert.match(html,/71 \/ 143/);
 assert.match(html,/<table/);
 assert.doesNotMatch(html,/rd-affairs-metrics/);
});
test('room table sorts grade and room numerically and labels all three statuses',()=>{
 assert.deepEqual(attendanceRoomRows(records).map(x=>x.label),
  ['ม.1/1','ม.2/2','ม.2/10','ม.4/7']);
 assert.equal(attendanceStatus(records[0]),'pending');
 assert.equal(attendanceStatus(records[1]),'complete');
 assert.equal(attendanceStatus(records[2]),'unstarted');
 const html=attendanceRoomTable(records,reminders,{date:today,today,pageSize:'all'});
 assert.match(html,/ตารางติดตามการเช็กชื่อรายห้องเรียน/);
 assert.match(html,/ครู ก \/ ครู ข/);
 assert.match(html,/ม\.2\/10/);
 assert.match(html,/ยังไม่เริ่ม/);
 assert.match(html,/กำลังเช็ก/);
 assert.match(html,/ครบแล้ว/);
 assert.match(html,/แสดง 1–4 จาก 4 ห้อง/);
 assert.match(html,/<progress/);
});
test('filters support grade, attendance status, query by teacher or room',()=>{
 assert.deepEqual(filterAttendanceRooms(records,{grade:'2'}).map(r=>r.id),[4,6]);
 assert.deepEqual(filterAttendanceRooms(records,{status:'complete'}).map(r=>r.id),[4]);
 assert.deepEqual(filterAttendanceRooms(records,{status:'unstarted'}).map(r=>r.id),[3]);
 assert.deepEqual(filterAttendanceRooms(records,{status:'pending'}).map(r=>r.id),[6,8]);
 assert.deepEqual(filterAttendanceRooms(records,{query:'ครู ข'}).map(r=>r.id),[6]);
 assert.deepEqual(filterAttendanceRooms(records,{query:'ม.2/2'}).map(r=>r.id),[4]);
 const none=attendanceRoomTable(records,reminders,{query:'ไม่มีห้องนี้',date:today,today});
 assert.match(none,/ไม่พบห้องเรียนที่ตรงกับเงื่อนไข/);
 assert.doesNotMatch(none,/data-affairs-remind=/);
});
test('reminder action respects today, pending room, teacher assignment and manual dedup',()=>{
 const html=attendanceRoomTable(records,reminders,{date:today,today,pageSize:'all'});
 assert.match(html,/data-affairs-remind="6" disabled/);
 assert.match(html,/✓ แจ้งเตือนแล้ว/);
 assert.match(html,/data-affairs-remind="8"/);
 assert.match(html,/ยังไม่กำหนดครู/);
 assert.doesNotMatch(html,/data-affairs-remind="4"/);
 assert.doesNotMatch(html,/data-affairs-remind="3"/);
 assert.match(html,/ส่งถึงอุปกรณ์แล้ว \(2 เครื่อง\)/);
 const past=attendanceRoomTable(records,reminders,{date:'2026-10-28',today,pageSize:'all'});
 assert.doesNotMatch(past,/data-affairs-remind=/);
});
test('many rooms paginate correctly and allow full 48-room view',()=>{
 const many=Array.from({length:48},(_,i)=>({
  id:i+1,grade:Math.floor(i/8)+1,label:'ม.'+(Math.floor(i/8)+1)+'/'+(i%8+1),
  students:30,checked:i%3?30:0,advisor_user_id:1,advisor_name:'ครู'
 }));
 const page2=attendanceRoomTable(many,[],{date:today,today,pageSize:'25',page:2});
 assert.match(page2,/แสดง 26–48 จาก 48 ห้อง/);
 assert.match(page2,/หน้า 2 \/ 2/);
 assert.match(page2,/data-att-page="prev"/);
 const full=attendanceRoomTable(many,[],{date:today,today,pageSize:'all'});
 assert.match(full,/แสดง 1–48 จาก 48 ห้อง/);
});
test('room and advisor labels are escaped before rendering HTML or attributes',()=>{
 const malicious=[{id:1,grade:1,label:'<script>alert(1)</script>',advisor_name:'<img src=x onerror=1>',
  students:1,checked:0,advisor_user_id:7}];
 const html=attendanceRoomTable(malicious,[],{date:today,today,pageSize:'all'});
 assert.doesNotMatch(html,/<script>|<img/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&lt;img/);
});
test('student affairs UI uses tables in both attendance sections and delegated row actions',()=>{
 const ui=read('web/student-affairs.js'),css=read('web/student-affairs.css'),sw=read('web/sw.js');
 assert.match(ui,/dailyAttendanceSummaryTable\(teachers\)/);
 assert.match(ui,/attendanceRoomTable\(teachers,result\.reminders/);
 assert.match(ui,/id="affairsRoomSearch"/);
 assert.match(ui,/id="affairsRoomGrade"/);
 assert.match(ui,/id="affairsRoomStatus"/);
 assert.match(ui,/id="affairsRoomPageSize"/);
 assert.match(ui,/bind\('#affairsRoomTableArea','click'/);
 assert.match(ui,/data-affairs-remind/);
 assert.doesNotMatch(ui,/rd-affairs-attendance-grid/);
 assert.match(css,/rd-affairs-rooms-table/);
 assert.match(css,/rd-affairs-table-scroll/);
 assert.match(sw,/affairs-attendance-table\.js/);
});
