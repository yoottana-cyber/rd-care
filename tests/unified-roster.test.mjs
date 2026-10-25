import test from 'node:test';
import assert from 'node:assert/strict';
import {planUnifiedRoster,unifiedRosterEndpoint} from '../worker/src/unified-roster.js';
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
