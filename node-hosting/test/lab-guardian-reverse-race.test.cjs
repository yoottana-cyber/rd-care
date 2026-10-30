'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {OPT_IN,PAUSE_MS,reverseRace,isGuardianSignal,run}
 =require('../scripts/check-lab-guardian-reverse-race.cjs');
const ids={teacher:10,room:11,pupil:12,pupil2:13,guardian:14};

test('stage 7.8 opt-in rejects unapproved invocation before DB access',async()=>{
 let opened=false;const messages=[];
 const result=await run({
  env:{RD_TRIGGER_LAB_ALLOW_RACE:'RUN_LAB_GUARDIAN_RACE_7_7'},
  driver:{createPool(){opened=true;throw Error('unreachable')}},
  warn:x=>messages.push(x),log:()=>{}
 });
 assert.equal(result,1);assert.equal(opened,false);
 assert.match(messages[0],/lab_explicit_race_approval_required/);
 assert.equal(OPT_IN,'RUN_LAB_GUARDIAN_REVERSE_RACE_7_8');
 assert.ok(PAUSE_MS>0&&PAUSE_MS<5000);
});
test('only SQLSTATE 45000 or errno 1644 is a trigger rejection',()=>{
 assert.equal(isGuardianSignal({sqlState:'45000'}),true);
 assert.equal(isGuardianSignal({errno:1644}),true);
 assert.equal(isGuardianSignal({errno:1205,sqlState:'HY000'}),false);
});
function fakeRace({blocked=true}={}){
 const events=[];let finish;const pending=new Promise(resolve=>{finish=resolve});
 let bOpen=false;
 const main={
  async query(s){events.push(s);assert.match(s,/innodb_lock_wait_timeout=5/)},
  async beginTransaction(){events.push('a.begin')},
  async rollback(){events.push('a.rollback')},
  async execute(sql,args){
   events.push(sql);
   if(sql.startsWith('UPDATE portal_accounts SET role=')){
    assert.equal(bOpen,true);
    assert.deepEqual(args,['student',ids.pupil2,ids.guardian]);
    return pending;
   }
   if(sql.startsWith('SELECT 1 AS present FROM guardian_student_links'))return [[{present:1}]];
   if(sql.startsWith('SELECT role FROM portal_accounts'))return [[{role:'guardian'}]];
   throw Error('unexpected SQL');
  }
 };
 const peer={
  async query(s){events.push(s);assert.match(s,/REPEATABLE READ/)},
  async beginTransaction(){events.push('b.begin');bOpen=true},
  async rollback(){events.push('b.rollback');bOpen=false},
  async commit(){
   events.push('b.commit');bOpen=false;
   if(blocked){const e=Error('guard rejected');e.sqlState='45000';finish(Promise.reject(e))}
   else finish([{affectedRows:1}]);
  },
  async execute(sql,args){
   events.push(sql);
   assert.ok(bOpen);
   assert.match(sql,/^INSERT INTO guardian_student_links/);
   assert.deepEqual(args,[ids.guardian,ids.pupil,ids.teacher]);
   return [{affectedRows:1}];
  }
 };
 return {main,peer,events};
}
for(const blocked of [true,false]){
 test('reverse overlap result (guardian guard blocked='+blocked+')',async()=>{
  const {main,peer,events}=fakeRace({blocked});
  const result=await reverseRace(main,peer,ids,{sleep:async()=>{}});
  assert.equal(result.linked_guardian_role_update_rejected,blocked);
  assert.equal(result.unauthorized_role_change_accepted,!blocked);
  assert.equal(result.production_safe,false);
  assert.equal(result.link_committed_before_role_update_resolved,true);
  const idxUpdate=events.findIndex(x=>x.startsWith('UPDATE portal_accounts SET role='));
  const idxCommit=events.indexOf('b.commit');
  assert.ok(idxUpdate>=0&&idxCommit>idxUpdate);
  assert.ok(events.includes('a.rollback'));
  assert.ok(!events.includes('a.commit'));
 });
}
test('deadlock or timeout is not misreported as successful guardian guard',async()=>{
 const {main,peer}=fakeRace();
 peer.commit=async()=>{const e=Error('lock_timeout');e.errno=1205;throw e};
 await assert.rejects(
  ()=>reverseRace(main,peer,ids,{sleep:async()=>{}}),/lock_timeout/
 );
});
