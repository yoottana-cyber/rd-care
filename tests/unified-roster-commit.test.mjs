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
test('one bad backend write skips its row but preserves successful update and create',async()=>{
 const {DB,committed}=fakeRosterDB({failStudentNo:'STU003'});
 const rows=[data('STU001',2,'ชื่อใหม่'),data('STU002',3,'ชื่อสอง'),data('STU003',4,'ชื่อสาม')];
 const answer=await unifiedRosterEndpoint(req(rows),{DB},{id:7,role:'admin'},'/api/admin/unified-import/commit');
 const result=await answer.json();
 assert.equal(answer.status,201);
 assert.deepEqual([result.added,result.updated,result.skipped],[1,1,1]);
 assert.deepEqual(result.items.map(x=>x.status),['updated','imported','skipped']);
 assert.equal(committed.length,2);
 assert.match(committed[0][0].sql,/UPDATE students SET full_name/);
 assert.match(committed[0][1].sql,/UPDATE student_enrollments SET roll_no/);
 assert.match(committed[1][0].sql,/INSERT INTO students/);
 assert.match(committed[1][1].sql,/INSERT INTO student_enrollments/);
 assert.equal(JSON.stringify(result).includes('password'),false);
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
