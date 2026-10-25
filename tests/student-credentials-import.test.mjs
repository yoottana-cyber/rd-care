import test from 'node:test';
import assert from 'node:assert/strict';
import {planStudentImport} from '../worker/src/student-import.js';

const row=(i,overrides={})=>({
 roll_no:i,student_no:'DEMO'+String(i).padStart(4,'0'),
 full_name:'นักเรียนทดสอบ '+i,source_row:i+1,
 username:'student'+String(i).padStart(4,'0'),password:'Pass#1234',
 ...overrides
});

test('five-column import previews usernames but NEVER contains raw passwords',()=>{
 const items=[row(1),row(2)];
 const result=planStudentImport(items,1,[],[]);
 assert.equal(result.ready,true);
 assert.equal(result.accounts,2);
 assert.deepEqual(result.items.map(x=>x.login_username),['student0001','student0002']);
 assert.equal(JSON.stringify(result).includes('Pass#1234'),false);
 assert.equal(JSON.stringify(result).includes('password'),false);
});
test('roster-only three columns remains supported up to 60',()=>{
 const result=planStudentImport(
  Array.from({length:60},(_,i)=>({roll_no:i+1,student_no:'DEMO'+i,full_name:'Dummy '+i})),1,[],[]
 );
 assert.equal(result.ready,true);
 assert.equal(result.accounts,0);
});
test('four character initial password is accepted, three characters rejected',()=>{
 assert.equal(planStudentImport([row(1,{password:'1234'})],1,[],[]).ready,true);
 const bad=planStudentImport([row(1,{password:'123'})],1,[],[]);
 assert.equal(bad.ready,false);
 assert.match(bad.items[0].message,/อย่างน้อย 4 ตัว/);
});
test('duplicate custom username in a file or existing accounts is blocked',()=>{
 const plan=planStudentImport([row(1),row(2,{username:'student0001'})],1,[],[]);
 assert.equal(plan.ready,false);
 assert.match(plan.items[1].message,/Username ซ้ำ/);
 const existing=planStudentImport([row(1)],1,[],[{username:'STUDENT0001'}]);
 assert.equal(existing.ready,false);
 assert.match(existing.items[0].message,/Username มีบัญชี/);
});
test('10 credentials per request keep hashing bounded',()=>{
 const eleven=Array.from({length:11},(_,i)=>row(i+1));
 assert.throws(()=>planStudentImport(eleven,1,[],[]),/10 คน/);
});
test('invalid usernames and missing passwords never pass preview',()=>{
 const result=planStudentImport([
  row(1,{username:'ไทย username'}),
  row(2,{password:''})
 ],1,[],[]);
 assert.equal(result.ready,false);
 assert.equal(result.errors,2);
 assert.equal(result.items[0].source_row,2);
});
