'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CHECKS,differences,verifySchema}=require('../scripts/verify-schema.cjs');
function mockPool(values=CHECKS){
 const queries=[];let closed=false;
 return {
  queries,
  get closed(){return closed},
  async query(sql){
   queries.push(sql);
   if(sql.includes('information_schema.TABLES'))return [[{n:values.total_tables}],[]];
   if(sql.includes('information_schema.TABLE_CONSTRAINTS'))return [[{n:values.total_foreign_keys}],[]];
   if(sql.includes('information_schema.TRIGGERS'))return [[{n:values.total_triggers}],[]];
   if(sql.includes('information_schema.COLUMNS'))return [[{t:values.end_date_type}],[]];
   if(sql.includes('information_schema.STATISTICS'))return [[{n:values.unique_indexes}],[]];
   throw new Error('Unexpected SQL statement');
  },
  async end(){closed=true}
 };
}
test('schema verifier only reads metadata and reports expected baseline',async()=>{
 const pool=mockPool();const logs=[],warnings=[];
 const result=await verifySchema({makePool:()=>pool,log:s=>logs.push(s),warn:s=>warnings.push(s)});
 assert.equal(result,0);assert.equal(pool.closed,true);assert.equal(pool.queries.length,5);
 for(const q of pool.queries){
  assert.match(q,/^SELECT /i);
  assert.match(q,/information_schema\./);
  assert.doesNotMatch(q,/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
 }
 assert.deepEqual(warnings,[]);
 assert.match(logs.join('\n'),/NOT yet ported/);
});
test('schema verifier catches missing foreign keys',async()=>{
 const pool=mockPool({...CHECKS,total_foreign_keys:118});
 const warnings=[];
 const result=await verifySchema({makePool:()=>pool,log:()=>{},warn:s=>warnings.push(s)});
 assert.equal(result,1);assert.equal(pool.closed,true);
 assert.match(warnings.join('\n'),/total_foreign_keys/);
});
test('schema baseline has no triggers and cannot authorize live migration',()=>{
 assert.equal(CHECKS.total_tables,63);
 assert.equal(CHECKS.total_foreign_keys,119);
 assert.equal(CHECKS.total_triggers,0);
 assert.deepEqual(differences({...CHECKS,unique_indexes:1}),['unique_indexes']);
});
