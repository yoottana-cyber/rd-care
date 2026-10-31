'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {coordinatedUpdate,coordinatedDelete,unionKeys,acquireSet,releaseSet,READ,READ_LOCKED,PRECHECK,UPDATE,DELETE}
 =require('../src/timetable-locked-update-delete.cjs');
const {coordinatedInsert,INSERT}=require('../src/timetable-locked-insert.cjs');
const {classifyTimetableDbError,lockNames}
 =require('../src/timetable-write-coordination.cjs');
const {OPT_IN,run,cleanup,makeLesson}=require('../scripts/check-lab-timetable-locked-updates.cjs');

const dbName='ratsadaa_trgtest';
const aLesson=makeLesson(21,31,1,1,2,'Synthetic Original');
const bLesson=makeLesson(22,32,1,2,3,'Synthetic Moved');
const dbRecord=(id,s)=>({id,classroom_id:s.classroom_id,teacher_user_id:s.teacher_user_id,
 day_of_week:s.day_of_week,period:s.period,end_period:s.end_period,
 subject:s.subject,active:s.active});

function db(){
 const named=new Map(),records=new Map(),events=[];let next=101;
 function session(owner){
  let pending=new Map(),inTransaction=false;
  const current=id=>pending.has(id)?pending.get(id):records.get(id);
  const out={owner,
   async beginTransaction(){assert.equal(inTransaction,false);inTransaction=true;events.push(owner+':begin')},
   async commit(){assert.equal(inTransaction,true);
    for(const [id,record] of pending){if(record===null)records.delete(id);else records.set(id,record)}
    pending=new Map();inTransaction=false;events.push(owner+':commit')},
   async rollback(){pending=new Map();inTransaction=false;events.push(owner+':rollback')},
   async execute(sql,params=[]){
    if(sql.startsWith('SELECT GET_LOCK')){
     const key=params[0];
     if(named.has(key)&&named.get(key)!==owner)return [[{acquired:0}]];
     named.set(key,owner);events.push(owner+':getlock');return [[{acquired:1}]];
    }
    if(sql.startsWith('SELECT RELEASE_LOCK')){
     const key=params[0];assert.equal(named.get(key),owner);named.delete(key);
     events.push(owner+':release');return [[{released:1}]];
    }
    if(sql===READ||sql===READ_LOCKED){
     const row=current(params[0]);
     return [row?[row]:[]];
    }
    if(sql===PRECHECK||sql.includes('SELECT id FROM timetable\n WHERE active=1')){
     const withId=sql===PRECHECK;
     const [omit,day,room,teacher,end,start]=withId?params:[undefined,...params];
     return [[...records.values()].filter(r=>r.id!==omit&&r.active===1&&
      r.day_of_week===day&&(r.classroom_id===room||r.teacher_user_id===teacher)&&
      r.period<=end&&(r.end_period??r.period)>=start).map(r=>({id:r.id}))];
    }
    if(sql===INSERT){
     assert.equal(inTransaction,true);
     const [room,teacher,day,period,end,subject,active]=params;
     const id=next++;
     pending.set(id,{id,classroom_id:room,teacher_user_id:teacher,day_of_week:day,
      period,end_period:end,subject,active});events.push(owner+':insert');
     return [{insertId:id}];
    }
    if(sql===UPDATE){
     assert.equal(inTransaction,true);
     const [room,teacher,day,period,end,subject,active,id]=params;
     const prev=current(id);if(!prev)return [{affectedRows:0}];
     pending.set(id,{id,classroom_id:room,teacher_user_id:teacher,day_of_week:day,
      period,end_period:end,subject,active});events.push(owner+':update');
     return [{affectedRows:1}];
    }
    if(sql===DELETE){
     assert.equal(inTransaction,true);
     const id=params[0];if(!current(id))return [{affectedRows:0}];
     pending.set(id,null);events.push(owner+':delete');return [{affectedRows:1}];
    }
    throw Error('unexpected SQL '+sql);
   }
  };
  return out;
 }
 return {a:session('A'),b:session('B'),records,named,events};
}
test('updating across classroom and teacher acquires sorted union of old and new locks',()=>{
 const keys=unionKeys(dbName,aLesson,bLesson);
 assert.equal(keys.length,4);assert.deepEqual(keys,[...keys].sort());
 assert.deepEqual(unionKeys(dbName,aLesson,aLesson),lockNames(dbName,aLesson));
});
test('release partial lock state and return busy without leaving named locks',async()=>{
 const d=db();
 const held=await acquireSet(d.a,unionKeys(dbName,aLesson,bLesson));
 await assert.rejects(()=>acquireSet(d.b,unionKeys(dbName,bLesson,
  makeLesson(23,32,1,4,5,'another'))),/lab_named_lock_busy/);
 assert.equal(d.named.size,4); // b's nonoverlapping partial key released
 await releaseSet(d.a,held);assert.equal(d.named.size,0);
});
test('UPDATE locks original+target, detects later overlap, and keeps old slot available',async()=>{
 const d=db(),baseline=await coordinatedInsert(d.a,dbName,aLesson);
 let oldBusy=false,newBusy=false;
 const updated=await coordinatedUpdate(d.a,dbName,baseline.id,bLesson,{
  onBeforeCommit:async()=>{
   await assert.rejects(()=>coordinatedInsert(d.b,dbName,aLesson),/lab_named_lock_busy/);
   oldBusy=true;
   await assert.rejects(()=>coordinatedInsert(d.b,dbName,
    {...bLesson,period:3,end_period:4}),/lab_named_lock_busy/);
   newBusy=true;
  }
 });
 assert.ok(oldBusy&&newBusy&&updated.lock_count===4);
 await coordinatedInsert(d.b,dbName,aLesson);
 await assert.rejects(()=>coordinatedInsert(d.b,dbName,
  {...bLesson,period:3,end_period:4}),
  e=>classifyTimetableDbError(e)==='overlap');
 assert.equal(d.records.size,2);
 assert.equal(d.named.size,0);
});
test('stale old row observed before lock is refused after peer changes it',async()=>{
 const d=db(),baseline=await coordinatedInsert(d.a,dbName,aLesson);
 let otherUpdated=false;
 await assert.rejects(()=>coordinatedUpdate(d.a,dbName,baseline.id,
  {...aLesson,period:4,end_period:4},{
   onBeforeLock:async()=>{
    await coordinatedUpdate(d.b,dbName,baseline.id,
     {...aLesson,period:7,end_period:8});
    otherUpdated=true;
   }
  }),/lab_timetable_stale_snapshot/);
 assert.equal(otherUpdated,true);
 assert.equal(d.records.get(baseline.id).period,7);
 assert.equal(d.named.size,0);
});
test('DELETE holds original keys; replacement accepted after delete commit',async()=>{
 const d=db(),baseline=await coordinatedInsert(d.a,dbName,aLesson);
 let busy=false;
 const removed=await coordinatedDelete(d.a,dbName,baseline.id,{
  onBeforeCommit:async()=>{
   await assert.rejects(()=>coordinatedInsert(d.b,dbName,aLesson),/lab_named_lock_busy/);
   busy=true;
  }
 });
 assert.equal(removed.operation,'delete');assert.equal(busy,true);
 const inserted=await coordinatedInsert(d.b,dbName,aLesson);
 assert.ok(inserted.id>baseline.id);
 assert.equal(d.records.size,1);assert.equal(d.named.size,0);
 assert.ok(d.events.indexOf('A:commit')<d.events.lastIndexOf('A:release'));
});
test('invalid inputs and a missing lesson cannot perform unsafe SQL mutations',async()=>{
 const d=db();
 await assert.rejects(()=>coordinatedUpdate(d.a,dbName,0,bLesson),/lab_invalid_timetable_id/);
 await assert.rejects(()=>coordinatedUpdate(d.a,dbName,1,
  {...bLesson,period:11}),/lab_invalid_period_start/);
 await assert.rejects(()=>coordinatedDelete(d.a,dbName,30),/lab_timetable_not_found/);
 assert.equal(d.named.size,0);assert.equal(d.records.size,0);
});
test('stage 7.13 refuses connection unless unique opt-in is supplied',async()=>{
 let dbOpened=false;const warnings=[];
 const status=await run({env:{RD_TRIGGER_LAB_ALLOW_WRITE:'RUN_LAB_TIMETABLE_WRITE_7_12'},
  driver:{createPool(){dbOpened=true;throw Error('unapproved')}},
  log:()=>{},warn:x=>warnings.push(x)});
 assert.equal(status,1);assert.equal(dbOpened,false);
 assert.match(warnings[0],/lab_explicit_write_approval_required/);
 assert.equal(OPT_IN,'RUN_LAB_TIMETABLE_UPDATE_DELETE_7_13');
});
test('cleanup uses bound IDs only, no unscoped table deletion',async()=>{
 const statements=[],c={
  async beginTransaction(){},async commit(){},async rollback(){},
  async execute(sql,args){statements.push({sql,args});return [{affectedRows:1}]}
 };
 const ids={rooms:[10,11],teachers:[12,13]};
 await cleanup(c,ids);
 assert.deepEqual(statements.map(x=>x.args),[ids.rooms,ids.rooms,ids.teachers]);
 assert.ok(statements.every(x=>x.sql.includes(' WHERE ')));
});
