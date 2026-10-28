import test from 'node:test';
import assert from 'node:assert/strict';
import {unifiedRosterEndpoint} from '../worker/src/unified-roster.js';

const data=(student_no,roll_no,full_name,password='')=>({
 classroom:'ม.1/1',roll_no,student_no,full_name,username:'',password
});
function fakeRosterDB({failStudentNo=null}={}){
 const existing=[{id:51,student_no:'STU001',classroom_id:1,roll_no:1,deleted_at:null}];
 const accounts=[{id:90,username:'stu001',role:'student',student_id:51}];
 const committed=[];
 const mk=(sql,values=[])=>({
  sql,values,bind(...v){return mk(sql,v)},
  async all(){
   if(sql.includes('FROM classrooms'))return {results:[{id:1,label:'ม.1/1'}]};
   if(sql.includes('FROM portal_accounts'))return {results:accounts};
   if(sql.includes('FROM students')){
    if(sql.includes('lower(student_no) IN'))return {results:existing.filter(s=>values.includes(s.student_no.toLowerCase()))};
    if(sql.includes('classroom_id=?'))return {results:existing.filter(s=>s.classroom_id===values[0]&&values.slice(1).includes(s.roll_no))};
   }
   return {results:[]};
  },
  async first(){
   if(sql.includes('FROM portal_accounts')&&sql.includes('student_id=?'))return accounts.find(a=>a.student_id===values[0])||null;
   return null;
  }
 });
 const DB={
  prepare:sql=>mk(sql),
  async batch(stmts){
   if(stmts.every(stmt=>stmt.sql.startsWith('SELECT')))return Promise.all(stmts.map(q=>q.all()));
   if(failStudentNo&&stmts.some(q=>q.sql.includes('INSERT INTO students')&&q.values.includes(failStudentNo)))
    throw Error('UNIQUE constraint failed: students.student_no');
   committed.push(stmts.map(q=>({sql:q.sql,values:q.values})));
   return stmts.map(()=>({meta:{changes:1}}));
  }
 };
 return {DB,committed};
}
const req=rows=>new Request('https://rd-care.example/api/admin/unified-import/commit',{
 method:'POST',body:JSON.stringify({students:rows})
});
test('a failed student write does not cancel previous successes across isolated requests',async()=>{
 const {DB,committed}=fakeRosterDB({failStudentNo:'STU003'});
 const rows=[data('STU001',2,'ชื่อใหม่'),data('STU002',3,'ชื่อสอง'),data('STU003',4,'ชื่อสาม')];
 const responses=[];
 for(const row of rows){
  const answer=await unifiedRosterEndpoint(req([row]),{DB},{id:7,role:'admin'},'/api/admin/unified-import/commit');
  responses.push({httpStatus:answer.status,...await answer.json()});
 }
 assert.deepEqual(responses.map(x=>x.added),[0,1,0]);
 assert.deepEqual(responses.map(x=>x.updated),[1,0,0]);
 assert.deepEqual(responses.map(x=>x.skipped),[0,0,1]);
 assert.deepEqual(responses.map(x=>x.items[0].status),['updated','imported','skipped']);
 assert.equal(committed.length,2);
 assert.match(committed[0][0].sql,/UPDATE students SET full_name/);
 assert.match(committed[0][1].sql,/UPDATE student_enrollments SET roll_no/);
 assert.match(committed[1][0].sql,/INSERT INTO students/);
 assert.match(committed[1][1].sql,/INSERT INTO student_enrollments/);
 assert.equal(JSON.stringify(responses).includes('password'),false);
});
test('moving existing student into another classroom is never performed by imported roster',async()=>{
 const {DB,committed}=fakeRosterDB();
 const row=data('STU001',2,'ชื่อใหม่');row.classroom='ม.2/99';
 const answer=await unifiedRosterEndpoint(req([row]),{DB},{id:1,role:'admin'},'/api/admin/unified-import/commit');
 const result=await answer.json();
 assert.deepEqual([result.added,result.updated,result.skipped],[0,0,1]);
 assert.equal(committed.length,0);
});
test('teacher cannot access or submit school-wide roster import',async()=>{
 const {DB}=fakeRosterDB();
 await assert.rejects(
  unifiedRosterEndpoint(req([data('STU002',2,'ชื่อ')]),{DB},{id:7,role:'teacher'},
   '/api/admin/unified-import/commit'),
  {code:403});
});

test('server caps preview at 25 and commit at 1 so no oversized D1 request is accepted',async()=>{
 const {DB}=fakeRosterDB();
 const many=Array.from({length:26},(_,i)=>data('S'+i,i+1,'Student '+i));
 await assert.rejects(
  unifiedRosterEndpoint(req(many),{DB},{id:1,role:'admin'},'/api/admin/unified-import/preview'),
  {code:400});
 await assert.rejects(
  unifiedRosterEndpoint(req(many.slice(0,2)),{DB},{id:1,role:'admin'},'/api/admin/unified-import/commit'),
  {code:400});
 const answer=await unifiedRosterEndpoint(req(many.slice(0,25)),{DB},{id:1,role:'admin'},
  '/api/admin/unified-import/preview');
 assert.equal(answer.status,200);
 const result=await answer.json();
 assert.equal(result.items.length,25);
});

test('roster-only import keeps existing student account and password untouched',async()=>{
 const {DB,committed}=fakeRosterDB();
 const row=data('STU001',4,'ชื่อแก้ไข','Password123');
 row.username='student-newname';
 const request=new Request('https://rd-care.example/api/admin/unified-import/commit',{
  method:'POST',body:JSON.stringify({account_mode:'roster_only',students:[row]})
 });
 const answer=await unifiedRosterEndpoint(request,{DB},{id:7,role:'admin'},'/api/admin/unified-import/commit');
 const result=await answer.json();
 assert.equal(result.updated,1);
 assert.equal(result.accounts,0);
 assert.equal(committed.length,1);
 assert(committed[0].every(x=>!x.sql.includes('portal_accounts')));
 assert(committed[0].every(x=>!x.sql.includes('portal_sessions')));
});
test('roster-only allows new student creation without account hashing or username changes',async()=>{
 const {DB,committed}=fakeRosterDB();
 const row=data('STU490',5,'ใหม่','Password123');
 row.username='student-490';
 const request=new Request('https://rd-care.example/api/admin/unified-import/commit',{
  method:'POST',body:JSON.stringify({account_mode:'roster_only',students:[row]})
 });
 const answer=await unifiedRosterEndpoint(request,{DB},{id:7,role:'admin'},'/api/admin/unified-import/commit');
 const result=await answer.json();
 assert.equal(result.added,1);
 assert.equal(result.accounts,0);
 assert(committed[0].every(x=>!x.sql.includes('portal_accounts')));
});
test('unrecognized account mode is rejected rather than silently removing accounts',async()=>{
 const {DB}=fakeRosterDB();
 const request=new Request('https://rd-care.example/api/admin/unified-import/preview',{
  method:'POST',body:JSON.stringify({account_mode:'invalid',students:[data('STU490',5,'ใหม่')]})
 });
 await assert.rejects(()=>unifiedRosterEndpoint(request,{DB},{id:7,role:'admin'},'/api/admin/unified-import/preview'),{code:400});
});
