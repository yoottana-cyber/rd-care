'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {decodeCell,rowValues,replay}=require('../migration/rollback-rehearsal.cjs');
const {run,guard,CONFIRM}=require('../scripts/check-d1-rollback-rehearsal.cjs');

test('strict JSONL column parity and cell decoding',()=>{
 assert.deepEqual(rowValues('{"id":1,"name":"student"}',['name','id']),['student',1]);
 assert.deepEqual(decodeCell({'$binary_base64':'AQID'}),Buffer.from([1,2,3]));
 for(const text of ['{"id":1}', '{"id":1,"name":"x","extra":"y"}',
  '[]','{"id":9007199254740992,"name":"x"}']){
  assert.throws(()=>rowValues(text,['id','name']),/migration_/);
 }
 assert.throws(()=>decodeCell({nested:{x:1}}),/migration_unsupported_json_cell/);
 assert.throws(()=>decodeCell({'$binary_base64':'not base64'}),/migration_invalid_binary_encoding/);
});
test('replay uses FK order, parameterized rows and full inventory',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd_replay_'));
 try{
  fs.writeFileSync(path.join(dir,'parents.jsonl'),'{"id":1,"name":"x"}\n');
  fs.writeFileSync(path.join(dir,'children.jsonl'),'{"id":2,"parent_id":1}\n');
  const manifest={total_rows:2,tables:[
   {name:'children',file:'children.jsonl',columns:['id','parent_id'],rows:1},
   {name:'parents',file:'parents.jsonl',columns:['id','name'],rows:1}
  ]};
  const statements=[];
  const conn={async execute(sql,values){statements.push({sql,values})}};
  const plan={stages:[['parents'],['children']],cyclic_or_blocked_tables:[]};
  assert.deepEqual(await replay(conn,dir,manifest,plan),{tables:2,rows:2});
  assert.equal(statements.length,2);
  assert.match(statements[0].sql,/^INSERT INTO `parents`/);
  assert.match(statements[1].sql,/^INSERT INTO `children`/);
  assert.deepEqual(statements[1].values,[2,1]);
  assert.ok(statements.every(s=>s.sql.includes('?')&&!s.sql.includes('"x"')));
  await assert.rejects(()=>replay(conn,dir,manifest,
   {stages:[],cyclic_or_blocked_tables:['parents']}),/migration_fk_cycle_blocked/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('missing confirmation never connects to MariaDB',async()=>{
 let connected=false;const logs=[];
 const result=await run({env:{},makePool(){connected=true;throw Error('unsafe')},
  log:x=>logs.push(x),warn:()=>{}});
 assert.equal(result,2);assert.equal(connected,false);
 assert.ok(logs.some(x=>x.includes('DISABLED')));
});
test('wrong database, forbidden flags and symlink are denied',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd_guard_'));
 const source=path.join(dir,'manifest.json');
 try{
  fs.writeFileSync(source,'{}');
  const base={RD_DB_NAME:'ratsadaa_connect',RD_D1_MANIFEST_FILE:source,
   RD_D1_REHEARSAL_CONFIRM:CONFIRM};
  assert.equal(guard(base),source);
  fs.mkdirSync(path.join(dir,'public_html'));
  const exposed=path.join(dir,'public_html','manifest.json');
  fs.writeFileSync(exposed,'{}');
  assert.throws(()=>guard({...base,RD_D1_MANIFEST_FILE:exposed}),/migration_manifest_under_web_root/);
  assert.throws(()=>guard({...base,RD_DB_NAME:'ratsadaa_connect_prod'}),/migration_target_must_be_staging/);
  assert.throws(()=>guard({...base,RD_ENABLE_SCHOOL_WRITES:'1'}),/migration_school_writes_forbidden/);
  assert.throws(()=>guard({...base,RD_MIGRATION_ALLOW_IMPORT:'1'}),/migration_school_writes_forbidden/);
  assert.throws(()=>guard({...base,RD_TRIGGER_LAB_ALLOW_WRITE:'anything'}),/migration_lab_write_flag_forbidden/);
  const link=path.join(dir,'link.json');
  try{fs.symlinkSync(source,link);
   assert.throws(()=>guard({...base,RD_D1_MANIFEST_FILE:link}),/migration_manifest_symlink_forbidden/);
  }catch(e){if(e.code!=='EPERM'&&e.code!=='EACCES')throw e}
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
function syntheticTarget(){
 const names=Array.from({length:63},(_,i)=>'lab'+i);
 return {
  tables:names.map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'})),
  columns:names.map(TABLE_NAME=>({TABLE_NAME,COLUMN_NAME:'id'})),
  fk:Array.from({length:119},(_,i)=>({TABLE_NAME:names[i%63],
   REFERENCED_TABLE_NAME:'lab0',CONSTRAINT_NAME:'fk'+i})),
  foreignKeys:119
 };
}
function setup({fail=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd_runner_'));
 fs.writeFileSync(path.join(dir,'manifest.json'),'{}');
 const manifest={total_rows:1,tables:Array.from({length:63},(_,i)=>({
  name:'lab'+i,columns:['id'],rows:i===0?1:0
 }))};
 const env={RD_DB_NAME:'ratsadaa_connect',RD_D1_REHEARSAL_CONFIRM:CONFIRM,
  RD_D1_MANIFEST_FILE:path.join(dir,'manifest.json')};
 const calls=[],logs=[];
 const conn={
  async execute(sql){calls.push('execute');if(sql.includes('information_schema.COLUMNS'))return [[]];
   throw Error('unexpected_sql')},
  async beginTransaction(){calls.push('begin')},
  async rollback(){calls.push('rollback')},
  release(){calls.push('release')}
 };
 const args={env,load:()=>({base:dir,manifest}),verify:async()=>{calls.push('verify')},
  inspect:async()=>{calls.push('inspect');return syntheticTarget()},
  play:async()=>{calls.push('play');if(fail)throw Error('simulated');return {tables:63,rows:1}},
  check:async()=>{calls.push('check');return {counts_match:true,relations_match:true}},
  makePool:()=>({getConnection:async()=>conn,end:async()=>{calls.push('end')}}),
  log:x=>logs.push(x),warn:x=>logs.push(x)};
 return {dir,args,calls,logs};
}
test('successful rehearsal ALWAYS rolls back and checks staging emptiness',async()=>{
 const s=setup();
 try{
  assert.equal(await run(s.args),0);
  assert.equal(s.calls.filter(x=>x==='rollback').length,1);
  assert.equal(s.calls.filter(x=>x==='inspect').length,2);
  assert.ok(s.calls.indexOf('verify')<s.calls.indexOf('begin'));
  assert.ok(s.calls.indexOf('rollback')<s.calls.lastIndexOf('inspect'));
  assert.ok(s.logs.some(x=>x.includes('RELEASE NO_GO')));
 }finally{fs.rmSync(s.dir,{recursive:true,force:true})}
});
test('interrupted importer still attempts rollback and verifies empty staging',async()=>{
 const s=setup({fail:true});
 try{
  assert.equal(await run(s.args),1);
  assert.equal(s.calls.filter(x=>x==='rollback').length,1);
  assert.equal(s.calls.filter(x=>x==='inspect').length,2);
  assert.equal(s.calls.includes('check'),false);
 }finally{fs.rmSync(s.dir,{recursive:true,force:true})}
});
