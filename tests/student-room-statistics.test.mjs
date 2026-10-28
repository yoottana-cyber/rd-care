import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeRooms,filterRooms,createStudentStatistics} from '../web/student-statistics.js';
import {studentStatisticsEndpoint} from '../worker/src/student-statistics.js';
import worker from '../worker/src/worker.js';

const rows=[
 {id:1,grade:1,room:1,label:'ม.1/1',student_count:39,inactive_count:1},
 {id:2,grade:1,room:2,label:'ม.1/2',student_count:0,inactive_count:0},
 {id:3,grade:2,room:1,label:'ม.2/1',student_count:0,inactive_count:2},
 {id:4,grade:2,room:2,label:'ม.2/2',student_count:35,inactive_count:0}
];
test('statistics count only active students and retain empty classrooms',()=>{
 const s=summarizeRooms(rows);
 assert.deepEqual([s.students,s.rooms,s.empty,s.filled],[74,4,2,2]);
 assert.deepEqual([s.grades[0].rooms,s.grades[0].students,s.grades[0].empty],[2,39,1]);
 assert.deepEqual([s.grades[1].rooms,s.grades[1].students,s.grades[1].empty],[2,35,1]);
 assert.equal(s.grades.length,6);
});
test('empty classrooms are default and grade, status, search filters work together',()=>{
 assert.deepEqual(filterRooms(rows).map(x=>x.label),['ม.1/2','ม.2/1']);
 assert.deepEqual(filterRooms(rows,{grade:'2',status:'all'}).map(x=>x.label),['ม.2/1','ม.2/2']);
 assert.deepEqual(filterRooms(rows,{grade:'2',status:'empty',search:'ม.2/1'}).map(x=>x.id),[3]);
 assert.deepEqual(filterRooms(rows,{status:'filled'}).map(x=>x.id),[1,4]);
});
test('aggregated endpoint left joins classrooms and filters archived students',async()=>{
 let sql='';
 const response=await studentStatisticsEndpoint({DB:{prepare(q){
  sql=q;return {async all(){return {results:rows}}};
 }}});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await response.json()).items.length,4);
 assert.match(sql,/LEFT JOIN students s/);
 assert.match(sql,/s\.deleted_at IS NULL/);
 assert.match(sql,/s\.active=1/);
 assert.match(sql,/GROUP BY c\.id/);
 assert.match(sql,/ORDER BY c\.grade,c\.room/);
});
const bearer={Authorization:'Bearer '+'a'.repeat(64)};
function context(role){
 const user={id:1,username:'demo',display_name:'Demo',role,active:1};
 return {DB:{prepare(sql){
  if(sql.includes('FROM sessions s'))return {bind(){return {async first(){return user}}}};
  if(sql.includes('FROM classrooms c')&&sql.includes('LEFT JOIN students s'))return {async all(){return {results:rows}}};
  throw Error('unexpected SQL '+sql);
 }}};
}
test('administrator-only API rejects teachers and anonymous requests',async()=>{
 const url='https://test.local/api/admin/student-statistics';
 assert.equal((await worker.fetch(new Request(url),context('admin'))).status,401);
 assert.equal((await worker.fetch(new Request(url,{headers:bearer}),context('teacher'))).status,403);
 const response=await worker.fetch(new Request(url,{headers:bearer}),context('admin'));
 assert.equal(response.status,200);
 assert.equal((await response.json()).items.length,4);
});
test('admin navigation and PWA expose live room statistics',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const app=read('web/app.js'),nav=read('web/navigation-ui.js'),
  sw=read('web/sw.js'),html=read('web/index.html');
 assert.match(app,/studentStatistics\.load\(\)/);
 assert.match(app,/if\(tab==='studentStatistics'\)/);
 assert.match(nav,/'studentStatistics'/);
 assert.match(app,/adminStudentState\.roomId=id/);
 assert.match(sw,/student-statistics\.js/);
 assert.match(sw,/student-statistics\.css/);
 assert.match(html,/student-statistics\.css/);
 assert.equal(typeof createStudentStatistics,'function');
});
