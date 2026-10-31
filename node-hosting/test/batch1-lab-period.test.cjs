'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bangkokToday,weekday}=require('../src/attendance-write-contract.cjs');
const {
 OPT_IN,assertLab,assertLabConnection,scoreReason,applyPeriodInOpenTransaction,
 ROOM,SLOT,ROSTER,POLICY,DAILY,OLD,UPSERT,TRUANCY_UPSERT,EVENT_UPSERT,
 LINK,INSERT_SCORE,LINK_SCORE,RESTORE_SCORE,REMOVE_TRUANCY,DEACTIVATE_EVENT,
 SOFT_DELETE_SCORE,ALERT_UPSERT,QUEUE_UPSERT,ALERT_LOOKUP,
 RESOLVE_ALERT,CANCEL_OUTBOX,AUDIT
}=require('../src/lab-period-attendance-transaction.cjs');
const {run}=require('../scripts/check-lab-period-truancy-rollback.cjs');
const env={RD_DB_NAME:'ratsadaa_connect',RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
 RD_TRIGGER_LAB_ALLOW_PERIOD:OPT_IN};
const today=bangkokToday();
const teacher={kind:'staff',id:7,role:'teacher'};
const room={id:12,advisor_user_id:7,advisor2_user_id:8};
const slot={id:21,classroom_id:12,teacher_user_id:7,
 day_of_week:weekday(today),period:2,end_period:3,active:1};
const body={kind:'period',date:today,classroom_id:12,timetable_id:21,
 entries:[{student_id:35,status:'truancy'}, {student_id:36,status:'absent'}]};
const fail=async(fn,status)=>assert.rejects(fn,e=>e.status===status);
function stub(overrides={}){
 const queries=[];let scoreCounter=0;
 return {queries,async execute(sql,args=[]){
  queries.push({sql,args});
  if(sql==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
  if(sql===ROOM)return [[overrides.room??room]];
  if(sql===SLOT)return [[overrides.slot??slot]];
  if(sql===ROSTER)return [[{id:35},{id:36}]];
  if(sql===POLICY)return [[{id:99,points:-7,category:'moderate'}]];
  if(sql===DAILY)return [[args[0]===36?{status:'absent'}:undefined].filter(Boolean)];
  if(sql===OLD)return [[]];
  if(sql===LINK)return [[]];
  if(sql===INSERT_SCORE){scoreCounter++;return [{insertId:123+scoreCounter}]}
  if(sql===ALERT_LOOKUP)return [[{id:501,state:'pending_review'}]];
  if([UPSERT,TRUANCY_UPSERT,EVENT_UPSERT,LINK_SCORE,RESTORE_SCORE,
    REMOVE_TRUANCY,DEACTIVATE_EVENT,SOFT_DELETE_SCORE,ALERT_UPSERT,
    QUEUE_UPSERT,RESOLVE_ALERT,CANCEL_OUTBOX,AUDIT].includes(sql)||
    sql.includes('period_teaching_logs')||sql.includes('audit_logs'))
   return [{affectedRows:1}];
  throw Error('unexpected SQL '+sql);
 }};
}
test('exactly isolated lab and explicit opt-in, never staging DB',()=>{
 assert.throws(()=>assertLab({}),/lab_period_opt_in_required/);
 assert.throws(()=>assertLab({...env,RD_DB_NAME:'ratsadaa_trgtest'}),/lab_period_wrong_environment/);
 assert.throws(()=>assertLab({...env,RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'}),/lab_period_wrong_environment/);
 assert.doesNotThrow(()=>assertLab(env));
});
test('connection must be separate disposable lab',async()=>{
 await assert.rejects(()=>assertLabConnection({
  execute:async()=>[[{db:'ratsadaa_connect'}]]
 }),/lab_period_wrong_database/);
});
test('teacher owns period; complete roster required and write date validated before SQL updates',async()=>{
 const nonowner=stub();
 await fail(()=>applyPeriodInOpenTransaction(nonowner,body,{
  actor:{kind:'staff',role:'teacher',id:44},env
 }),403);
 assert.equal(nonowner.queries.some(q=>q.sql===UPSERT),false);
 const missing=stub();
 await fail(()=>applyPeriodInOpenTransaction(missing,{
  ...body,entries:body.entries.slice(0,1)
 },{actor:teacher,env}),400);
 assert.equal(missing.queries.some(q=>q.sql===UPSERT),false);
 const future=stub();
 await fail(()=>applyPeriodInOpenTransaction(future,{
  ...body,date:'2100-01-01'
 },{actor:teacher,env}),400);
 assert.equal(future.queries.length,0);
});
test('one period submission adds linked configured score, never raw truancy attendance status',async()=>{
 const conn=stub();
 const report=await applyPeriodInOpenTransaction(conn,body,{actor:teacher,env});
 assert.equal(report.score_created,1);
 assert.equal(report.advisor_review_queued,0);
 assert.equal(report.requires_rollback,true);
 assert.equal(report.push_sent,false);
 assert.equal(conn.queries.filter(q=>q.sql===UPSERT).length,2);
 assert.equal(conn.queries.find(q=>q.sql===UPSERT).args[3],'absent');
 assert.equal(conn.queries.find(q=>q.sql===INSERT_SCORE).args[1],-7);
 assert.equal(conn.queries.filter(q=>q.sql===LINK_SCORE).length,1);
 assert.equal(conn.queries.filter(q=>q.sql===QUEUE_UPSERT).length,0);
 assert.equal(conn.queries.filter(q=>q.sql===AUDIT).length,1);
 assert.ok(scoreReason(today,slot).endsWith('2-3'));
});
test('ordinary absent with daily attendance already absent never queues advisor review',async()=>{
 const conn=stub();
 await applyPeriodInOpenTransaction(conn,{
  ...body,entries:[{student_id:35,status:'present'},{student_id:36,status:'absent'}]
 },{actor:teacher,env});
 assert.equal(conn.queries.filter(q=>q.sql===QUEUE_UPSERT).length,0);
 assert.ok(conn.queries.some(q=>q.sql===CANCEL_OUTBOX));
});
test('no production Push or external API integration; injected error does not write audit',async()=>{
 const conn=stub();
 await assert.rejects(()=>applyPeriodInOpenTransaction(conn,body,{
  actor:teacher,env,onStep:phase=>{if(phase==='attendance_upsert')
   throw Error('lab_period_simulated_write_failure')}
 }),/lab_period_simulated_write_failure/);
 assert.equal(conn.queries.some(q=>q.sql===AUDIT),false);
 assert.equal(conn.queries.some(q=>q.sql===INSERT_SCORE),false);
});
test('real DB test does not connect without exact opt-in',async()=>{
 let connected=false;const warnings=[];
 const output=await run({env:{},driver:{
  createPool(){connected=true;throw Error('unsafe_connection')}
 },log:()=>{},warn:x=>warnings.push(x)});
 assert.equal(output,1);
 assert.equal(connected,false);
 assert.match(warnings[0],/lab_period_opt_in_required/);
});
