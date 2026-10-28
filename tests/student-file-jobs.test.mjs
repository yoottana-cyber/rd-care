import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {studentFileJobRoutes} from '../worker/src/student-file-jobs.js';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('only admin may create or read staged file import jobs',async()=>{
 const DB={prepare(){throw Error('database should not be accessed')}};
 await assert.rejects(()=>studentFileJobRoutes(
  new Request('https://example.test/api/admin/student-file-jobs',{method:'POST',body:'{"total":1750}'}),
  {DB},{id:1,role:'teacher'},'/api/admin/student-file-jobs'),{code:403});
});
test('reject oversized job before writing to D1',async()=>{
 let changed=false;
 const DB={prepare(){changed=true;throw Error('no DB writes expected')}};
 await assert.rejects(()=>studentFileJobRoutes(
  new Request('https://example.test/api/admin/student-file-jobs',{method:'POST',body:'{"total":11000}'}),
  {DB},{id:1,role:'admin'},'/api/admin/student-file-jobs'),{code:400});
 assert.equal(changed,false);
});
test('file staging excludes credentials and uses 20-row idempotent chunks',()=>{
 const server=source('worker/src/student-file-jobs.js');
 assert.match(server,/INSERT OR IGNORE INTO student_file_import_rows/);
 assert.match(server,/rows.length>20/);
 assert.match(server,/Never store|Drop all supplied usernames\/passwords/);
 assert.match(server,/ORDER BY source_row LIMIT 4/);
 assert.match(server,/student_file_import_jobs SET lock_until=NULL/);
 assert.match(server,/processStudentFileJob/);
 assert.match(server,/cleanupStudentFileJobs/);
 assert.doesNotMatch(server,/passwordHash|portal_accounts|portal_sessions/);
});
test('one file upload from browser supports 4 and 6 columns, durable resume and per-record progress',()=>{
 const ui=source('web/student-file-jobs.js');
 assert.match(ui,/xlsx\$/);
 assert.match(ui,/csv\$/);
 assert.match(ui,/header==='classroom,roll_no,student_no,full_name'/);
 assert.match(ui,/\['classroom','roll_no','student_no','full_name','username','password'\]/);
 assert.match(ui,/rows.slice\(i,i\+20\)/);
 assert.match(ui,/\/student-file-jobs/);
 assert.match(ui,/\/finish/);
 assert.match(ui,/\/run/);
 assert.match(ui,/ทำงานต่อจากที่ค้าง/);
 assert.match(ui,/source_row/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage/);
});
test('student file import new primary UI coexists with legacy account importer',()=>{
 const ui=source('web/unified-import.js');
 const worker=source('worker/src/worker.js');
 assert.match(ui,/studentFileJobsHolder/);
 assert.match(ui,/createStudentFileJobUi/);
 assert.match(worker,/studentFileJobRoutes/);
 assert.match(worker,/cleanupStudentFileJobs/);
 const migration=source('worker/migrations/0031_student_file_import_jobs.sql');
 assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM students|UPDATE students/);
});
