import test from 'node:test';
import assert from 'node:assert/strict';
import {planUnifiedRoster,unifiedRosterEndpoint,identityKeyedRosterReady} from '../worker/src/unified-roster.js';
import {prepareRows,csvRows} from '../web/unified-import.js';

const rooms=[{id:1,label:'ม.1/1'},{id:2,label:'ม.2/3'},{id:3,label:'ม.3/2'}];
const map=new Map(rooms.map(x=>[x.label,x.id]));
const record=(i,room='ม.1/1')=>({
 classroom:room,roll_no:i,student_no:'S'+String(i).padStart(5,'0'),
 full_name:'นักเรียนตัวอย่าง '+i,username:'student'+String(i).padStart(5,'0'),
 password:'Demo-strong-'+i,source_row:i+1
});
test('unified CSV with mixed rooms and text IDs uses a single 6-column format',()=>{
 const data='classroom,roll_no,student_no,full_name,username,password\nม.1/1,1,000123,Demo A,student-001,Pass#1234\nม.2/3,1,000124,Demo B,student-002,Pass#5678';
 const raw=csvRows(data),planned=prepareRows(raw,rooms);
 assert.equal(planned.length,2);
 assert.equal(planned[0].values.student_no,'000123');
 assert.equal(planned[1].values.classroom,'ม.2/3');
 assert.equal(planned.every(x=>x.status==='ready'),true);
});
test('mixed-room roster accepts identical roll numbers across different rooms',()=>{
 const input=[record(1),record(1,'ม.2/3')];
 input[1].student_no='S00002';input[1].username='student2';
 const result=planUnifiedRoster(input,map);
 assert.equal(result.ready,true);
 assert.equal(result.valid,2);
 assert.equal(JSON.stringify(result).includes('Demo-strong'),false);
 assert.deepEqual(result.items.map(x=>x.room),['ม.1/1','ม.2/3']);
});
test('full file validation detects duplicate students, usernames and room rolls',()=>{
 const items=[record(1),record(2),record(3,'ม.2/3')];
 items[1].student_no=items[0].student_no;
 items[2].username=items[0].username;
 const result=planUnifiedRoster(items,map);
 assert.equal(result.ready,false);
 assert.equal(result.errors,2);
 assert.match(result.items[1].message,/รหัสนักเรียนซ้ำ/);
 assert.match(result.items[2].message,/Username ซ้ำ/);
});
test('unknown room and existing accounts are rejected without disclosing passwords',()=>{
 const items=[record(1,'ม.9/99'),record(2)];
 const result=planUnifiedRoster(items,map,[],[{username:'student00002'}]);
 assert.equal(result.errors,2);
 assert.match(result.items[0].message,/ไม่พบห้องเรียน/);
 assert.match(result.items[1].message,/Username มีบัญชี/);
 assert.equal(JSON.stringify(result).includes('Demo-strong'),false);
});
test('browser import rejects missing six column header',()=>{
 assert.throws(()=>prepareRows(csvRows('roll_no,student_no,full_name\n1,001,Demo'),rooms),/หัวตาราง/);
});
test('server refuses anonymous and teacher batch imports before reading DB',async()=>{
 const req=new Request('https://rd-care.test/api/admin/unified-import/commit',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({students:[record(1)]})
 });
 await assert.rejects(unifiedRosterEndpoint(req,{}, {id:2,role:'teacher'},'/api/admin/unified-import/commit'),e=>e.code===403);
});
test('server requires bounded requests to avoid Worker hash CPU limit',async()=>{
 const req=new Request('https://rd-care.test/api/admin/unified-import/commit',{
  method:'POST',body:JSON.stringify({students:Array.from({length:11},(_,i)=>record(i+1))})
 });
 await assert.rejects(unifiedRosterEndpoint(req,{}, {id:1,role:'admin'},'/api/admin/unified-import/commit'),e=>e.code===400);
});
test('CSV parser handles quotes and comma inside name',()=>{
 const parsed=csvRows('classroom,roll_no,student_no,full_name,username,password\nม.1/1,1,STU001,"Demo, Test",stu001,Pass#1234');
 assert.equal(parsed[1][3],'Demo, Test');
});

test('existing student number updates name and roll in same room without creating a new identity',()=>{
 const current={id:91,student_no:'S00001',classroom_id:1,roll_no:1};
 const target={...record(1),roll_no:8,full_name:'ชื่อใหม่',username:'',password:''};
 const out=planUnifiedRoster([target],map,[current]);
 assert.equal(out.valid,1);
 assert.equal(out.updated,1);
 assert.equal(out.added,0);
 assert.equal(out.items[0].status,'update');
 assert.equal(out.items[0].existing_id,91);
 assert.equal(out.items[0].account_action,'none');
 assert.equal(JSON.stringify(out).includes('Demo-strong'),false);
});
test('moving classroom by spreadsheet is rejected to preserve historical attendance',()=>{
 const target={...record(1,'ม.2/3'),username:'',password:''};
 const out=planUnifiedRoster([target],map,[{id:10,student_no:target.student_no,classroom_id:1,roll_no:1}]);
 assert.equal(out.items[0].status,'error');
 assert.match(out.items[0].message,/ย้ายห้อง/);
});
test('invalid row does not reserve class roll or student number for later valid entry',()=>{
 const invalid={...record(1),full_name:'',source_row:2};
 const valid={...record(1),source_row:3};
 const out=planUnifiedRoster([invalid,valid],map);
 assert.deepEqual(out.items.map(i=>i.status),['error','ready']);
 assert.equal(out.skipped,1);
 assert.equal(out.added,1);
});
test('existing account can keep its password or receive an explicit replacement',()=>{
 const old={id:55,student_no:'S00001',classroom_id:1,roll_no:1};
 const a={id:77,username:'student00001',role:'student',student_id:55};
 let result=planUnifiedRoster([{...record(1),username:'',password:''}],map,[old],[a]);
 assert.equal(result.items[0].status,'update');
 assert.equal(result.items[0].account_action,'none');
 result=planUnifiedRoster([{...record(1),password:'NewPassword123'}],map,[old],[a]);
 assert.equal(result.items[0].account_action,'update');
 assert.equal(result.items[0].status,'update');
});
test('account username belonging to someone else is skipped rather than overwritten',()=>{
 const item=record(1);
 const other={id:90,username:item.username,role:'student',student_id:99};
 const result=planUnifiedRoster([item,record(2)],map,[],[other]);
 assert.deepEqual(result.items.map(x=>x.status),['error','ready']);
 assert.match(result.items[0].message,/บุคคลอื่น/);
});
test('frontend allows empty credentials and marks conflicting rows without stopping valid ones',()=>{
 const raw=csvRows('classroom,roll_no,student_no,full_name,username,password\nม.1/1,1,S001,ชื่อหนึ่ง,,\nม.1/1,1,S002,ชื่อสอง,,\nม.1/1,2,S003,ชื่อสาม,,');
 const planned=prepareRows(raw,rooms);
 assert.deepEqual(planned.map(x=>x.status),['ready','error','ready']);
});

test('conflict preview explains who owns the room roll without exposing passwords',()=>{
 const input={...record(1),student_no:'NEW006',username:'',password:'private'};
 const existing=[{id:91,student_no:'DEMO1001',classroom_id:1,roll_no:1,full_name:'นักเรียนตัวอย่าง ม.1/1',active:1,deleted_at:null}];
 const output=planUnifiedRoster([input],map,existing);
 assert.equal(output.items[0].status,'error');
 assert.match(output.items[0].message,/เลขที่นี้มีนักเรียนอื่น/);
 assert.deepEqual(output.items[0].conflict_student,{
  id:91,classroom_id:1,student_no:'DEMO1001',full_name:'นักเรียนตัวอย่าง ม.1/1',active:true,archived:false
 });
 assert.equal(JSON.stringify(output).includes('private'),false);
 const archived=planUnifiedRoster([input],map,[{...existing[0],deleted_at:'2026-10-28'}]);
 assert.equal(archived.items[0].conflict_student.archived,true);
 assert.match(archived.items[0].message,/เก็บประวัติ/);
});

test('after identity-keyed migration archived student ID remains and does not occupy an active roll',()=>{
 const archived={id:1,student_no:'archived-student-1',classroom_id:1,roll_no:1,full_name:'Archived',active:0,deleted_at:'2026-10-28'};
 const imported={...record(1),student_no:'20046',username:'',password:''};
 assert.equal(planUnifiedRoster([imported],map,[archived]).items[0].status,'error');
 const ready=planUnifiedRoster([imported],map,[archived],[],{allowArchivedReuse:true});
 assert.equal(ready.items[0].status,'ready');
 assert.equal(ready.items[0].conflict_student,null);
});

test('roster capability check uses one metadata query and rejects legacy constraints',async()=>{
 const legacy="CREATE TABLE students(id INTEGER PRIMARY KEY, student_no TEXT UNIQUE, classroom_id INTEGER, roll_no INTEGER, UNIQUE(classroom_id,roll_no))";
 const current="CREATE TABLE students(id INTEGER PRIMARY KEY, student_no TEXT UNIQUE, classroom_id INTEGER, roll_no INTEGER)";
 const check=async (tableSql,indexPresent=true)=>{
  const queries=[];
  const db={prepare(sql){
   queries.push(sql);
   return {async first(){return {table_sql:tableSql,has_live_roll_index:indexPresent?1:0}}};
  }};
  const ready=await identityKeyedRosterReady(db);
  assert.equal(queries.length,1,'one D1 query per request');
  assert.match(queries[0],/sqlite_master/);
  return ready;
 };
 assert.equal(await check(legacy),false);
 assert.equal(await check(current),true);
 assert.equal(await check(current,false),false);
 assert.equal(await check(''),false);
});
