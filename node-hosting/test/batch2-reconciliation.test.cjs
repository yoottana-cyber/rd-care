'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {q,groupFk,countParity,fkOrphans,reconcile}
 =require('../migration/reconcile.cjs');
const manifest={total_rows:0,tables:Array.from({length:63},(_,i)=>({
 name:'labtable'+i,rows:0,columns:['id']
}))};
const keys=Array.from({length:119},(_,i)=>({
 TABLE_NAME:'labtable'+(i%63),CONSTRAINT_NAME:'fk_'+i,
 COLUMN_NAME:'parent_id',REFERENCED_TABLE_NAME:'labtable'+((i+1)%63),
 REFERENCED_COLUMN_NAME:'id',ORDINAL_POSITION:1
}));
test('reject untrusted SQL table identifiers',()=>{
 assert.equal(q('school_table'),'`school_table`');
 for(const name of ['users;DROP TABLE users','../private','bad-name',''])assert.throws(()=>q(name),/migration_identifier_invalid/);
});
test('separate FK constraints and support multiple joined columns',()=>{
 const multiple=[
 {TABLE_NAME:'a',CONSTRAINT_NAME:'fk_1',COLUMN_NAME:'a1',
  REFERENCED_TABLE_NAME:'b',REFERENCED_COLUMN_NAME:'b1',ORDINAL_POSITION:1},
 {TABLE_NAME:'a',CONSTRAINT_NAME:'fk_1',COLUMN_NAME:'a2',
  REFERENCED_TABLE_NAME:'b',REFERENCED_COLUMN_NAME:'b2',ORDINAL_POSITION:2}
 ];
 const groups=groupFk(multiple);
 assert.equal(groups.length,1);
 assert.equal(groups[0].columns.length,2);
});
function fake({nonempty=false,orphan=false}={}){
 const executed=[];
 const c={executed,async execute(sql){
  executed.push(sql);
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_connect'}]];
  if(sql.includes('information_schema.KEY_COLUMN_USAGE'))return [keys];
  if(sql.startsWith('SELECT COUNT(*) AS n FROM `labtable'))return [[{n:nonempty?2:0}]];
  if(sql.startsWith('SELECT 1 AS orphan'))return [orphan?[{orphan:1}]:[]];
  throw Error('unexpected SELECT query '+sql);
 }};
 return c;
}
test('source counts and target counts match empty sanitized example',async()=>{
 const c=fake();
 const result=await reconcile(c,manifest);
 assert.equal(result.tables_checked,63);
 assert.equal(result.foreign_keys_checked,119);
 assert.equal(result.mismatched_tables,0);
 assert.equal(result.counts_match,true);
 assert.equal(result.relations_match,true);
 assert.equal(result.fully_reconciled,false);
 assert.equal(c.executed.some(x=>/INSERT|UPDATE|DELETE|DROP/.test(x)),false);
});
test('mismatching row counts or FK orphan rows fail report without changing data',async()=>{
 const counts=await countParity(fake({nonempty:true}),manifest);
 assert.equal(counts.mismatched_tables,63);
 const bad=await fkOrphans(fake({orphan:true}),groupFk(keys));
 assert.equal(bad.orphan_constraints,119);
});
