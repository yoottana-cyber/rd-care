'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {OPT_IN,seed,cleanup,race,run}=require('../scripts/check-lab-guardian-race.cjs');

test('stage 7.7 is explicitly opted-in, does not open DB by default',async()=>{
 let opened=false;
 const messages=[];
 const result=await run({
  env:{},driver:{createPool(){opened=true;throw Error('should_not_open')}},
  log:()=>{},warn:x=>messages.push(x)
 });
 assert.equal(result,1);
 assert.equal(opened,false);
 assert.match(messages[0],/lab_explicit_race_approval_required/);
 assert.equal(OPT_IN,'RUN_LAB_GUARDIAN_RACE_7_7');
});
const ids={teacher:12,room:13,pupil:14,pupil2:15,guardian:16};
function mocks({reject=false}={}){
 const calls=[];
 let role='guardian',mainActive=false,peerActive=false;
 const main={
  async beginTransaction(){calls.push('main_begin');mainActive=true},
  async commit(){calls.push('main_commit');mainActive=false},
  async rollback(){calls.push('main_rollback');mainActive=false},
  async execute(sql,args){
   calls.push(sql);
   if(sql.startsWith('UPDATE portal_accounts SET role=')){assert.equal(mainActive,true);role=args[0];return [{affectedRows:1}]}
   if(sql.startsWith('SELECT role FROM portal_accounts'))return [[{role}]];
   throw Error('unexpected_main_sql');
  }
 };
 const peer={
  async query(sql){calls.push(sql);assert.match(sql,/REPEATABLE READ/)},
  async beginTransaction(){calls.push('peer_begin');peerActive=true},
  async rollback(){calls.push('peer_rollback');peerActive=false},
  async execute(sql,args){
   calls.push(sql);
   assert.equal(peerActive,true);
   if(sql.startsWith('SELECT role FROM portal_accounts'))return [[{role:'guardian'}]];
   if(sql.startsWith('INSERT INTO guardian_student_links')){
    if(reject){const e=Error('guard');e.sqlState='45000';throw e}
    return [{affectedRows:1}];
   }
   throw Error('unexpected_peer_sql');
  }
 };
 return {main,peer,calls};
}
for(const reject of [false,true]){
 test('two overlapping transactions record actual guard result, reject='+reject,async()=>{
  const {main,peer,calls}=mocks({reject});
  const result=await race(main,peer,ids);
  assert.equal(result.stale_snapshot_insert_allowed,!reject);
  assert.equal(result.invalid_link_blocked_in_this_interleaving,reject);
  assert.equal(result.production_safe,false);
  assert.ok(calls.indexOf('main_commit')<calls.findIndex(q=>q.startsWith('INSERT INTO guardian_student_links')));
  assert.ok(calls.includes('peer_rollback'));
 });
}
test('cleanup uses only WHERE-ID deletes with explicit synthetic identifiers',async()=>{
 const sql=[];
 let active=false;
 const conn={
  async beginTransaction(){active=true},
  async commit(){active=false},
  async rollback(){active=false},
  async execute(q,args){sql.push({q,args});return [{affectedRows:1}]}
 };
 await cleanup(conn,ids);
 assert.equal(active,false);
 assert.equal(sql.length,5);
 assert.ok(sql.every(({q,args})=>q.startsWith('DELETE FROM ')&&q.includes('WHERE ')&&Array.isArray(args)&&args.length>0));
 assert.deepEqual(sql[0].args,[ids.guardian]);
 assert.deepEqual(sql.at(-1).args,[ids.teacher]);
});
test('seed commits only fake records to make them visible to 2 connections',async()=>{
 let seq=1;
 const calls=[],queryArgs=[];
 const conn={
  async beginTransaction(){calls.push('begin')},
  async commit(){calls.push('commit')},
  async rollback(){calls.push('rollback')},
  async execute(sql,args){queryArgs.push({sql,args});return [{insertId:seq++}]}
 };
 const result=await seed(conn);
 assert.deepEqual(result,{teacher:1,room:2,pupil:3,pupil2:4,guardian:5});
 assert.deepEqual(calls,['begin','commit']);
 assert.equal(queryArgs.length,5);
 assert.ok(queryArgs.every(q=>q.sql.startsWith('INSERT INTO ')&&q.args.every(a=>typeof a==='string'||typeof a==='number')));
});
