'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LAB_SCHEMA,LAB_CONFIRM,runLabTransaction}=require(
 '../mariadb-parity/lab-transaction.cjs');

const makeConnection=(options={})=>{
 const log=[];
 const db={
  log,
  async execute(sql,params=[]){
   log.push(['query',sql,params]);
   if(sql.startsWith('SELECT DATABASE()'))return [[{
    active_schema:options.schema??LAB_SCHEMA,
    fk_enabled:options.fk??1,
    unique_enabled:options.unique??1
   }],[]];
   if(options.failQuery)throw Error('synthetic_write_failed');
   return [{affectedRows:1,insertId:11},[]];
  },
  async beginTransaction(){log.push(['begin']);},
  async commit(){log.push(['commit']);if(options.failCommit)throw Error('synthetic_commit_uncertain')},
  async rollback(){log.push(['rollback']);if(options.failRollback)throw Error('synthetic_rollback_failed')}
 };
 return db;
};
const yes={confirm:LAB_CONFIRM};
const steps=db=>db.log.filter(x=>x[0]!=='query').map(x=>x[0]);

test('refuses missing explicit confirmation before connecting',async()=>{
 const c=makeConnection();
 await assert.rejects(()=>runLabTransaction(c,async()=>{},{}),
  /explicit_lab_confirmation_required/);
 assert.equal(c.log.length,0);
});
test('refuses staging and production schemas with no writes or BEGIN',async()=>{
 for(const schema of ['ratsadaa_connect','mysql','rd_connect_prod','']){
  const c=makeConnection({schema});
  await assert.rejects(()=>runLabTransaction(c,async()=>c.execute('INSERT INTO students VALUES (?)',[1]),yes),
   /lab_schema_must_be_isolated/);
  assert.deepEqual(steps(c),[]);
  assert.equal(c.log.some(x=>/INSERT INTO/.test(x[1]||'')),false);
 }
});
test('does not allow disabled MariaDB foreign or unique checks',async()=>{
 for(const options of [{fk:0},{unique:0}]){
  const c=makeConnection(options);
  await assert.rejects(()=>runLabTransaction(c,async()=>{},yes),
   /lab_database_integrity_checks_must_be_on/);
  assert.deepEqual(steps(c),[]);
 }
});
test('runs on single verified lab connection, commits once after work',async()=>{
 const c=makeConnection();
 const outcome=await runLabTransaction(c,async db=>{
  const r=await db.execute('INSERT INTO lab_fake VALUES (?)',[9]);
  return r[0].insertId;
 },yes);
 assert.equal(outcome.committed,true);
 assert.equal(outcome.value,11);
 assert.deepEqual(steps(c),['begin','commit']);
 const queries=c.log.filter(x=>x[0]==='query');
 assert.equal(queries.filter(x=>x[1].startsWith('SELECT DATABASE()')).length,3);
 assert.equal(queries[2][1],'INSERT INTO lab_fake VALUES (?)');
});
test('rolls back a partial write and never commits it',async()=>{
 const c=makeConnection({failQuery:true});
 await assert.rejects(()=>runLabTransaction(c,async db=>{
  await db.execute('INSERT INTO lab_fake VALUES (?)',[9]);
 },yes),/synthetic_write_failed/);
 assert.deepEqual(steps(c),['begin','rollback']);
});
test('rollback failure does not claim success and requires inspection',async()=>{
 const c=makeConnection({failQuery:true,failRollback:true});
 await assert.rejects(()=>runLabTransaction(c,async db=>{
  await db.execute('INSERT INTO lab_fake VALUES (?)',[9]);
 },yes),/lab_rollback_failed_manual_inspection_required/);
 assert.deepEqual(steps(c),['begin','rollback']);
});
test('uncertain COMMIT returns failure, no automatic retry',async()=>{
 const c=makeConnection({failCommit:true});
 await assert.rejects(()=>runLabTransaction(c,async()=>33,yes),/synthetic_commit_uncertain/);
 assert.deepEqual(steps(c),['begin','commit','rollback']);
});
