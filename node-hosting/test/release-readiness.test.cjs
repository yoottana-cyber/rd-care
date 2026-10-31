'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessReadiness,assertStagingEnvironment,REQUIRED_CAPABILITIES,evaluateSnapshot}
 =require('../src/release-readiness.cjs');
const {testPublicGate,inspectStaging,run}=require('../scripts/check-go-live-readiness.cjs');
const env={RD_DB_NAME:'ratsadaa_connect'};
const snapshot={db:'ratsadaa_connect',tables:63,fks:119,triggers:0,views:0,
 verified_empty_tables:63};
const http={
 health:{status:503,body:{error:'migration_not_ready'}},
 auth:{status:501,body:{error:'endpoint_not_migrated'}},
 timetable:{status:501,body:{error:'endpoint_not_migrated'}},
 transport:{status:200,body:{login_enabled:false,migration_ready:false}}
};
test('safe baseline is still NO_GO, not production-ready',()=>{
 const result=assessReadiness({env,snapshot,http});
 assert.equal(result.status,'NO_GO');
 assert.equal(result.production_ready,false);
 assert.equal(result.verified_production_capabilities,0);
 assert.equal(result.pending_capabilities.length,REQUIRED_CAPABILITIES.length);
 assert.ok(result.reasons.length>=4);
});
test('staging DB mismatch and any temporary install/write flags fail closed',()=>{
 assert.throws(()=>assertStagingEnvironment({RD_DB_NAME:'ratsadaa_trgtest'}),/release_wrong_staging_db/);
 assert.throws(()=>assertStagingEnvironment({...env,
  RD_TRIGGER_LAB_DB_NAME:'ratsadaa_connect'}),/release_lab_aliases_staging/);
 for(const key of ['RD_TRIGGER_LAB_ALLOW_DDL','RD_TRIGGER_LAB_ALLOW_RACE',
  'RD_TRIGGER_LAB_ALLOW_LOCK','RD_TRIGGER_LAB_ALLOW_WRITE',
  'RD_TRIGGER_LAB_ALLOW_RETRY','RD_TRIGGER_LAB_ALLOW_ATTENDANCE',
  'RD_TRIGGER_LAB_ALLOW_PERIOD','RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE']){
  assert.throws(()=>assertStagingEnvironment({...env,[key]:'TEST'}),/release_temporary_test_flag_present/);
 }
});
test('staging metadata drift, triggers, student data or unexpected views block',()=>{
 for(const changed of [{...snapshot,tables:62},{...snapshot,fks:118},
  {...snapshot,triggers:5},{...snapshot,verified_empty_tables:62},
  {...snapshot,views:1},{...snapshot,db:'ratsadaa_trgtest'}]){
  assert.throws(()=>evaluateSnapshot(changed),/release_/);
 }
});
test('public HTTP handler must remain fail-closed',()=>{
 const gates=testPublicGate();
 assert.equal(gates.health.status,503);
 assert.equal(gates.auth.status,501);
 assert.equal(gates.timetable.status,501);
 assert.equal(gates.transport.status,200);
 const result=assessReadiness({env,snapshot,http:gates});
 assert.equal(result.status,'NO_GO');
});
test('if a public API opens unexpectedly, NO_GO audit refuses to claim success',()=>{
 const bad={...http,auth:{status:200,body:{token:'synthetic-secret'}}};
 assert.throws(()=>assessReadiness({env,snapshot,http:bad}),/release_public_gate_not_closed/);
});
function fakeConnection({nonempty=false,wrongDb=false}={}){
 const queries=[];
 const conn={queries,
  async execute(query){
   queries.push(query);
   if(query==='SELECT DATABASE() AS db')return [[{db:wrongDb?'ratsadaa_trgtest':'ratsadaa_connect'}]];
   if(query.includes('COUNT(*) AS n FROM information_schema.TABLES'))return [[{n:63}]];
   if(query.includes('COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS'))return [[{n:119}]];
   if(query.includes('COUNT(*) AS n FROM information_schema.TRIGGERS'))return [[{n:0}]];
   if(query.includes('COUNT(*) AS n FROM information_schema.VIEWS'))return [[{n:0}]];
   if(query.includes('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES'))
    return [Array.from({length:63},(_,i)=>({TABLE_NAME:'lab_table_'+i,ENGINE:'InnoDB'}))];
   if(query.startsWith('SELECT 1 AS present FROM `'))
    return [nonempty?[{present:1}]:[]];
   throw Error('unsupported_sql');
  },
  release(){queries.push('RELEASE_CONNECTION')}
 };
 return conn;
}
test('metadata and all-table empty verification performs SELECT only',async()=>{
 const conn=fakeConnection();
 const found=await inspectStaging(conn);
 assert.deepEqual(found,snapshot);
 assert.equal(conn.queries.filter(x=>x.startsWith('SELECT 1 AS present')).length,63);
 assert.ok(conn.queries.every(x=>x.startsWith('SELECT ')));
 for(const options of [{nonempty:true},{wrongDb:true}]){
  await assert.rejects(()=>inspectStaging(fakeConnection(options)),/release_/);
 }
});
test('one-command release check intentionally returns 2 / NO_GO after healthy staging read',async()=>{
 const conn=fakeConnection(),logs=[],warns=[];
 let ended=0;
 const code=await run({env,makePool:()=>({
  getConnection:async()=>conn,
  end:async()=>{ended++}
 }),log:x=>logs.push(x),warn:x=>warns.push(x)});
 assert.equal(code,2);
 assert.ok(logs.some(x=>x.includes('RELEASE READINESS NO_GO')));
 assert.ok(logs.some(x=>x.includes('63')));
 assert.ok(warns.some(x=>x.includes('GO LIVE BLOCKED')));
 assert.equal(ended,1);
 assert.ok(conn.queries.includes('RELEASE_CONNECTION'));
});
test('preflight failure returns 1 and refuses to use wrong DB',async()=>{
 let connected=false;const warn=[];
 const code=await run({env:{RD_DB_NAME:'ratsadaa_trgtest'},
  makePool:()=>{connected=true;throw Error('should not connect')},
  log:()=>{},warn:s=>warn.push(s)});
 assert.equal(code,1);
 assert.equal(connected,false);
 assert.match(warn[0],/release_wrong_staging_db/);
});
