import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {availableScoreMonitorRooms,filterAndSortScoreMonitorRows} from '../web/teacher-score-monitor.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const entries=[
 {student_id:1,grade:1,classroom_id:101,classroom_label:'ม.1/1',student_no:'001',full_name:'แดง ใจดี',
  good_total:10,behavior_deducted:20,behavior_adjusted:8,behavior_remaining:12,events:2},
 {student_id:2,grade:1,classroom_id:101,classroom_label:'ม.1/1',student_no:'002',full_name:'แก้ว ใจดี',
  good_total:30,behavior_deducted:5,behavior_adjusted:5,behavior_remaining:0,events:1},
 {student_id:3,grade:1,classroom_id:102,classroom_label:'ม.1/2',student_no:'003',full_name:'ฟ้า ดีงาม',
  good_total:30,behavior_deducted:11,behavior_adjusted:0,behavior_remaining:11,events:0},
 {student_id:4,grade:2,classroom_id:201,classroom_label:'ม.2/1',student_no:'004',full_name:'บุญ มีดี',
  good_total:15,behavior_deducted:9,behavior_adjusted:0,behavior_remaining:9,events:3}
];
const ids=rows=>rows.map(r=>r.student_id);

test('room options are distinct by classroom_id and filtered by selected grade',()=>{
 assert.deepEqual(availableScoreMonitorRooms(entries,1),[
  {id:101,label:'ม.1/1'},{id:102,label:'ม.1/2'}
 ]);
 assert.deepEqual(availableScoreMonitorRooms(entries,2),[{id:201,label:'ม.2/1'}]);
 assert.equal(availableScoreMonitorRooms(entries).length,3);
 assert.deepEqual(availableScoreMonitorRooms([],1),[]);
});

test('selecting a room excludes students from other classrooms and preserves roster order by default',()=>{
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{grade:1,roomId:101})),[1,2]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{roomId:102})),[3]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{grade:2,roomId:101})),[]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries)),[1,2,3,4]);
});

test('good points can be sorted high-to-low or low-to-high and tied scores keep roster order',()=>{
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'good_total',sortOrder:'desc'})),[2,3,4,1]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'good_total',sortOrder:'asc'})),[1,4,2,3]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{grade:1,roomId:101,
  sortBy:'good_total',sortOrder:'desc'})),[2,1]);
});

test('misconduct points sort by total deducted, while outstanding points use remaining balance',()=>{
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'behavior_deducted',sortOrder:'desc'})),[1,3,4,2]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'behavior_deducted',sortOrder:'asc'})),[2,4,3,1]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'behavior_remaining',sortOrder:'desc'})),[1,3,4,2]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'behavior_remaining',sortOrder:'asc'})),[2,4,3,1]);
});

test('search and recorded-only filters remain active together with classroom and score sorting',()=>{
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{grade:1,roomId:101,
  query:'ใจดี',recordFilter:'recorded',sortBy:'good_total',sortOrder:'desc'})),[2,1]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{recordFilter:'unrecorded',
  sortBy:'behavior_remaining'})),[3]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{query:'ม.2/1'})),[4]);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{query:'003'})),[3]);
});

test('sorting does not mutate API results or permit arbitrary field names',()=>{
 const original=ids(entries);
 assert.deepEqual(ids(filterAndSortScoreMonitorRows(entries,{sortBy:'student_no',sortOrder:'desc'})),original);
 assert.deepEqual(ids(entries),original);
 assert.notStrictEqual(filterAndSortScoreMonitorRows(entries,{sortBy:'good_total'}),entries);
});

test('teacher screen offers room filtering, independent sort and order selectors in read-only view',()=>{
 const ui=source('web/teacher-score-monitor.js'),api=source('worker/src/teacher-score-monitor.js');
 for(const field of ['scoreMonitorGrade','scoreMonitorRoom','scoreMonitorSort','scoreMonitorSortOrder',
  'good_total','behavior_deducted','behavior_remaining','state.roomId=0',
  "sortBy:'roster'","state.sortOrder=event.target.value","scorePopup.open"])
  assert.ok(ui.includes(field),field);
 assert.match(ui,/state\.roomId=Number\(event\.target\.value\);render\(\)/);
 assert.match(ui,/availableScoreMonitorRooms\(state\.items,state\.grade\)/);
 assert.match(ui,/readOnly:true/);
 assert.match(api,/c\.id AS classroom_id/);
 assert.doesNotMatch(ui,/\/api\/affairs\/behavior\/adjust\/bulk|data-score-delete/);
});
