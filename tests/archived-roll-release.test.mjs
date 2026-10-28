import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseUnusedArchivedStudent} from '../worker/src/archived-roll-release.js';
import {readFileSync} from 'node:fs';

const admin={id:12,role:'admin'};
const req=(id,confirm='archived-student-'+id)=>new Request('https://rd-care.test/api/admin/archived-students/'+id+'/release-roll',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm})
});
const schema=[
 {name:'students',sql:'CREATE TABLE students (id INTEGER PRIMARY KEY)'},
 {name:'student_enrollments',sql:'CREATE TABLE student_enrollments (student_id INTEGER REFERENCES students(id))'},
 {name:'attendance_daily',sql:'CREATE TABLE attendance_daily (student_id INTEGER REFERENCES students(id))'},
 {name:'student_transfer_plans',sql:'CREATE TABLE student_transfer_plans (student_id INTEGER REFERENCES students(id) ON DELETE CASCADE)'},
 {name:'school_term_roster',sql:'CREATE TABLE school_term_roster (student_id INTEGER REFERENCES students(id))'}
];
const archived=id=>({id,student_no:'archived-student-'+id,full_name:'ข้อมูลนักเรียนที่ถอนออก #'+id,
 active:0,deleted_at:'2026-10-28',classroom_id:1,roll_no:1});
function mock({record=archived(1),enrollments=[{id:1,start_date:'1900-01-01',end_date:null}],references={},tables=schema,failDelete=false}={}){
 const queries=[],writes=[];
 const DB={
  prepare(sql){return {
   bind(...values){
    queries.push({sql,values});
    return {
     async first(){if(sql.includes('FROM students WHERE id=?'))return record;return null},
     async all(){if(sql.includes('FROM student_enrollments'))return {results:enrollments};return {results:[]}},
     sql,values
    };
   },
   async all(){if(sql.includes('sqlite_master'))return {results:tables};return {results:[]}}
  }},
  async batch(statements){
   if(statements.every(x=>x.sql.startsWith('SELECT'))){
    return statements.map(x=>{
     const match=/FROM "([A-Za-z_]+)"/.exec(x.sql);
     return {results:references[match?.[1]]?[{linked:1}]:[]};
    });
   }
   if(failDelete)throw Error('FOREIGN KEY constraint failed');
   writes.push(...statements);
   return statements.map(()=>({meta:{changes:1}}));
  }
 };
 return {DB,queries,writes};
}
test('release of archived unused record frees roll only after schema history checks',async()=>{
 const db=mock();
 const response=await releaseUnusedArchivedStudent(req(1),db,admin,1);
 assert.equal(response.status,200);
 assert.equal((await response.json()).roll_no,1);
 assert(db.writes.some(x=>x.sql.includes('DELETE FROM student_enrollments')));
 assert(db.writes.some(x=>x.sql.includes('DELETE FROM students WHERE id=?')));
 assert(db.writes.some(x=>x.values.includes('unused_archived_student_released')));
 assert(db.queries.some(x=>x.sql.includes('FROM "student_transfer_plans"')));
});
test('never purge if student has attendance, transferred record, or saved term',async()=>{
 for(const field of ['attendance_daily','student_transfer_plans','school_term_roster']){
  const db=mock({references:{[field]:true}});
  await assert.rejects(releaseUnusedArchivedStudent(req(1),db,admin,1),{code:409});
  assert.equal(db.writes.length,0);
 }
});
test('never purge an archive with multiple or closed historical enrollments',async()=>{
 for(const enrollments of [
  [{id:1,start_date:'2025-01-01',end_date:'2026-01-01'}],
  [{id:1,start_date:'2025-01-01',end_date:'2026-01-01'},{id:2,start_date:'2026-01-01',end_date:null}]
 ]){
  const db=mock({enrollments});
  await assert.rejects(releaseUnusedArchivedStudent(req(1),db,admin,1),{code:409});
  assert.equal(db.writes.length,0);
 }
});
test('admin confirmation and archived identity check prevent deletion of active students',async()=>{
 const db=mock();
 await assert.rejects(releaseUnusedArchivedStudent(req(1,'wrong'),db,admin,1),{code:400});
 await assert.rejects(releaseUnusedArchivedStudent(req(1),db,{id:8,role:'teacher'},1),{code:403});
 const live=mock({record:{...archived(1),deleted_at:null,active:1,student_no:'20046'}});
 await assert.rejects(releaseUnusedArchivedStudent(req(1),live,admin,1),{code:409});
 assert.equal(db.writes.length,0);
 assert.equal(live.writes.length,0);
});
test('unknown foreign-key relation or foreign key error never purges enrollment',async()=>{
 const unknown=mock({tables:[...schema,{name:'pupil_info',sql:'CREATE TABLE pupil_info(pupil_id INTEGER REFERENCES students(id))'}]});
 await assert.rejects(releaseUnusedArchivedStudent(req(1),unknown,admin,1),{code:503});
 const blocked=mock({failDelete:true});
 await assert.rejects(releaseUnusedArchivedStudent(req(1),blocked,admin,1),{code:409});
 assert.equal(blocked.writes.length,0);
});
test('archived student release is retired from routes and import UI, preserving identities',()=>{
 const ui=readFileSync(new URL('../web/unified-import.js',import.meta.url),'utf8');
 const routes=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/data-release-archived/);
 assert.doesNotMatch(routes,/releaseUnusedArchivedStudent\(/);
 assert.match(ui,/onOpenConflict/);
 assert.match(ui,/ต้องอัปเกรดสำเนาฐานข้อมูล/);
});
