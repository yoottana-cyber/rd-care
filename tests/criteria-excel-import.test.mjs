import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCriteriaExcelRows} from '../web/criteria-excel-import.js';
import {buildCriteriaExampleXlsx} from '../web/template-xlsx.js';
import {unzipXlsx} from '../web/xlsx-reader.js';
import {normalizeCriteriaRows,criteriaImportRoutes} from '../worker/src/criteria-excel-import.js';
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const user={role:'teacher',student_affairs:1,id:11};
const policyId=90;
const catalog=[
 {id:4,name:'แต่งกายไม่เรียบร้อย',category:'minor',points:-5,active:1,automatic:0},
 {id:5,name:'ช่วยงานโรงเรียน',category:'good',points:5,active:1,automatic:0},
 {id:policyId,name:'หนีเรียน',category:'moderate',points:-10,active:1,automatic:1}
];
const import_id='6579246f-9e63-432e-a448-a617d3fab177';
const row=(p={})=>({row_no:2,rule_id:null,category:'minor',name:'ไม่ส่งงานตามกำหนด',points:-3,active:1,...p});
function env({rules=catalog,prior=[]}={}){
 const calls=[],batches=[];
 const DB={
  prepare(sql){
   const ref={sql,args:[]};calls.push(ref);
   const all=async()=>({results:sql.includes('FROM affairs_criteria_import_receipts')?prior:
    sql.includes('FROM affairs_behavior_rules r')?rules:[]});
   return {all,bind(...values){ref.args=values;return {all}}};
  },
  batch:async stmts=>{batches.push(stmts);return stmts.map(()=>({meta:{changes:1}}))}
 };
 return {DB,calls,batches};
}
test('criteria Excel templates have correct first worksheet and Thai instructions, never student_no',async()=>{
 for(const mode of ['good','behavior']){
  const bytes=buildCriteriaExampleXlsx(mode,catalog);
  const map=await unzipXlsx(bytes);
  const first=map.get('xl/worksheets/sheet1.xml');
  const text=new TextDecoder().decode(bytes);
  assert.ok(first);
  for(const key of ['rule_id','category','name','points','active'])assert.ok(first.includes(key));
  assert.ok(!first.includes('student_no'));
  assert.ok(text.includes('Existing rules'));
  assert.ok(text.includes('คะแนนนักเรียน'));
  assert.ok(text.includes('เกณฑ์หนีเรียน')); // documented protected automatic rule
  if(mode==='good')assert.ok(text.includes('ช่วยงานโรงเรียน'));
  else assert.ok(text.includes('แต่งกายไม่เรียบร้อย'));
 }
});
test('Excel rules parse categories, positive and negative points and reject duplicates',()=>{
 const records=[['rule_id','category','name','points','active'],['','minor','เข้าแถวไม่ตรงเวลา',-5,1]];
 assert.deepEqual(parseCriteriaExcelRows(records,'behavior')[0],{
  row_no:2,rule_id:null,category:'minor',name:'เข้าแถวไม่ตรงเวลา',points:-5,active:1,error:''
 });
 records.push(['','minor','เข้าแถวไม่ตรงเวลา',-5,1]);
 assert.match(parseCriteriaExcelRows(records,'behavior')[1].error,/ซ้ำ/);
 assert.match(parseCriteriaExcelRows(records,'good')[0].error,/หมวด/);
 assert.throws(()=>parseCriteriaExcelRows([['student_no','rule_id','reason']], 'good'),/หัวตาราง/);
 assert.deepEqual(normalizeCriteriaRows({mode:'good',rows:[row({category:'good',points:5})]})[0].points,5);
});
test('only Student Affairs teachers may preview or commit school criteria',async()=>{
 await assert.rejects(criteriaImportRoutes(env(),{role:'teacher',student_affairs:0,id:11},
  '/api/affairs/behavior/rules/import/preview',{mode:'behavior',rows:[row()]}),{code:403});
});
test('criteria preview reports creation vs updates by ID or category/name',async()=>{
 const x=env();
 const response=await criteriaImportRoutes(x,user,'/api/affairs/behavior/rules/import/preview',
  {mode:'behavior',rows:[row({name:'แต่งกายไม่เรียบร้อย',points:-4}),row({row_no:3})]});
 const result=(await response.json()).items;
 assert.equal(result[0].status,'update');
 assert.equal(result[0].target_rule_id,4);
 assert.equal(result[1].status,'create');
 assert.equal(result[1].target_rule_id,null);
 const direct=await criteriaImportRoutes(env(),user,'/api/affairs/behavior/rules/import/preview',
  {mode:'behavior',rows:[row({rule_id:4,name:'ระเบียบใหม่'})]});
 assert.equal((await direct.json()).items[0].status,'update');
});
test('Excel import cannot change protected truancy rule or cross from good to behavior',async()=>{
 const res=await criteriaImportRoutes(env(),user,'/api/affairs/behavior/rules/import/preview',
  {mode:'behavior',rows:[row({rule_id:90,name:'หนีเรียน'})]});
 assert.match((await res.json()).items[0].error,/คุ้มครอง|อัตโนมัติ/);
 const cross=await criteriaImportRoutes(env(),user,'/api/affairs/behavior/rules/import/preview',
  {mode:'behavior',rows:[row({rule_id:5})]});
 assert.match((await cross.json()).items[0].error,/ข้ามหมวด/);
});
test('criteria commit writes new and updated rules atomically and audits receipts',async()=>{
 const x=env();
 const b={mode:'behavior',import_id,rows:[row(),row({row_no:3,rule_id:4,name:'แก้ชื่อเกณฑ์เดิม'})]};
 const response=await criteriaImportRoutes(x,user,'/api/affairs/behavior/rules/import/commit',b);
 assert.deepEqual(await response.json(),{ok:true,inserted:1,updated:1,skipped:0,count:2});
 assert.equal(x.batches.length,1);
 assert.equal(x.batches[0].length,6);
 const created=x.calls.find(x=>x.sql.includes('INSERT INTO affairs_behavior_rules'));
 assert.deepEqual(created.args,['ไม่ส่งงานตามกำหนด','minor',-3,1,11]);
 const receipt=x.calls.find(x=>x.sql.includes('INSERT INTO affairs_criteria_import_receipts'));
 assert.match(receipt.sql,/last_insert_rowid\(\)/);
 assert.match(x.calls.find(x=>x.sql.includes('INSERT INTO audit_logs')).sql,/affairs_criteria_import_receipts/);
});
test('already imported rows are skipped on timeout replay even when catalog changed',async()=>{
 const previous={import_id,row_no:2,actor_id:11,mode:'behavior',input_rule_id:null,
  rule_id:201,category:'minor',name:'ไม่ส่งงานตามกำหนด',points:-3,active:1};
 const x=env({prior:[previous],rules:[...catalog,{id:201,name:previous.name,
  category:'minor',points:-3,active:1,automatic:0}]});
 const response=await criteriaImportRoutes(x,user,'/api/affairs/behavior/rules/import/commit',
  {mode:'behavior',import_id,rows:[row()]});
 assert.equal((await response.json()).skipped,1);
 assert.equal(x.batches.length,0);
 await assert.rejects(criteriaImportRoutes(env({prior:[previous]}),user,
  '/api/affairs/behavior/rules/import/commit',{
   mode:'behavior',import_id,rows:[row({points:-4})]
  }),{code:409});
});
test('Excel upload is only on school criteria settings, not student score entry',()=>{
 const score=file('web/score-recording.js'),affairs=file('web/student-affairs.js');
 const importer=file('web/criteria-excel-import.js');
 const routes=file('worker/src/student-affairs.js');
 const shell=file('web/sw.js');
 assert.doesNotMatch(score,/createScoreExcelImport|excel\.markup/);
 assert.match(affairs,/กำหนดเกณฑ์คะแนนโรงเรียน/);
 assert.match(affairs,/affairsCriteriaExcelArea/);
 assert.match(importer,/id="affairsCriteriaDownload"/);
 assert.match(importer,/id="affairsCriteriaFile"/);
 assert.match(importer,/\/api\/affairs\/behavior\/rules\/import\/preview/);
 assert.match(routes,/criteriaImportRoutes/);
 assert.doesNotMatch(routes,/scoreImportRoutes/);
 assert.match(shell,/criteria-excel-import\.js/);
 assert.doesNotMatch(shell,/score-excel-import\.js/);
 assert.match(file('worker/migrations/0039_affairs_criteria_import.sql'),/PRIMARY KEY\(import_id,row_no\)/);
});
