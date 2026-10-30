'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {OPT_IN,LESSON_SQL,classifyInsert,seed,cleanup,oneRace,diagnose,run}
 =require('../scripts/check-lab-timetable-race.cjs');

const ids={teachers:[11,12],rooms:[21,22]};
test('no opt-in means no database is opened',async()=>{
 let opened=false;const errors=[];
 const result=await run({env:{RD_TRIGGER_LAB_ALLOW_RACE:'RUN_LAB_GUARDIAN_RACE_7_7'},
  driver:{createPool(){opened=true;throw Error('should-not-open')}},
  log:()=>{},warn:x=>errors.push(x)});
 assert.equal(result,1);assert.equal(opened,false);
 assert.match(errors[0],/lab_explicit_race_approval_required/);
 assert.equal(OPT_IN,'RUN_LAB_TIMETABLE_RACE_7_10');
});
test('only source-equivalent overlap error is accepted, not UNIQUE or FK error',()=>{
 const overlap={errno:1644,sqlState:'45000',sqlMessage:'TIMETABLE_OVERLAP'};
 assert.equal(classifyInsert(overlap),'TRIGGER_REJECTED');
 assert.equal(classifyInsert({errno:1205}),'LOCK_WAIT_TIMEOUT');
 assert.equal(classifyInsert({errno:1213}),'DEADLOCK');
 assert.throws(()=>classifyInsert(Object.assign(Error('unique'),{errno:1062})),/unique/);
});
function fakePair({mode='allowed'}={}){
 const events=[];let aActive=false,bActive=false;
 const a={
  async beginTransaction(){events.push('A_BEGIN');aActive=true},
  async rollback(){events.push('A_ROLLBACK');aActive=false},
  async execute(sql,params){
   events.push({sql,params,connection:'A',active:aActive});
   assert.equal(aActive,true);
   assert.equal(sql,LESSON_SQL);
   return [{insertId:1}];
  },
  async query(sql){events.push(sql)}
 };
 const b={
  async beginTransaction(){events.push('B_BEGIN');bActive=true},
  async rollback(){events.push('B_ROLLBACK');bActive=false},
  async execute(sql,params){
   events.push({sql,params,connection:'B',active:bActive});
   assert.equal(aActive,true,'A must remain uncommitted');
   assert.equal(bActive,true);
   assert.equal(sql,LESSON_SQL);
   if(mode==='trigger'){
    const err=Error('TIMETABLE_OVERLAP');err.errno=1644;err.sqlState='45000';err.sqlMessage='TIMETABLE_OVERLAP';
    throw err;
   }
   if(mode==='timeout'){const err=Error('Lock timeout');err.errno=1205;throw err;}
   if(mode==='deadlock'){const err=Error('Deadlock');err.errno=1213;throw err;}
   return [{insertId:2}];
  },
  async query(sql){events.push(sql)}
 };
 return {a,b,events};
}
for(const mode of ['allowed','trigger','timeout','deadlock']){
 test('same-room concurrency '+mode+' is recorded and ALWAYS rolled back',async()=>{
  const {a,b,events}=fakePair({mode});
  const result=await oneRace(a,b,ids,'same_room');
  assert.equal(result.case,'same_room');
  assert.equal(result.overlap_temporarily_accepted,mode==='allowed');
  assert.equal(result.production_safe,false);
  assert.deepEqual(events.filter(x=>typeof x==='string'),
   ['A_BEGIN','B_BEGIN','B_ROLLBACK','A_ROLLBACK']);
  const left=events.find(e=>typeof e==='object'&&e.connection==='A');
  const right=events.find(e=>typeof e==='object'&&e.connection==='B');
  assert.equal(left.params[0],right.params[0]);
  assert.notEqual(left.params[1],right.params[1]);
  assert.equal(left.params[3],2);
  assert.equal(right.params[2],2);
 });
}
test('same-teacher/different-room also overlaps by inclusive periods',async()=>{
 const {a,b,events}=fakePair();
 const result=await oneRace(a,b,ids,'same_teacher');
 assert.equal(result.overlap_temporarily_accepted,true);
 const left=events.find(e=>typeof e==='object'&&e.connection==='A');
 const right=events.find(e=>typeof e==='object'&&e.connection==='B');
 assert.notEqual(left.params[0],right.params[0]);
 assert.equal(left.params[1],right.params[1]);
 assert.equal(left.params[3],5);
 assert.equal(right.params[2],5);
});
test('one-connection seed temporarily commits exactly two fake teachers and rooms',async()=>{
 let n=1;const calls=[],sql=[];
 const c={
  async beginTransaction(){calls.push('BEGIN')},
  async commit(){calls.push('COMMIT')},
  async rollback(){calls.push('ROLLBACK')},
  async execute(statement,args){sql.push({statement,args});return [{insertId:n++}]}
 };
 const result=await seed(c);
 assert.deepEqual(result,{teachers:[1,2],rooms:[3,4]});
 assert.deepEqual(calls,['BEGIN','COMMIT']);
 assert.equal(sql.length,4);
 assert.ok(sql.every(x=>x.statement.startsWith('INSERT INTO ')));
});
test('cleanup only deletes known IDs with prepared WHERE lists',async()=>{
 const statements=[],calls=[];
 const c={
  async beginTransaction(){calls.push('BEGIN')},
  async commit(){calls.push('COMMIT')},
  async rollback(){calls.push('ROLLBACK')},
  async execute(statement,args){statements.push({statement,args});return [{affectedRows:2}]}
 };
 await cleanup(c,ids);
 assert.deepEqual(calls,['BEGIN','COMMIT']);
 assert.deepEqual(statements.map(x=>x.args),[ids.rooms,ids.teachers]);
 assert.ok(statements.every(x=>x.statement.startsWith('DELETE FROM ')&&x.statement.includes(' WHERE ')));
 await assert.rejects(()=>cleanup(c,{teachers:[1]}),/lab_seed_ids_incomplete/);
});
test('no scenario commits a timetable and two distinct active sessions are required',async()=>{
 const {a,b,events}=fakePair();
 const results=await diagnose(a,b,ids);
 assert.deepEqual(results.map(x=>x.case),['same_room','same_teacher']);
 assert.equal(results.every(x=>x.overlap_temporarily_accepted),true);
 assert.equal(events.filter(x=>x==='A_ROLLBACK').length,2);
 assert.equal(events.filter(x=>x==='B_ROLLBACK').length,2);
 assert.equal(events.some(x=>x==='A_COMMIT'||x==='B_COMMIT'),false);
});
