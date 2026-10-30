'use strict';
// Stage 7.7: two-connection repeatable-read stale-snapshot race diagnostic.
// Operates ONLY on isolated disposable ratsadaa_trgtest with exact opt-in.
// A synthetic seed is temporarily COMMITTED to make it visible to both
// connections. It is removed by ID afterward; failures/crashes may leave
// synthetic records. A full 63-table emptiness check is required before/after.
// No database DDL, no real accounts, no public HTTP endpoints, no Push.
const {randomBytes}=require('node:crypto');
const {getLabConfig,LAB_DATABASE}=require('./check-trigger-lab.cjs');
const {checkTriggerSet}=require('../src/lab-guardian-update-guards.cjs');
const {assertEmpty}=require('./check-lab-guardian-updates.cjs');
const {category}=require('./check-db.cjs');

const OPT_IN='RUN_LAB_GUARDIAN_RACE_7_7';
const unique=prefix=>prefix+'_'+randomBytes(10).toString('hex');
function need(condition,reason){if(!condition)throw Error('lab_'+reason)}
async function seed(conn){
 const ids={};
 let active=false;
 try{
  await conn.beginTransaction();active=true;
  const [teacher]=await conn.execute(
   "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,'teacher',?,?,1)",
   [unique('labt'),'Synthetic Guardian Race Teacher','fake-salt','fake-hash']
  );
  ids.teacher=teacher.insertId;
  const [room]=await conn.execute(
   'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,1,?,?)',
   [unique('LAB'),ids.teacher]
  );
  ids.room=room.insertId;
  const [pupil]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,1,?,1)',
   [unique('labp'),ids.room,'Synthetic Race Pupil']
  );
  ids.pupil=pupil.insertId;
  const [pupil2]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,2,?,1)',
   [unique('labp'),ids.room,'Synthetic Race Second Pupil']
  );
  ids.pupil2=pupil2.insertId;
  const [guardian]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES(?,?,'guardian',NULL,?,?,1,?)",
   [unique('labg'),'Synthetic Race Guardian','fake-salt','fake-hash',ids.teacher]
  );
  ids.guardian=guardian.insertId;
  // This COMMIT is necessary for concurrent connections to see the fake rows.
  await conn.commit();active=false;
  return ids;
 }finally{
  if(active)await conn.rollback();
 }
}
async function cleanup(conn,ids){
 // Only delete exact synthetic IDs; NEVER run broad DELETE FROM on the lab.
 if(!ids?.guardian)return;
 let started=false;
 try{
  await conn.beginTransaction();started=true;
  await conn.execute('DELETE FROM guardian_student_links WHERE guardian_account_id=?',[ids.guardian]);
  await conn.execute('DELETE FROM portal_accounts WHERE id=?',[ids.guardian]);
  await conn.execute('DELETE FROM students WHERE id IN (?,?)',[ids.pupil,ids.pupil2]);
  await conn.execute('DELETE FROM classrooms WHERE id=?',[ids.room]);
  await conn.execute('DELETE FROM users WHERE id=?',[ids.teacher]);
  await conn.commit();started=false;
 }finally{
  if(started)await conn.rollback();
 }
}
async function race(main,peer,ids){
 let peerActive=false,mainActive=false;
 try{
  // Make the snapshot semantics explicit for this controlled interleaving.
  await peer.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await peer.beginTransaction();peerActive=true;
  const [old]=await peer.execute('SELECT role FROM portal_accounts WHERE id=?',[ids.guardian]);
  need(old.length===1&&old[0].role==='guardian','initial_guardian_not_visible');

  await main.beginTransaction();mainActive=true;
  await main.execute('UPDATE portal_accounts SET role=?,student_id=? WHERE id=?',
   ['student',ids.pupil2,ids.guardian]);
  await main.commit();mainActive=false;

  let inserted=false,blockedByGuard=false;
  try{
   await peer.execute(
    'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES (?,?,?)',
    [ids.guardian,ids.pupil,ids.teacher]
   );
   inserted=true; // forbidden invalid role may have passed stale snapshot
  }catch(e){
   if(e?.sqlState==='45000'||e?.errno===1644)blockedByGuard=true;
   else throw e;
  }
  need(inserted!==blockedByGuard,'invalid_guard_diagnostic');
  const [current]=await main.execute('SELECT role FROM portal_accounts WHERE id=?',[ids.guardian]);
  need(current.length===1&&current[0].role==='student','role_update_not_committed');
  return {
   stale_snapshot_insert_allowed:inserted,
   invalid_link_blocked_in_this_interleaving:blockedByGuard,
   guardian_role_committed_before_link_attempt:true,
   race_proof_scope:'one_repeatable_read_interleaving',
   production_safe:false
  };
 }finally{
  if(peerActive)await peer.rollback(); // never persist an invalid link
  if(mainActive)await main.rollback();
 }
}
async function verifyPostCleanup(main){
 await assertEmpty(main);
 await checkTriggerSet(main,3);
 return true;
}
async function run({env=process.env,driver,log=console.log,warn=console.error}={}){
 let pool,main,peer,ids=null,testResult=null,testError=null,cleaned=false,seedAttempted=false;
 try{
  if(env.RD_TRIGGER_LAB_ALLOW_RACE!==OPT_IN)
   throw Error('lab_explicit_race_approval_required');
  const base=getLabConfig(env); // protects lab name and separate credentials
  const mysql=driver||require('mysql2/promise');
  pool=mysql.createPool({...base,connectionLimit:2,queueLimit:2});
  main=await pool.getConnection();
  await checkTriggerSet(main,3);
  await assertEmpty(main);
  peer=await pool.getConnection();
  const [[db]]=await peer.execute('SELECT DATABASE() AS db');
  need(db?.db===LAB_DATABASE,'second_connection_wrong_database');
  seedAttempted=true;
  ids=await seed(main);
  try{testResult=await race(main,peer,ids)}catch(e){testError=e}
 }catch(e){testError=e}
 finally{
  // Always release peer before cleanup, so no stale transaction can block
  // deletion of the fake guardian/links.
  if(peer){try{await peer.rollback()}catch{}}
  if(ids&&main){
   try{
    await cleanup(main,ids);
    await verifyPostCleanup(main);
    cleaned=true;
   }catch{cleaned=false}
  }
  if(peer){try{peer.release()}catch{}}
  if(main){try{main.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
 if(testError||!testResult||!cleaned){
  const msg=String(testError?.message||'');
  const reason=msg.startsWith('lab_')?msg:category(testError);
  warn('STEP 7.7 FAILED ('+reason+').');
  if(seedAttempted&&!cleaned)warn('MANUAL LAB INSPECTION REQUIRED: synthetic committed seed may remain; do not retry or delete arbitrary data.');
  return 1;
 }
 log('STEP 7.7 DIAGNOSTIC COMPLETE: overlapping MariaDB transactions tested on separate connections.');
 log('RACE FINDING: '+(testResult.stale_snapshot_insert_allowed?
  'STALE_SNAPSHOT_ALLOWED — GUARDIAN RACE VULNERABILITY FOUND.':
  'INVALID_LINK_REJECTED_IN_THIS_INTERLEAVING — concurrency safety NOT proven.'));
 log('LAB CLEANUP VERIFIED: fake committed seed deleted and all 63 lab tables empty.');
 log('LAB STATUS: '+JSON.stringify({database:LAB_DATABASE,guardian_triggers:3,...testResult,cleanup_verified:true}));
 log('PRODUCTION BLOCKED: this test alone never approves live guardian writes or actual student accounts.');
 return 0;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.7 FAILED (unknown).');process.exitCode=1;
});
module.exports={OPT_IN,seed,cleanup,race,verifyPostCleanup,run};
