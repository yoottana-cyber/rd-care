'use strict';
// Stage 7.6 rollback-only integration test of actual MariaDB lab UPDATE guards.
// Creates randomized FAKE teacher/pupil/guardian/student accounts; no real data.
const {randomBytes}=require('node:crypto');
const {category}=require('./check-db.cjs');
const {makeConnection,checkTriggerSet,LAB_DATABASE}=require('../src/lab-guardian-update-guards.cjs');
const unique=p=>p+'_'+randomBytes(10).toString('hex');
function ensure(v,key){if(!v)throw Error('lab_test_'+key)}
async function expectGuard(conn,sql,args,reason){
 let rejected=false;
 try{await conn.execute(sql,args)}catch(e){
  if(e?.sqlState==='45000'||e?.errno===1644)rejected=true;
  else throw e;
 }
 ensure(rejected,reason);
}
async function assertEmpty(conn){
 const [tableRows]=await conn.execute(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
 );
 ensure(tableRows.length===63,'table_count');
 for(const row of tableRows){
  const table=row.TABLE_NAME;
  ensure(/^[a-z][a-z0-9_]{0,63}$/.test(table),'table_name');
  ensure(String(row.ENGINE).toUpperCase()==='INNODB','table_engine');
  const [existing]=await conn.execute('SELECT 1 AS present FROM `'+table+'` LIMIT 1');
  ensure(existing.length===0,'lab_database_contains_rows');
 }
}
async function check(conn){
 await checkTriggerSet(conn,3);
 await assertEmpty(conn);
 let started=false;
 try{
  await conn.beginTransaction();started=true;
  const [teacher]=await conn.execute(
   "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,'teacher',?,?,1)",
   [unique('labt'),'Synthetic Teacher','fake-salt','fake-hash']
  );
  const [room]=await conn.execute(
   'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,1,?,?)',
   [unique('LAB'),teacher.insertId]
  );
  const [pupil]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,1,?,1)',
   [unique('labp'),room.insertId,'Synthetic Pupil']
  );
  const [pupil2]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,2,?,1)',
   [unique('labp'),room.insertId,'Synthetic Pupil Two']
  );
  const [student]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES(?,?,'student',?,?,?,1,?)",
   [unique('labs'),'Synthetic Student Account',pupil.insertId,'fake-salt','fake-hash',teacher.insertId]
  );
  const [guardianA]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES(?,?,'guardian',NULL,?,?,1,?)",
   [unique('labga'),'Synthetic Guardian A','fake-salt','fake-hash',teacher.insertId]
  );
  const [guardianB]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES(?,?,'guardian',NULL,?,?,1,?)",
   [unique('labgb'),'Synthetic Guardian B','fake-salt','fake-hash',teacher.insertId]
  );
  await expectGuard(conn,
   'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
   [student.insertId,pupil.insertId,teacher.insertId],'insert_student_role');
  await conn.execute(
   'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,?)',
   [guardianA.insertId,pupil.insertId,teacher.insertId]
  );
  // Bypass #1: UPDATE existing guardian link to a portal STUDENT account.
  await expectGuard(conn,
   'UPDATE guardian_student_links SET guardian_account_id=? WHERE guardian_account_id=? AND student_id=?',
   [student.insertId,guardianA.insertId,pupil.insertId],'update_link_to_student_role');
  // Bypass #2: change guardian A into student after a valid link exists.
  await expectGuard(conn,
   'UPDATE portal_accounts SET role=?, student_id=? WHERE id=?',
   ['student',pupil2.insertId,guardianA.insertId],'update_linked_guardian_role');
  const [stillGuardian]=await conn.execute(
   'SELECT role FROM portal_accounts WHERE id=?',[guardianA.insertId]
  );
  ensure(stillGuardian.length===1&&stillGuardian[0].role==='guardian','guardian_role_preserved');
  // Allowed: edit non-role attribute while links remain.
  await conn.execute('UPDATE portal_accounts SET display_name=? WHERE id=?',
   ['Synthetic Guardian Renamed',guardianA.insertId]);
  // Allowed: move link from guardian A to another valid guardian B.
  await conn.execute(
   'UPDATE guardian_student_links SET guardian_account_id=? WHERE guardian_account_id=? AND student_id=?',
   [guardianB.insertId,guardianA.insertId,pupil.insertId]
  );
  const [validLink]=await conn.execute(
   'SELECT 1 AS present FROM guardian_student_links WHERE guardian_account_id=? AND student_id=?',
   [guardianB.insertId,pupil.insertId]
  );
  ensure(validLink.length===1,'valid_guardian_reassignment');
  await expectGuard(conn,
   'UPDATE portal_accounts SET role=?, student_id=? WHERE id=?',
   ['student',pupil2.insertId,guardianB.insertId],'reassigned_guardian_role_locked');
  const [oldLink]=await conn.execute(
   'SELECT 1 AS present FROM guardian_student_links WHERE guardian_account_id=?',
   [guardianA.insertId]
  );
  ensure(oldLink.length===0,'old_link_removed');
  // Unlinked guardian A should not be permanently blocked from role changes.
  await conn.execute('UPDATE portal_accounts SET role=?, student_id=? WHERE id=?',
   ['student',pupil2.insertId,guardianA.insertId]);
  const [changed]=await conn.execute('SELECT role FROM portal_accounts WHERE id=?',
   [guardianA.insertId]);
  ensure(changed.length===1&&changed[0].role==='student','unlinked_role_change_allowed');
 }finally{
  if(started)await conn.rollback();
 }
 await assertEmpty(conn);
 await checkTriggerSet(conn,3);
 return {database:LAB_DATABASE,guardian_triggers:3,
  student_link_insert_rejected:true,student_link_update_rejected:true,
  linked_guardian_role_change_rejected:true,valid_guardian_reassignment:true,
  unlinked_guardian_role_change_allowed:true,rollback_verified:true};
}
async function run({env=process.env,makePool=makeConnection,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  pool=await makePool({env});conn=await pool.getConnection();
  const result=await check(conn);
  log('STEP 7.6 TEST OK: link UPDATE and linked guardian role UPDATE rejected; valid edits passed.');
  log('ROLLBACK VERIFIED: all 63 laboratory tables remain empty.');
  log('LAB STATUS: '+JSON.stringify(result));
  log('KNOWN LIMIT: simultaneous role updates and new links are not yet concurrency-tested.');
  log('LIVE SYSTEM UNCHANGED: no D1 changes, student imports, or public Login APIs.');
  return 0;
 }catch(e){
  const message=String(e?.message||'');
  warn('STEP 7.6 TEST FAILED ('+(message.startsWith('lab_')?message:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.6 TEST FAILED (unknown).');process.exitCode=1;
});
module.exports={check,run,assertEmpty,expectGuard};
