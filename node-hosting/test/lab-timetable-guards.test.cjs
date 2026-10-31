'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 TIMETABLE_TRIGGERS,inspectSet,preflight,verifyTrigger,TIMETABLE_EXPECTED
}=require('../src/lab-timetable-guards.cjs');
const {install,run:runInstall,OPT_IN}=require('../scripts/install-lab-timetable-guards.cjs');
const {expectOverlap}=require('../scripts/check-lab-timetable-guards.cjs');
const {GUARDS}=require('../src/lab-guardian-update-guards.cjs');
const {SQL}=require('../src/lab-guardian-guard.cjs');
const triggers=[
 {TRIGGER_NAME:'guardian_link_role_guard',EVENT_OBJECT_TABLE:'guardian_student_links',
  EVENT_MANIPULATION:'INSERT',ACTION_TIMING:'BEFORE',ACTION_STATEMENT:SQL},
 ...GUARDS.map(g=>({
  TRIGGER_NAME:g.name,EVENT_OBJECT_TABLE:g.table,
  EVENT_MANIPULATION:'UPDATE',ACTION_TIMING:'BEFORE',ACTION_STATEMENT:g.sql
 })),
 ...TIMETABLE_TRIGGERS.map(g=>({
  TRIGGER_NAME:g.name,EVENT_OBJECT_TABLE:'timetable',
  EVENT_MANIPULATION:g.event,ACTION_TIMING:'BEFORE',ACTION_STATEMENT:g.sql
 }))
];
function fake({name='ratsadaa_trgtest',installed=3,nonempty=false,wrongFK=false}={}){
 const state={installed,ddlCount:0,selects:[]};
 const c={
  state,
  async execute(sql){
   state.selects.push(sql);
   if(sql==='SELECT DATABASE() AS db')return [[{db:name}]];
   if(sql.includes('information_schema.TRIGGERS'))return [triggers.slice(0,state.installed)];
   if(sql.includes("COUNT(*) AS n FROM information_schema.TABLES"))return [[{n:63}]];
   if(sql.includes("COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS"))return [[{n:wrongFK?118:119}]];
   if(sql.includes("COUNT(*) AS n FROM information_schema.VIEWS"))return [[{n:0}]];
   if(sql.includes("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES"))
    return [Array.from({length:63},(_,i)=>({TABLE_NAME:'lab_'+i,ENGINE:'InnoDB'}))];
   if(sql.startsWith('SELECT 1 AS present FROM '))return [nonempty?[{present:1}]:[]];
   throw Error('unexpected_query');
  },
  async query(sql){
   assert.ok(TIMETABLE_TRIGGERS.some(item=>item.sql===sql));
   state.ddlCount++;
   state.installed++;
   return [];
  }
 };
 return c;
}
test('original timetable overlap predicates preserved with OLD.id exclusion',()=>{
 assert.deepEqual(TIMETABLE_TRIGGERS.map(x=>x.name),['timetable_clash_insert','timetable_clash_update']);
 for(const t of TIMETABLE_TRIGGERS){
  assert.match(t.sql,/BEFORE (INSERT|UPDATE) ON timetable/);
  assert.match(t.sql,/SIGNAL SQLSTATE '45000'/);
  assert.match(t.sql,/TIMETABLE_OVERLAP/);
  assert.match(t.sql,/COALESCE\(NEW.end_period, NEW.period\)/);
  assert.match(t.sql,/COALESCE\(t.end_period, t.period\)/);
  assert.match(t.sql,/t.teacher_user_id = NEW.teacher_user_id/);
  assert.match(t.sql,/t.classroom_id = NEW.classroom_id/);
  assert.ok(TIMETABLE_EXPECTED[t.name]);
 }
 assert.match(TIMETABLE_TRIGGERS[1].sql,/t.id <> OLD.id/);
 assert.doesNotMatch(TIMETABLE_TRIGGERS.map(t=>t.sql).join(' '),/DROP TABLE|CREATE TABLE|DELETE FROM|TRUNCATE/);
});
test('counts and metadata must be exactly three, four, or five known triggers',async()=>{
 for(const n of [3,4,5]){
  const c=fake({installed:n});
  const res=await inspectSet(c,n);
  assert.equal(res.installed_triggers,n);
  assert.equal(res.timetable_triggers,n-3);
 }
 await assert.rejects(()=>inspectSet(fake({installed:2}),3),/lab_unexpected_trigger_count/);
 await assert.rejects(()=>inspectSet(fake({name:'ratsadaa_connect'}),3),/lab_database_mismatch/);
 assert.throws(()=>verifyTrigger({...triggers[4],EVENT_OBJECT_TABLE:'users'}),/lab_trigger_metadata_mismatch/);
});
test('preflight rejects nonempty or schema-drift labs before DDL',async()=>{
 for(const c of [fake({nonempty:true}),fake({wrongFK:true}),fake({installed:4}),fake({name:'ratsadaa_connect'})]){
  await assert.rejects(()=>preflight(c),/lab_/);
  assert.equal(c.state.ddlCount,0);
 }
});
test('installer only applies two fixed SQL rules in correct order',async()=>{
 const c=fake();
 assert.deepEqual(await install(c),{database:'ratsadaa_trgtest',installed_triggers:5,timetable_triggers:2});
 assert.equal(c.state.installed,5);
 assert.equal(c.state.ddlCount,2);
 assert.equal((await inspectSet(c,5)).installed_triggers,5);
});
test('installer requires exact consent, does not open any connection otherwise',async()=>{
 let opened=false;const warns=[];
 const code=await runInstall({
  env:{RD_TRIGGER_LAB_ALLOW_DDL:'INSTALL_GUARDIAN_UPDATE_DDL_ON_TEST_DB_7_6'},
  driver:{createPool(){opened=true;throw Error('unapproved')}},
  warn:x=>warns.push(x),log:()=>{}
 });
 assert.equal(code,1);assert.equal(opened,false);
 assert.match(warns[0],/lab_explicit_ddl_approval_required/);
 assert.equal(OPT_IN,'INSTALL_TIMETABLE_DDL_ON_TEST_DB_7_9');
});
test('only TIMETABLE_OVERLAP is accepted as a clash rejection',async()=>{
 const conn={async execute(){const e=Error('TIMETABLE_OVERLAP');e.sqlState='45000';e.sqlMessage='TIMETABLE_OVERLAP';throw e}};
 await expectOverlap(conn,'INSERT mock',[],'case');
 const invalid={async execute(){const e=Error('Duplicate entry');e.errno=1062;throw e}};
 await assert.rejects(()=>expectOverlap(invalid,'INSERT mock',[],'case'));
});
