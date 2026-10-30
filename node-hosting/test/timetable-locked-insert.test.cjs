'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {coordinatedInsert,PRECHECK,INSERT}
 =require('../src/timetable-locked-insert.cjs');
const {classifyTimetableDbError}
 =require('../src/timetable-write-coordination.cjs');
const {OPT_IN,run,cleanup,lesson}
 =require('../scripts/check-lab-timetable-locked-inserts.cjs');

function fakeSessions(){
 const locks=new Map(),committed=[],events=[];
 let nextId=10;
 function conn(id){
  const s={id,pending:[],active:false,rollbackCount:0,commitCount:0};
  s.beginTransaction=async()=>{assert.equal(s.active,false);s.active=true;events.push(id+':begin')};
  s.commit=async()=>{
   assert.equal(s.active,true);committed.push(...s.pending);
   s.pending=[];s.active=false;s.commitCount++;events.push(id+':commit');
  };
  s.rollback=async()=>{
   s.pending=[];s.active=false;s.rollbackCount++;events.push(id+':rollback');
  };
  s.execute=async(q,args=[])=>{
   if(q.startsWith('SELECT GET_LOCK')){
    const [key]=args;
    if(locks.has(key)&&locks.get(key)!==id)return [[{acquired:0}]];
    locks.set(key,id);events.push(id+':lock');return [[{acquired:1}]];
   }
   if(q.startsWith('SELECT RELEASE_LOCK')){
    const key=args[0];
    assert.equal(locks.get(key),id);locks.delete(key);
    events.push(id+':unlock');return [[{released:1}]];
   }
   if(q===PRECHECK){
    assert.equal(s.active,true);
    const [day,room,teacher,end,start]=args;
    return [committed.filter(r=>r.day===day&&(r.room===room||r.teacher===teacher)
      &&r.start<=end&&r.end>=start).map(r=>({id:r.id}))];
   }
   if(q===INSERT){
    assert.equal(s.active,true);
    const [room,teacher,day,start,end,subject,active]=args;
    const id=nextId++;
    s.pending.push({id,room,teacher,day,start,end:end??start,subject,active});
    events.push(id+':sql_insert');return [{insertId:id}];
   }
   throw Error('unexpected SQL: '+q);
  };
  return s;
 }
 return {a:conn('A'),b:conn('B'),committed,locks,events};
}
const first={classroom_id:20,teacher_user_id:30,day_of_week:1,period:1,end_period:2,subject:'Synthetic First',active:1};
const conflicting={...first,teacher_user_id:31,period:2,end_period:3,subject:'Synthetic Conflicting'};
test('second session receives busy while first owns the lock; after commit receives overlap',async()=>{
 const db=fakeSessions();
 const inserted=await coordinatedInsert(db.a,'ratsadaa_trgtest',first,{
  onBeforeCommit:async()=>{
   await assert.rejects(
    ()=>coordinatedInsert(db.b,'ratsadaa_trgtest',conflicting),
    /lab_named_lock_busy/
   );
   assert.equal(db.b.active,false);
   assert.equal(db.committed.length,0);
  }
 });
 assert.equal(Number(inserted.id)>0,true);
 assert.equal(db.committed.length,1);
 await assert.rejects(()=>coordinatedInsert(db.b,'ratsadaa_trgtest',conflicting),
  e=>classifyTimetableDbError(e)==='overlap');
 assert.equal(db.committed.length,1);
 assert.equal(db.b.rollbackCount,1);
 assert.equal(db.locks.size,0);
 assert.ok(db.events.indexOf('A:commit')<db.events.lastIndexOf('A:unlock'));
});
test('same-teacher different-room overlap blocked and adjacent period accepted',async()=>{
 const db=fakeSessions();
 await coordinatedInsert(db.a,'ratsadaa_trgtest',first);
 await assert.rejects(()=>coordinatedInsert(db.b,'ratsadaa_trgtest',
  {...first,classroom_id:21,period:2,end_period:3}),
  e=>classifyTimetableDbError(e)==='overlap');
 const adjacent=await coordinatedInsert(db.b,'ratsadaa_trgtest',
  {...first,teacher_user_id:31,period:3,end_period:null,subject:'Adjacent'});
 assert.ok(adjacent.id>0);
 assert.equal(db.committed.length,2);
 assert.equal(db.locks.size,0);
});
test('invalid period/subject rejected before connection IO',async()=>{
 const c={execute(){throw Error('unexpected_sql')},beginTransaction(){throw Error('begin!')}};
 await assert.rejects(()=>coordinatedInsert(c,'ratsadaa_trgtest',
  {...first,period:11}),/lab_invalid_period_start/);
 await assert.rejects(()=>coordinatedInsert(c,'ratsadaa_trgtest',
  {...first,subject:''}),/lab_invalid_subject/);
});
test('failed user hook rolls back and unlocks',async()=>{
 const db=fakeSessions();
 await assert.rejects(()=>coordinatedInsert(db.a,'ratsadaa_trgtest',first,{
  onBeforeCommit:async()=>{throw Error('lab_test_abort')}
 }),/lab_test_abort/);
 assert.equal(db.committed.length,0);
 assert.equal(db.locks.size,0);
 assert.equal(db.a.rollbackCount,1);
});
test('step 7.12 is opt-in before any DB access',async()=>{
 let opened=false;const errors=[];
 const code=await run({env:{RD_TRIGGER_LAB_ALLOW_WRITE:'no'},
  driver:{createPool(){opened=true;throw Error('should_not_open')}},
  log:()=>{},warn:x=>errors.push(x)});
 assert.equal(code,1);assert.equal(opened,false);
 assert.equal(OPT_IN,'RUN_LAB_TIMETABLE_WRITE_7_12');
 assert.match(errors[0],/lab_explicit_write_approval_required/);
});
test('cleanup only targets fixture classroom and teacher identifiers',async()=>{
 const statements=[],calls=[];
 const c={
  async beginTransaction(){calls.push('BEGIN')},
  async commit(){calls.push('COMMIT')},
  async rollback(){calls.push('ROLLBACK')},
  async execute(q,args){statements.push({q,args});return [{affectedRows:2}]}
 };
 const fixture={rooms:[41,42],teachers:[51,52]};
 await cleanup(c,fixture);
 assert.deepEqual(calls,['BEGIN','COMMIT']);
 assert.deepEqual(statements.map(s=>s.args),[fixture.rooms,fixture.rooms,fixture.teachers]);
 assert.ok(statements.every(s=>s.q.startsWith('DELETE FROM ')&&s.q.includes(' WHERE ')));
 await assert.rejects(()=>cleanup(c,{rooms:[1]}),/lab_seed_ids_incomplete/);
});
test('lesson factory uses fixed inclusive ranges and known synthetic subject labels',()=>{
 assert.deepEqual(lesson(1,2,3,4,5,'Synthetic Lab7.12: sample'),{
  classroom_id:1,teacher_user_id:2,day_of_week:3,
  period:4,end_period:5,active:1,subject:'Synthetic Lab7.12: sample'
 });
});
