'use strict';
// RD CONNECT 7.8 — second interleaving of two real MariaDB connections.
// Test ONLY on isolated ratsadaa_trgtest; no SQL schema changes.
// Seed uses fake accounts in a committed transaction (cleanup by exact ID).
// If interrupted, inspect the disposable lab; DO NOT retry blindly.
const {category}=require('./check-db.cjs');
const {LAB_DATABASE,getLabConfig}=require('./check-trigger-lab.cjs');
const {makeConnection,checkTriggerSet}=require('../src/lab-guardian-update-guards.cjs');
const {assertEmpty}=require('./check-lab-guardian-updates.cjs');
const {seed,cleanup}=require('./check-lab-guardian-race.cjs');

const OPT_IN='RUN_LAB_GUARDIAN_REVERSE_RACE_7_8';
const PAUSE_MS=650;
function need(cond,key){if(!cond)throw Error('lab_'+key)}
const settle = promise=>Promise.resolve(promise).then(()=>({kind:'allowed'}),error=>({kind:'error',error}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function isGuardianSignal(error){
 return error?.sqlState==='45000'||error?.errno===1644;
}
async function reverseRace(main,peer,ids,{sleep=delay}={}){
 let aActive=false,bActive=false;
 try{
  await main.query('SET SESSION innodb_lock_wait_timeout=5');
  await peer.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  // Peer B creates a VALID guardian link, but keeps it uncommitted.
  await peer.beginTransaction();bActive=true;
  await peer.execute(
   'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
   [ids.guardian,ids.pupil,ids.teacher]
  );
  // A simultaneously tries to transform the linked guardian into a student.
  // A must not commit this update. Only its outcome is observed.
  await main.beginTransaction();aActive=true;
  const pending=settle(main.execute(
   'UPDATE portal_accounts SET role=?,student_id=? WHERE id=?',
   ['student',ids.pupil2,ids.guardian]
  ));
  // Allow the server a bounded moment to start the concurrent query before
  // releasing B's uncommitted link. No unbounded waits in the application.
  const during=await Promise.race([pending,sleep(PAUSE_MS).then(()=>({kind:'pending'}))]);
  await peer.commit();bActive=false;
  const after=await pending;
  if(after.kind==='error'&&!isGuardianSignal(after.error))throw after.error;
  const [linked]=await main.execute(
   'SELECT 1 AS present FROM guardian_student_links WHERE guardian_account_id=? AND student_id=?',
   [ids.guardian,ids.pupil]
  );
  need(linked.length===1,'peer_link_commit_missing');
  const [guardian]=await main.execute('SELECT role FROM portal_accounts WHERE id=?',[ids.guardian]);
  // A's uncommitted local UPDATE may return role=student (vulnerability
  // observed) but will NEVER be committed. Only record it as a finding.
  need(guardian.length===1,'guardian_missing');
  return {
   link_inserted_before_role_change:true,
   link_committed_before_role_update_resolved:during.kind==='pending',
   unauthorized_role_change_accepted:after.kind==='allowed',
   linked_guardian_role_update_rejected:after.kind==='error'&&isGuardianSignal(after.error),
   race_proof_scope:'one_reverse_overlap_interleaving',
   production_safe:false
  };
 }finally{
  // Always ROLLBACK the attempted role change; no invalid role is persisted.
  if(aActive)await main.rollback();
  if(bActive)await peer.rollback();
 }
}
async function run({env=process.env,driver,log=console.log,warn=console.error,sleep}={}){
 let pool,main,peer,ids=null,seedAttempted=false,cleaned=false,outcome=null,error=null;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_RACE!==OPT_IN)throw Error('lab_explicit_race_approval_required');
  const config=getLabConfig(env); // exact separate lab database + credentials
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...config,connectionLimit:2,queueLimit:2});
  main=await pool.getConnection();
  await checkTriggerSet(main,3);
  await assertEmpty(main);
  peer=await pool.getConnection();
  const [[db]]=await peer.execute('SELECT DATABASE() AS db');
  need(db?.db===LAB_DATABASE,'second_connection_wrong_database');
  seedAttempted=true;
  ids=await seed(main);
  try{outcome=await reverseRace(main,peer,ids,{sleep:sleep||delay})}
  catch(e){error=e}
 }catch(e){error=e}
 finally{
  // The test's transactions are rolled back by reverseRace before cleanup.
  // If it exits abnormally, issue rollback on both connections first.
  if(peer){try{await peer.rollback()}catch{}}
  if(main){try{await main.rollback()}catch{}}
  if(ids&&main){
   try{
    await cleanup(main,ids);
    await assertEmpty(main);
    await checkTriggerSet(main,3);
    cleaned=true;
   }catch{cleaned=false}
  }
  if(peer){try{peer.release()}catch{}}
  if(main){try{main.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
 if(error||!outcome||!cleaned){
  const msg=String(error?.message||'');
  warn('STEP 7.8 FAILED ('+(msg.startsWith('lab_')?msg:category(error))+').');
  if(seedAttempted&&!cleaned)
   warn('MANUAL LAB INSPECTION REQUIRED: committed synthetic records might remain. Do not rerun or delete arbitrary rows.');
  return 1;
 }
 log('STEP 7.8 DIAGNOSTIC COMPLETE: reverse overlap tested with two MariaDB connections.');
 log('REVERSE RACE FINDING: '+(outcome.unauthorized_role_change_accepted?
  'ROLE_UPDATE_ALLOWED — POTENTIAL CONCURRENCY BYPASS DETECTED.':
  'LINKED_ROLE_CHANGE_REJECTED_IN_THIS_INTERLEAVING — full safety NOT proven.'));
 log('LAB CLEANUP VERIFIED: synthetic committed seed and guardian link deleted; all 63 tables empty.');
 log('LAB STATUS: '+JSON.stringify({database:LAB_DATABASE,guardian_triggers:3,...outcome,cleanup_verified:true}));
 log('PRODUCTION BLOCKED: single race scenarios are not a security proof; no school records accessed.');
 return 0;
}
if(require.main===module)run().then(n=>{process.exitCode=n},()=>{
 console.error('STEP 7.8 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,PAUSE_MS,reverseRace,isGuardianSignal,run};
