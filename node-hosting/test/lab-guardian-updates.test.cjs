'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {GUARDS,EXPECTED,checkTriggerSet,preflight}=require('../src/lab-guardian-update-guards.cjs');
const {OPT_IN,run:runInstall,install}=require('../scripts/install-lab-guardian-update-guards.cjs');
const {run:runTest}=require('../scripts/check-lab-guardian-updates.cjs');
const {SQL}=require('../src/lab-guardian-guard.cjs');

const triggerRows=[
 {TRIGGER_NAME:'guardian_link_role_guard',EVENT_OBJECT_TABLE:'guardian_student_links',EVENT_MANIPULATION:'INSERT',ACTION_TIMING:'BEFORE',ACTION_STATEMENT:SQL},
 ...GUARDS.map(g=>({TRIGGER_NAME:g.name,EVENT_OBJECT_TABLE:g.table,
  EVENT_MANIPULATION:'UPDATE',ACTION_TIMING:'BEFORE',ACTION_STATEMENT:g.sql}))
];
function fakeConnection({installed=1,tables=63,data=false,badDb=false}={}){
 let count=installed;let ddlCount=0;const queries=[];
 const conn={
  queries,
  get ddlCount(){return ddlCount},
  async execute(sql){
   queries.push(sql);
   if(sql==='SELECT DATABASE() AS db')return [[{db:badDb?'ratsadaa_connect':'ratsadaa_trgtest'}]];
   if(sql.includes('COUNT(*) AS n FROM information_schema.TABLES'))return [[{n:tables}]];
   if(sql.includes('COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS'))return [[{n:119}]];
   if(sql.includes('COUNT(*) AS n FROM information_schema.VIEWS'))return [[{n:0}]];
   if(sql.includes('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES'))
    return [Array.from({length:tables},(_,i)=>({TABLE_NAME:'lab_'+i,ENGINE:'InnoDB'}))];
   if(sql.includes('information_schema.TRIGGERS'))return [triggerRows.slice(0,count)];
   if(sql.startsWith('SELECT 1 AS present FROM '))return [data?[{present:1}]:[]];
   throw Error('unexpected query');
  },
  async query(sql){
   assert.ok(GUARDS.some(g=>g.sql===sql));
   ddlCount++;count++;
   return [{affectedRows:0}];
  }
 };
 return conn;
}
test('two extra SQL triggers cover guardian-link and portal-role UPDATE bypasses',()=>{
 assert.equal(GUARDS.length,2);
 assert.deepEqual(Object.keys(EXPECTED),triggerRows.map(r=>r.TRIGGER_NAME));
 for(const g of GUARDS){
  assert.match(g.sql,/^CREATE TRIGGER guardian_/);
  assert.match(g.sql,/BEFORE UPDATE ON/);
  assert.match(g.sql,/SIGNAL SQLSTATE '45000'/);
 }
 assert.match(GUARDS[0].sql,/NEW.guardian_account_id/);
 assert.match(GUARDS[1].sql,/OLD.role = 'guardian'/);
 assert.match(GUARDS[1].sql,/guardian_student_links/);
 assert.doesNotMatch(GUARDS.map(g=>g.sql).join('\n'),/DROP TABLE|CREATE TABLE|ALTER TABLE|DELETE FROM|TRUNCATE/i);
});
test('refuses a wrong database or nonempty lab before any DDL',async()=>{
 for(const c of [fakeConnection({badDb:true}),fakeConnection({data:true}),
                 fakeConnection({installed:2}),fakeConnection({tables:62})]){
  await assert.rejects(()=>preflight(c),/lab_/);
  assert.equal(c.ddlCount,0);
 }
});
test('installer checks each new trigger count and never runs arbitrary SQL',async()=>{
 const c=fakeConnection();
 const report=await install(c);
 assert.equal(report.installed_guardian_triggers,3);
 assert.equal(c.ddlCount,2);
 assert.deepEqual(await checkTriggerSet(c,3),{database:'ratsadaa_trgtest',guardian_triggers:3});
});
test('installation is disabled unless exact opt-in is present',async()=>{
 let opened=false;
 const warnings=[];
 assert.equal(await runInstall({env:{RD_TRIGGER_LAB_ALLOW_DDL:'other'},
  makePool:async()=>{opened=true;throw Error('should not connect')},
  log:()=>{},warn:s=>warnings.push(s)}),1);
 assert.equal(opened,false);
 assert.match(warnings[0],/lab_explicit_ddl_approval_required/);
 assert.equal(typeof OPT_IN,'string');
});
test('test runner refuses wrong DB and safely closes resources without printing secrets',async()=>{
 let released=false,ended=false;const warnings=[],logs=[];
 const connection=fakeConnection({badDb:true});
 connection.release=()=>{released=true};
 const result=await runTest({
  env:{},makePool:async()=>({getConnection:async()=>connection,end:async()=>{ended=true}}),
  log:s=>logs.push(s),warn:s=>warnings.push(s)
 });
 assert.equal(result,1);assert.equal(released,true);assert.equal(ended,true);
 assert.deepEqual(logs,[]);assert.match(warnings[0],/lab_database_mismatch/);
});
