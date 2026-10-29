import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {warningAllowance,affairsRecorder,ensureRecorder,incidentInsert} from '../worker/src/conduct-policy.js';
import {historySql} from '../worker/src/score-history-query.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('school warning policy is by rule: 2 minor warnings, 1 moderate, none severe',()=>{
 assert.equal(warningAllowance('minor'),2);
 assert.equal(warningAllowance('moderate'),1);
 for(const category of ['serious','very_serious','good'])
  assert.equal(warningAllowance(category),0);
});
test('serious misconduct is reserved for student-affairs teachers or administrators',()=>{
 const teachers=[
  {role:'teacher',id:1,student_affairs:0},
  {role:'teacher',id:2,student_affairs:1},
  {role:'staff',id:3,student_affairs:0},
  {role:'admin',id:4}
 ];
 assert.deepEqual(teachers.map(affairsRecorder),[false,true,false,true]);
 for(const ordinary of [teachers[0],teachers[2]]){
  for(const category of ['serious','very_serious'])
   assert.throws(()=>ensureRecorder(ordinary,category),{code:403});
  for(const category of ['minor','moderate','good'])
   assert.doesNotThrow(()=>ensureRecorder(ordinary,category));
 }
 for(const authorized of [teachers[1],teachers[3]]){
  for(const category of ['serious','very_serious'])
   assert.doesNotThrow(()=>ensureRecorder(authorized,category));
 }
});
test('server inserts an incident and never accepts a user-supplied score amount',()=>{
 let entry;
 const db={prepare(sql){
  entry={sql,args:[]};
  return {bind(...args){entry.args=args;return entry}};
 }};
 incidentInsert(db,11,{id:8},'คำเตือน',3);
 assert.match(entry.sql,/INSERT INTO behavior_incidents/);
 assert.match(entry.sql,/history\.n<2/);
 assert.match(entry.sql,/history\.n<1/);
 assert.match(entry.sql,/r\.points/);
 assert.deepEqual(entry.args,[11,'คำเตือน',3,11,8,8]);
});
test('read-only and teacher score history expose warnings but never add to scores',()=>{
 const normal=historySql(true),readonly=historySql(false);
 assert.match(normal,/i\.points_applied=0/);
 assert.match(normal,/i\.deleted_at IS NULL/);
 assert.match(normal,/b\.deleted_at IS NULL/);
 assert.match(normal,/warning_no/);
 assert.match(normal,/AS can_delete/);
 assert.match(readonly,/0 AS can_delete/);
 assert.match(read('web/score-history.js'),/ตักเตือนครั้งที่/);
 assert.match(read('web/score-recording.js'),/getUser\(\)\?\.role==='teacher'/);
 assert.match(read('worker/src/worker.js'),/behavior_incidents WHERE id=\?/);
});
