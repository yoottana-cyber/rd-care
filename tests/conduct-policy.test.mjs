import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {warningAllowance,affairsRecorder,ensureRecorder,incidentInsert,commitBehaviorIncidents,behaviorRequestId} from '../worker/src/conduct-policy.js';
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
 const requestId='e4f4bace-96a5-4b4b-9c6a-4fb45c0f7c43';
 incidentInsert(db,11,{id:8},'คำเตือน',3,requestId);
 assert.match(entry.sql,/INSERT OR IGNORE INTO behavior_incidents/);
 assert.match(entry.sql,/history\.n<2/);
 assert.match(entry.sql,/history\.n<1/);
 assert.match(entry.sql,/r\.points/);
 assert.deepEqual(entry.args,[11,'คำเตือน',3,requestId,null,null,null,null,11,8,8]);
 assert.match(entry.sql,/INSERT OR IGNORE INTO behavior_incidents/);
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

test('receipt verification handles D1 triggers that report changes > 1 and unexpected row IDs',async()=>{
 const token='e4f4bace-96a5-4b4b-9c6a-4fb45c0f7c43';
 const seen=[];
 const db={
  prepare(sql){const entry={sql,args:[]};seen.push(entry);
   return {bind(...args){entry.args=args;return entry}}},
  async batch(statements){
   return statements.map((item,index)=>index===statements.length-1?{
    results:[
     {id:12,student_id:5,affairs_rule_id:7,reason:'ทดสอบ',affairs_category:'minor',
      points_applied:0,warning_no:2,behavior_record_id:null},
     {id:13,student_id:6,affairs_rule_id:7,reason:'ทดสอบ',affairs_category:'minor',
      points_applied:-10,warning_no:0,behavior_record_id:777}
    ]
   }:{meta:{changes:4,last_row_id:9999},success:true});
  }
 };
 const records=await commitBehaviorIncidents(db,[5,6],{id:7},'ทดสอบ',1,token);
 assert.deepEqual(records.map(r=>r.id),[12,13]);
 assert.deepEqual(records.map(r=>r.points_applied),[0,-10]);
 assert.equal(seen.length,3);
 assert.match(seen.find(x=>x.sql.startsWith('SELECT id,student_id')).sql,/WHERE request_id=\? AND student_id IN/);
 assert.deepEqual(seen.find(x=>x.sql.startsWith('SELECT id,student_id')).args,[token,5,6]);
});
test('no success is reported when receipt rows are missing or wrong despite successful writes',async()=>{
 const token='e4f4bace-96a5-4b4b-9c6a-4fb45c0f7c43';
 const db={prepare(){return {bind(){return {}}}},
  batch:async()=>[{meta:{changes:3}},{results:[]}]};
 await assert.rejects(commitBehaviorIncidents(db,[5],{id:7},'ทดสอบ',1,token),
  {code:409});
 assert.equal(behaviorRequestId(token),token);
 assert.throws(()=>behaviorRequestId('bad-token'),{code:400});
});
