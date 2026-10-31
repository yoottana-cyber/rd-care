'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bangkokToday}=require('../src/attendance-write-contract.cjs');
const {
 OPT_IN,ROOM_SQL,ROSTER_SQL,UPSERT,CANCEL_OUTBOX,RESOLVE_ALERT,AUDIT,
 assertLabFlag,assertConnection,applyDailyInOpenTransaction
}=require('../src/lab-daily-attendance-transaction.cjs');
const {run}=require('../scripts/check-lab-daily-attendance-rollback.cjs');

const env={RD_DB_NAME:'ratsadaa_connect',RD_TRIGGER_LAB_DB_NAME:'ratsadaa_trgtest',
 RD_TRIGGER_LAB_ALLOW_ATTENDANCE:OPT_IN};
const teacher={kind:'staff',id:13,role:'teacher'};
const other={kind:'staff',id:15,role:'staff'};
const room={id:9,advisor_user_id:13,advisor2_user_id:15};
const entries=[{student_id:21,status:'absent'}, {student_id:22,status:'present'}];
function stub(roomValue=room,students=[{id:21},{id:22}]){
 const sql=[];
 return {sql,async execute(statement,args=[]){
  sql.push({statement,args});
  if(statement==='SELECT DATABASE() AS db')return [[{db:'ratsadaa_trgtest'}]];
  if(statement===ROOM_SQL)return [roomValue?[roomValue]:[]];
  if(statement===ROSTER_SQL)return [students];
  if([UPSERT,CANCEL_OUTBOX,RESOLVE_ALERT,AUDIT].includes(statement))
   return [{affectedRows:1}];
  throw Error('unexpected SQL '+statement);
 }};
}
test('opt-in must be exact and target must be separate from staging',()=>{
 assert.throws(()=>assertLabFlag({}),/lab_daily_attendance_opt_in_required/);
 assert.throws(()=>assertLabFlag({...env,RD_DB_NAME:'ratsadaa_trgtest'}),
  /lab_daily_database_identity_required/);
 assert.throws(()=>assertLabFlag({...env,RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'}),
  /lab_daily_database_identity_required/);
 assert.doesNotThrow(()=>assertLabFlag(env));
});
test('connection must be disposable lab, never staging',async()=>{
 await assert.rejects(()=>assertConnection({execute:async()=>[[{db:'ratsadaa_connect'}]]}),
  /lab_daily_wrong_database/);
});
test('daily writes include all students, cancel pending, resolve alerts, audit once',async()=>{
 const conn=stub(),today=bangkokToday();
 const output=await applyDailyInOpenTransaction(conn,{
  kind:'daily',classroom_id:9,date:today,entries
 },{env,actor:teacher});
 assert.equal(output.rows,2);
 assert.equal(output.absence_followups_resolved,1);
 assert.equal(output.requires_rollback,true);
 assert.equal(output.push_delivered,false);
 assert.deepEqual(conn.sql.map(q=>q.statement),[
  'SELECT DATABASE() AS db',ROOM_SQL,ROSTER_SQL,
  UPSERT,CANCEL_OUTBOX,RESOLVE_ALERT,UPSERT,AUDIT
 ]);
 assert.deepEqual(conn.sql[4].args,[21,today]);
 assert.deepEqual(conn.sql[5].args,[21,today]);
 assert.equal(conn.sql[7].args[1],today+':9:0');
 assert.ok(CANCEL_OUTBOX.includes("o.state='pending'"));
 assert.ok(RESOLVE_ALERT.includes("state='pending_review'"));
 assert.ok(UPSERT.includes('ON DUPLICATE KEY UPDATE'));
});
test('secondary homeroom adviser can write; unrelated student-affairs staff cannot',async()=>{
 const today=bangkokToday();
 const body={kind:'daily',classroom_id:9,date:today,entries};
 const allowed=await applyDailyInOpenTransaction(stub(),body,{actor:other,env});
 assert.equal(allowed.rows,2);
 const denied=stub();
 await assert.rejects(()=>applyDailyInOpenTransaction(denied,body,{
  actor:{...other,id:17},env
 }),e=>e.status===403);
 assert.equal(denied.sql.some(x=>x.statement===UPSERT),false);
});
test('unknown or duplicate student IDs and date errors block before SQL changes',async()=>{
 const today=bangkokToday(),bad=[
  [{student_id:21,status:'present'}],
  [{student_id:21,status:'present'},{student_id:21,status:'absent'}],
  [{student_id:21,status:'present'},{student_id:222,status:'absent'}],
  [{student_id:21,status:'truancy'},{student_id:22,status:'present'}]
 ];
 for(const entries of bad){
  const conn=stub();
  await assert.rejects(()=>applyDailyInOpenTransaction(conn,{
   kind:'daily',classroom_id:9,date:today,entries
  },{env,actor:teacher}),e=>e?.status===400);
  assert.equal(conn.sql.some(x=>x.statement===UPSERT),false);
 }
});
test('synthetic error after first upsert leaves caller responsible for ROLLBACK',async()=>{
 const conn=stub(),today=bangkokToday();
 await assert.rejects(()=>applyDailyInOpenTransaction(conn,{
  kind:'daily',classroom_id:9,date:today,entries
 },{env,actor:teacher,onStep:stage=>{
  if(stage==='daily_upsert')throw Error('lab_daily_injected_failure');
 }}),/lab_daily_injected_failure/);
 assert.equal(conn.sql.filter(x=>x.statement===UPSERT).length,1);
 assert.equal(conn.sql.some(x=>x.statement===AUDIT),false);
});
test('real MariaDB diagnostic refuses to connect before explicit permission',async()=>{
 const warning=[];let opened=false;
 const status=await run({env:{},
  driver:{createPool(){opened=true;throw Error('should not connect')}},
  log:()=>{},warn:x=>warning.push(x)});
 assert.equal(status,1);
 assert.equal(opened,false);
 assert.match(warning[0],/lab_daily_attendance_opt_in_required/);
});
