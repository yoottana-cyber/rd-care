'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {validateManifest,loadManifest,checkFiles,topology,compareSchema,FORMAT}
 =require('../migration/manifest-planner.cjs');
const {run:plan}=require('../scripts/check-d1-migration-plan.cjs');
const H=createHash('sha256').update('').digest('hex');
function example(){
 const tables=Array.from({length:63},(_,i)=>({
  name:'labtable'+i,file:'labtable'+i+'.jsonl',
  columns:['id','name'],rows:0,sha256:H
 }));
 return {format:FORMAT,source:'trusted-local-wrangler-d1-sql',
  table_count:63,total_rows:0,tables};
}
test('strict manifest schema requires 63 unique tables, hash, rows, safe file names',()=>{
 assert.equal(validateManifest(example()).table_count,63);
 for(const changed of [
  x=>x.tables.pop(),
  x=>{x.tables[1].name=x.tables[0].name},
  x=>{x.tables[0].file='../../private.jsonl'},
  x=>{x.tables[0].sha256='bad'},
  x=>{x.tables[0].columns=['id','id']},
  x=>{x.total_rows=1},
  x=>{x.format='untrusted-dump'}
 ]){
  const x=example();changed(x);
  assert.throws(()=>validateManifest(x),/migration_/);
 }
});
test('SHA256 and line counts verify local JSONL; no source row data is returned',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rd_manifest_test_'));
 try{
  const src=example();
  for(const t of src.tables)fs.writeFileSync(path.join(folder,t.file),'');
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(src));
  const loaded=loadManifest(path.join(folder,'manifest.json'));
  const good=await checkFiles(loaded.base,loaded.manifest);
  assert.deepEqual(good,{verified_files:63,verified_rows:0});
  fs.writeFileSync(path.join(folder,'labtable0.jsonl'),'{"id":1}\n');
  await assert.rejects(()=>checkFiles(folder,src),/migration_jsonl_digest_or_rows_mismatch/);
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
test('topological order respects dependent child tables',()=>{
 const graph=topology(['children','students','classrooms'],[
  {TABLE_NAME:'children',REFERENCED_TABLE_NAME:'students'},
  {TABLE_NAME:'students',REFERENCED_TABLE_NAME:'classrooms'}
 ]);
 assert.deepEqual(graph.stages,[['classrooms'],['students'],['children']]);
 assert.deepEqual(graph.cyclic_or_blocked_tables,[]);
});
test('FK dependency loops cannot be reported as ready',()=>{
 const graph=topology(['a','b'],[
  {TABLE_NAME:'a',REFERENCED_TABLE_NAME:'b'},
  {TABLE_NAME:'b',REFERENCED_TABLE_NAME:'a'}
 ]);
 assert.equal(graph.stages.length,0);
 assert.deepEqual(graph.cyclic_or_blocked_tables,['a','b']);
});
test('source columns must exist in 63-table target before a plan is prepared',()=>{
 const manifest=example();
 const target=manifest.tables.map(t=>({TABLE_NAME:t.name,ENGINE:'InnoDB'}));
 const columns=manifest.tables.flatMap(t=>t.columns.map(col=>({TABLE_NAME:t.name,COLUMN_NAME:col})));
 const fk=Array.from({length:119},(_,i)=>({
  TABLE_NAME:'labtable'+((i+1)%63),REFERENCED_TABLE_NAME:'labtable0'
 }));
 const topo=compareSchema(manifest,target,columns,fk,119);
 assert.deepEqual(topo.cyclic_or_blocked_tables,[]);
 assert.throws(()=>compareSchema(manifest,target,columns.slice(1),fk,119),/migration_target_column_missing/);
 assert.throws(()=>compareSchema(manifest,target,columns,fk,118),/migration_target_fk_count/);
});
test('dry-run with absent private export is NO_GO and opens zero DB connections',async()=>{
 let connected=false;const lines=[];
 const result=await plan({env:{},makePool:()=>{connected=true;throw Error('unsafe')},
  log:x=>lines.push(x),warn:()=>{}});
 assert.equal(result,2);
 assert.equal(connected,false);
 assert.ok(lines.some(x=>x.includes('SOURCE PENDING')));
});
test('import enable flag blocks read-only planner before any DB connection',async()=>{
 let connected=false;const warnings=[];
 const result=await plan({env:{RD_D1_MANIFEST_FILE:'/private/manifest.json',
  RD_DB_NAME:'ratsadaa_connect',RD_MIGRATION_ALLOW_IMPORT:'yes'},
  makePool:()=>{connected=true;throw Error('unsafe')},
  load:()=>({base:'private',manifest:example()}),
  log:()=>{},warn:x=>warnings.push(x)});
 assert.equal(result,1);assert.equal(connected,false);
 assert.match(warnings[0],/migration_import_must_remain_disabled/);
});
