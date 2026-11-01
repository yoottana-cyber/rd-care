'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recordManualConductLab,LAB_CONFIRM}=require(
 '../mariadb-parity/manual-conduct-transaction.cjs');

const REQUEST='b8aefc13-fb3a-49ae-b9a0-e5e81a27d28d';
const input={studentId:11,actorId:5,ruleId:7,requestId:REQUEST,reason:'synthetic conduct'};
const run=(db,payload=input)=>recordManualConductLab(db,payload,{confirm:LAB_CONFIRM});

function mock(options={}){
 const log=[],pending=[],committed=[];
 const db={
  log,committed,
  async execute(sql,params=[]){
   log.push({sql,params});
   if(sql.startsWith('SELECT DATABASE()'))return [[{
    active_schema:options.schema||'ratsadaa_connect_lab',
    fk_enabled:options.fk??1,unique_enabled:options.unique??1
   }],[]];
   if(sql.startsWith('SELECT u.id,u.role,u.active'))
    return [[{id:5,role:options.role||'teacher',active:options.actorActive??1,
     student_affairs:options.studentAffairs??1}],[]];
   if(sql.startsWith('SELECT id,classroom_id,active FROM students'))
    return [[{id:11,classroom_id:3,active:options.studentActive??1}],[]];
   if(sql.startsWith('SELECT 1 AS ok FROM classrooms'))
    return [options.hasAccess===false?[]:[{ok:1}],[]];
   if(sql.startsWith('SELECT id,category,points,active,deleted_at FROM affairs_behavior_rules'))
    return [[{id:7,category:options.category||'moderate',points:options.points??-10,
     active:options.ruleActive??1,deleted_at:null}],[]];
   if(sql.startsWith('SELECT 1 AS managed FROM truancy_score_policy'))
    return [options.managedTruancy?[{managed:1}]:[],[]];
   if(sql.startsWith('SELECT COUNT(*) AS n FROM information_schema.TRIGGERS'))
    return [[{n:options.triggerCount??0}],[]];
   if(sql.startsWith('SELECT id,student_id,affairs_rule_id,request_id'))
    return [options.receipt?[options.receipt]:[],[]];
   if(sql.startsWith('SELECT COUNT(*) AS n FROM behavior_incidents'))
    return [[{n:options.previous??0}],[]];
   if(/^(INSERT|UPDATE)\s/.test(sql)){
    if(options.failAt&&sql.includes(options.failAt))
     throw Error('synthetic_statement_failed');
    pending.push(sql);
    const insertId=sql.includes('INSERT INTO behavior_incidents')?41:
                   sql.includes('INSERT INTO behavior_records')?51:0;
    return [{affectedRows:1,insertId},[]];
   }
   throw Error('unexpected_sql_in_synthetic_lab');
  },
  async beginTransaction(){log.push({method:'begin'});},
  async commit(){log.push({method:'commit'});committed.push(...pending);pending.length=0;},
  async rollback(){log.push({method:'rollback'});pending.length=0;}
 };
 return db;
}
const writes=db=>db.log.filter(x=>/^(INSERT|UPDATE)\s/.test(x.sql||'')).map(x=>x.sql);
const steps=db=>db.log.filter(x=>x.method).map(x=>x.method);

test('lab warning commits incident and audit/outbox but no score',async()=>{
 const db=mock({previous:0});
 const result=await run(db);
 assert.equal(result.committed,true);
 assert.equal(result.value.warning_no,1);
 assert.equal(result.value.points_applied,0);
 assert.equal(result.value.behavior_record_id,null);
 assert.equal(result.value.push_event_queued,true);
 assert.equal(result.value.dispatch_performed,false);
 assert.deepEqual(steps(db),['begin','commit']);
 assert.equal(writes(db).length,3);
 assert.equal(writes(db).some(sql=>sql.includes('INSERT INTO behavior_records')),false);
 assert.equal(db.committed.length,3);
 const lockIndex=db.log.findIndex(x=>x.sql?.startsWith('SELECT id,classroom_id,active'));
 const firstWrite=db.log.findIndex(x=>x.sql?.startsWith('INSERT INTO behavior_incidents'));
 assert.ok(lockIndex>=0&&lockIndex<firstWrite);
});

test('second moderate incident commits negative score and link in same transaction',async()=>{
 const db=mock({previous:1});
 const result=await run(db);
 assert.equal(result.value.points_applied,-10);
 assert.equal(result.value.warning_no,0);
 assert.equal(result.value.behavior_record_id,51);
 assert.equal(result.value.push_event_queued,true);
 assert.deepEqual(steps(db),['begin','commit']);
 assert.equal(db.committed.length,5);
 assert.ok(db.committed.some(sql=>sql.includes('UPDATE behavior_incidents SET behavior_record_id')));
 assert.ok(db.committed.some(sql=>sql.includes('FROM behavior_incidents WHERE id=?')));
});

test('replayed idempotent request returns receipt without duplicate writes',async()=>{
 const db=mock({receipt:{
  id:41,student_id:11,affairs_rule_id:7,request_id:REQUEST,
  reason:'synthetic conduct',recorded_by:5,recorded_school_date:null,
  points_applied:-10,warning_no:0,behavior_record_id:51
 }});
 const result=await run(db);
 assert.equal(result.value.reused,true);
 assert.equal(result.value.incident_id,41);
 assert.equal(result.value.behavior_record_id,51);
 assert.equal(result.value.push_event_queued,false);
 assert.deepEqual(writes(db),[]);
 assert.deepEqual(steps(db),['begin','commit']);
});

test('replayed request with conflicting contents rolls back',async()=>{
 const db=mock({receipt:{
  id:41,student_id:11,affairs_rule_id:7,request_id:REQUEST,
  reason:'a different request',recorded_by:5,recorded_school_date:null,
  points_applied:-10,warning_no:0,behavior_record_id:51
 }});
 await assert.rejects(()=>run(db),/lab_request_id_payload_conflict/);
 assert.deepEqual(writes(db),[]);
 assert.deepEqual(steps(db),['begin','rollback']);
});

test('failure after score insert rolls entire transaction back including outbox',async()=>{
 const db=mock({previous:1,failAt:'INSERT INTO audit_logs'});
 await assert.rejects(()=>run(db),/synthetic_statement_failed/);
 assert.deepEqual(steps(db),['begin','rollback']);
 assert.ok(writes(db).some(sql=>sql.includes('behavior_records')));
 assert.equal(db.committed.length,0);
 assert.equal(writes(db).some(sql=>sql.includes('behavior_score_push_events')),false);
});

test('permissions, inactive rule and trigger conflicts fail without writes',async()=>{
 for(const options of [
  {studentAffairs:0,hasAccess:false},{actorActive:0},
  {studentActive:0},{ruleActive:0},{managedTruancy:true},
  {triggerCount:1},{category:'serious',studentAffairs:0,hasAccess:true}
 ]){
  const db=mock(options);
  await assert.rejects(()=>run(db));
  assert.deepEqual(writes(db),[]);
  assert.deepEqual(steps(db),['begin','rollback']);
 }
});

test('refuses production schema, selected dates and missing confirmation',async()=>{
 const wrong=mock({schema:'ratsadaa_connect'});
 await assert.rejects(()=>run(wrong),/lab_schema_must_be_isolated/);
 assert.deepEqual(steps(wrong),[]);
 const selected=mock();
 await assert.rejects(()=>run(selected,{...input,recordedDate:'2026-10-31'}),
  /selected_history_date_not_implemented_in_lab_adapter/);
 assert.equal(selected.log.length,0);
 const unauthorized=mock();
 await assert.rejects(()=>recordManualConductLab(unauthorized,input),
  /explicit_lab_confirmation_required/);
 assert.equal(unauthorized.log.length,0);
});
