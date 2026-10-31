'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createModel,writeFixture,safeLocation}=require('../migration/synthetic-fixture.cjs');
const {loadSyntheticManifest,SOURCE}=require('../migration/synthetic-manifest.cjs');
const {checkFiles}=require('../migration/manifest-planner.cjs');
const {readRows}=require('../migration/rollback-rehearsal.cjs');
const {run}=require('../scripts/make-d1-synthetic-fixture.cjs');

function schema(){
 const tables=[{TABLE_NAME:'users'},...Array.from({length:62},(_,i)=>({TABLE_NAME:'test_table'+i}))];
 const metadata=tables.map(t=>({TABLE_NAME:t.TABLE_NAME,COLUMN_NAME:'id',EXTRA:''}));
 for(const c of ['username','display_name','role','password_salt','password_hash','active'])
  metadata.push({TABLE_NAME:'users',COLUMN_NAME:c,EXTRA:''});
 return {tables,metadata};
}
test('63-table fixture contains exactly one disabled fake account; no D1 data',()=>{
 const s=schema(),result=createModel(s.tables,s.metadata,{nonce:'0123456789abcdef'});
 assert.equal(result.length,63);
 assert.equal(result.reduce((n,x)=>n+x.rows,0),1);
 const user=result.find(x=>x.name==='users');
 assert.equal(user.rows,1);
 const data=JSON.parse(user.contents);
 assert.equal(data.username,'rd_fixture_0123456789abcdef');
 assert.equal(data.active,0);
 assert.equal(data.role,'teacher');
 assert.match(data.display_name,/Synthetic/);
 assert.equal(result.filter(x=>x.rows>0).length,1);
});
test('safely writes and verifies private fixture, blocks mislabeled source',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rd_stage12_'));
 try{
  const dir=path.join(temp,'fixture');
  const s=schema();
  const model=createModel(s.tables,s.metadata,{nonce:'abc123abc123abc1'});
  const result=writeFixture(dir,model);
  assert.equal(result.tables,63);
  assert.equal(result.rows,1);
  const {base,manifest}=loadSyntheticManifest(result.manifestPath);
  assert.equal(manifest.source,SOURCE);
  assert.deepEqual(await checkFiles(base,manifest),{verified_files:63,verified_rows:1});
  const fake=manifest.tables.find(t=>t.name==='users');
  const records=[];for await(const r of readRows(base,fake))records.push(r);
  assert.equal(records.length,1);
  assert.equal(records[0][fake.columns.indexOf('active')],0);
  assert.throws(()=>writeFixture(dir,model),/migration_fixture_already_exists/);
  const rewritten=JSON.parse(fs.readFileSync(result.manifestPath,'utf8'));
  rewritten.source='trusted-local-wrangler-d1-sql';
  fs.writeFileSync(result.manifestPath,JSON.stringify(rewritten));
  assert.throws(()=>loadSyntheticManifest(result.manifestPath),
   /migration_only_synthetic_source_allowed/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
test('fixture cannot be placed in public webroot or Git checkout',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd_stage12_guard_'));
 try{
  const publicPath=path.join(dir,'public_html','private');
  fs.mkdirSync(path.dirname(publicPath));
  assert.throws(()=>safeLocation(publicPath),/migration_fixture_inside_webroot/);
  fs.mkdirSync(path.join(dir,'.git'));
  assert.throws(()=>safeLocation(path.join(dir,'private')),
   /migration_fixture_inside_git/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('generator refuses unsafe DB and touches no connector',async()=>{
 let connected=false;
 const result=await run({env:{RD_DB_NAME:'real_school_db'},
  makePool:()=>{connected=true;throw Error('unsafe')},warn:()=>{},log:()=>{}});
 assert.equal(result,1);assert.equal(connected,false);
});
test('generator only reads schema and writes one private manifest; no SQL writes',async()=>{
 const s=schema(),queries=[],logs=[];
 const conn={async execute(sql){queries.push(sql);return [s.metadata]},release(){}};
 const pool={async getConnection(){return conn},async end(){}};
 const out=await run({env:{RD_DB_NAME:'ratsadaa_connect'},
  makePool:()=>pool,inspect:async()=>({tables:s.tables}),
  location:()=>'/private/fake-path',
  write:(destination,model)=>({manifestPath:destination+'/manifest.json',
   tables:model.length,rows:model.reduce((sum,t)=>sum+t.rows,0)}),
  log:x=>logs.push(x),warn:x=>logs.push(x)});
 assert.equal(out,0);
 assert.equal(queries.length,1);
 assert.ok(queries[0].startsWith('SELECT '));
 assert.ok(!queries.some(q=>/\b(INSERT|UPDATE|DELETE|DROP|COMMIT)\b/.test(q)));
 assert.ok(logs.some(x=>x.includes('NO SCHOOL ROWS READ')));
});
