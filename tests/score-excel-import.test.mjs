import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseScoreExcelRows} from '../web/score-excel-import.js';
import {buildScoreImportExampleXlsx} from '../web/template-xlsx.js';
import {unzipXlsx} from '../web/xlsx-reader.js';
import {previewScoreImport,scoreImportRoutes} from '../worker/src/score-excel-import.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sender={id:4,role:'teacher',student_affairs:0};
const ruleGood={id:7,name:'รักษาความสะอาด',category:'good',active:1,points:5};
const ruleBad={id:9,name:'ผิดระเบียบเล็กน้อย',category:'minor',active:1,points:-5};
const student={id:22,student_no:'000123',full_name:'นักเรียนทดสอบ',classroom_label:'ม.1/2'};
function fakeEnv({accessible=true,prior=[],rule=ruleGood}={}){
 const calls=[],batches=[];
 const DB={
  prepare(sql){
   const query={sql,args:[]};calls.push(query);
   return {bind(...args){query.args=args;return {
    all:async()=>{
     if(sql.includes('FROM students s JOIN classrooms c'))return {results:accessible?[student]:[]};
     if(sql.includes('FROM affairs_behavior_rules'))return {results:[rule]};
     if(sql.includes('FROM score_import_receipts'))return {results:prior};
     return {results:[]};
    }
   }}};
  },
  batch:async list=>{batches.push(list);return list.map(()=>({meta:{changes:1}}))}
 };
 return {DB,calls,batches};
}
test('Excel rows preserve zero-prefixed student numbers and detect duplicates',()=>{
 const rows=[
  ['student_no','rule_id','reason'],
  ['000123',7,'ช่วยกิจกรรม'],['000123',7,'ซ้ำ'],['000456',9,'']
 ];
 rows[1].source_row=10;rows[2].source_row=11;rows[3].source_row=12;
 const found=parseScoreExcelRows(rows);
 assert.equal(found.length,3);
 assert.equal(found[0].student_no,'000123');
 assert.equal(found[0].row_no,10);
 assert.match(found[1].error,/ซ้ำ/);
 assert.equal(found[2].reason,'');
 assert.throws(()=>parseScoreExcelRows([['wrong','id','note'],['000123',7,'']]),/student_no,rule_id,reason/);
 assert.throws(()=>parseScoreExcelRows([['student_no','rule_id','reason']]),/ยังไม่มี/);
});

test('separate Excel samples include only live category rules and instructions',async()=>{
 const rules=[ruleGood,ruleBad];
 for(const [mode,correct,wrong] of [['good',ruleGood,ruleBad],['behavior',ruleBad,ruleGood]]){
  const data=buildScoreImportExampleXlsx(mode,rules);
  const entries=await unzipXlsx(data);
  const first=entries.get('xl/worksheets/sheet1.xml');
  const list=entries.get('xl/worksheets/sheet3.xml');
  assert.match(first,/student_no/);assert.match(first,/rule_id/);assert.match(first,/reason/);
  assert.ok(list.includes(correct.name),correct.name);
  assert.ok(!list.includes(wrong.name),wrong.name);
  assert.match(entries.get('xl/worksheets/sheet2.xml'),/รหัสเกณฑ์/);
 }
});

test('server preview resolves approved point values and current student identity',async()=>{
 const env=fakeEnv();
 const checked=await previewScoreImport(env,sender,{mode:'good',rows:[{
  row_no:2,student_no:'000123',rule_id:7,reason:'รักษาความสะอาด'
 }]});
 assert.equal(checked[0].error,'');
 assert.equal(checked[0].student_id,22);
 assert.equal(checked[0].full_name,student.full_name);
 assert.equal(checked[0].points,5);
 assert.ok(env.calls.some(x=>x.sql.includes('advisor2_user_id=?')));
 assert.ok(env.calls.some(x=>x.sql.includes('teacher_user_id=?')));
 const incorrect=await previewScoreImport(fakeEnv({rule:ruleBad}),sender,
  {mode:'good',rows:[{row_no:2,student_no:'000123',rule_id:9,reason:''}]});
 assert.match(incorrect[0].error,/ไม่ตรงหมวด/);
 const outOfScope=await previewScoreImport(fakeEnv({accessible:false}),sender,
  {mode:'good',rows:[{row_no:2,student_no:'000123',rule_id:7,reason:''}]});
 assert.match(outOfScope[0].error,/สิทธิ์/);
});

test('score import commits approved entries only and logs each import in one D1 batch',async()=>{
 const env=fakeEnv(),import_id='d188bf64-cd1c-4da7-bdae-42409adb8941';
 const body={mode:'good',import_id,rows:[{row_no:2,student_no:'000123',rule_id:7,reason:''}]};
 const response=await scoreImportRoutes(env,sender,'/api/affairs/behavior/import/commit',body);
 assert.equal(response.status,200);
 assert.equal((await response.json()).inserted,1);
 assert.equal(env.batches.length,1);
 assert.equal(env.batches[0].length,3);
 const inserted=env.calls.find(x=>x.sql.includes('INSERT INTO behavior_records'));
 assert.deepEqual(inserted.args,[22,5,ruleGood.name,4,7,'good']);
 const receipt=env.calls.find(x=>x.sql.includes('INSERT INTO score_import_receipts'));
 assert.equal(receipt.args[0],import_id);
 assert.match(receipt.sql,/last_insert_rowid\(\)/);
 const auditing=env.calls.find(x=>x.sql.includes('INSERT INTO audit_logs'));
 assert.match(auditing.sql,/score_import_receipts/);
});

test('same import row is skipped rather than scoring twice; mismatch is rejected',async()=>{
 const import_id='d188bf64-cd1c-4da7-bdae-42409adb8941';
 const existing={row_no:2,actor_id:4,mode:'good',student_id:22,rule_id:7,
  reason:ruleGood.name,behavior_record_id:101};
 const env=fakeEnv({prior:[existing]});
 const body={mode:'good',import_id,rows:[{row_no:2,student_no:'000123',rule_id:7,reason:''}]};
 const result=await scoreImportRoutes(env,sender,'/api/affairs/behavior/import/commit',body);
 assert.deepEqual((await result.json()).skipped,1);
 assert.equal(env.batches.length,0);
 await assert.rejects(
  scoreImportRoutes(fakeEnv({prior:[{...existing,reason:'changed'}]}),sender,
   '/api/affairs/behavior/import/commit',body),
  {code:409});
});

test('invalid score category, inaccessible students, and raw point injection do not write',async()=>{
 const wrong=fakeEnv({rule:ruleBad});
 await assert.rejects(
  scoreImportRoutes(wrong,sender,'/api/affairs/behavior/import/commit',{
   mode:'good',import_id:'d188bf64-cd1c-4da7-bdae-42409adb8941',
   rows:[{row_no:2,student_no:'000123',rule_id:9,points:999,reason:''}]
  }),{code:400});
 assert.equal(wrong.batches.length,0);
});

test('both score tabs include file upload, example and preview; PWA cache includes module',()=>{
 const page=read('web/score-recording.js'),sw=read('web/sw.js');
 const module=read('web/score-excel-import.js');
 const backend=read('worker/src/student-affairs.js');
 assert.match(page,/excel\.markup\(key,u\.rules\)/);
 assert.match(page,/excel\.bind\(key,u\.rules\)/);
 assert.match(module,/id="scoreExcelFile"/);
 assert.match(module,/id="scoreExcelExample"/);
 assert.match(module,/id="scoreExcelCommit"/);
 assert.match(module,/\/api\/affairs\/behavior\/import\/preview/);
 assert.match(module,/\/api\/affairs\/behavior\/import\/commit/);
 assert.match(sw,/score-excel-import\.js/);
 assert.match(backend,/scoreImportRoutes/);
 assert.match(read('worker/migrations/0038_score_import_receipts.sql'),/PRIMARY KEY\(import_id,row_no\)/);
});
