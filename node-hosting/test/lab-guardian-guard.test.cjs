'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SQL,labTriggerMetadata,labEmptyAccounts}=require('../src/lab-guardian-guard.cjs');
const {OPT_IN,install,run:installRun}=require('../scripts/install-lab-guardian-guard.cjs');
const {run:testRun}=require('../scripts/check-lab-guardian-guard.cjs');
test('trigger SQL contains only one known guarded lab rule',()=>{
 assert.match(SQL,/^CREATE TRIGGER guardian_link_role_guard/);
 assert.match(SQL,/BEFORE INSERT ON guardian_student_links/);
 assert.match(SQL,/pa\.role = 'guardian'/);
 assert.match(SQL,/SIGNAL SQLSTATE '45000'/);
 assert.doesNotMatch(SQL,/DROP TABLE|CREATE TABLE|ALTER TABLE|UPDATE portal_accounts/i);
});
test('installation refuses to open the DB without opt-in',async()=>{
 let opened=false;const errors=[];
 const ret=await installRun({env:{},makePool:async()=>{opened=true;throw Error('unexpected')},
  warn:s=>errors.push(s),log:()=>{}});
 assert.equal(ret,1);assert.equal(opened,false);
 assert.match(errors[0],/lab_explicit_ddl_approval_required/);
});
test('installer cannot create trigger if lab already has unexpected rows',async()=>{
 let queried=false;
 const conn={
  async execute(sql){
   if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
   if(sql.includes('information_schema.TABLES')){
    return [[{TABLE_NAME:'users',ENGINE:'InnoDB'}]]; // needs 63 tables
   }
   throw Error('unexpected');
  },
  async query(){queried=true;throw Error('never')}
 };
 await assert.rejects(()=>install(conn),/lab_table_count_mismatch/);
 assert.equal(queried,false);
});
test('installed trigger metadata must exactly match original INSERT semantics',async()=>{
 const expectedSql='BEGIN IF NOT EXISTS (SELECT 1 FROM portal_accounts pa WHERE pa.id = NEW.guardian_account_id AND pa.role = \'guardian\') THEN SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = \'guardian_account_required\'; END IF; END';
 const good={TRIGGER_NAME:'guardian_link_role_guard',EVENT_OBJECT_TABLE:'guardian_student_links',
  EVENT_MANIPULATION:'INSERT',ACTION_TIMING:'BEFORE',ACTION_STATEMENT:expectedSql};
 const conn={async execute(sql){
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
  if(sql.includes('information_schema.TRIGGERS'))return [[good]];
  throw Error('unknown');
 }};
 assert.deepEqual(await labTriggerMetadata(conn,1),{database:'ratsadaa_trgtest',installed_triggers:1});
 const bad={...conn,async execute(sql){
  if(sql.includes('information_schema.TRIGGERS'))return [[{...good,EVENT_OBJECT_TABLE:'students'}]];
  return conn.execute(sql);
 }};
 await assert.rejects(()=>labTriggerMetadata(bad,1),/lab_guardian_trigger_mismatch/);
});
test('lab row-preflight refuses existing accounts before new synthetic transactions',async()=>{
 const conn={async execute(sql){return [sql.includes('FROM `students`')?[{present:1}]:[]]}};
 await assert.rejects(()=>labEmptyAccounts(conn),/lab_contains_existing_data/);
});
test('failed lab integration cleans up handles and exposes no credentials',async()=>{
 const warn=[],log=[];let released=false,ended=false;
 const conn={release(){released=true},async execute(sql){
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_connect'}]];
  throw Error('sensitive_db_error');
 }};
 const pool={getConnection:async()=>conn,end:async()=>{ended=true}};
 const ret=await testRun({makePool:async()=>pool,env:{},warn:s=>warn.push(s),log:s=>log.push(s)});
 assert.equal(ret,1);assert.equal(released,true);assert.equal(ended,true);
 assert.equal(log.length,0);assert.match(warn[0],/lab_database_mismatch/);
 assert.doesNotMatch(warn.join(''),/sensitive_db_error/);
});
