'use strict';
// Stage 7.5 integration test: a synthetic teacher, pupil, guardian and student
// account are created and tested inside an InnoDB transaction, then ROLLBACK.
// NEVER authenticate real users. NEVER touch ratsadaa_connect.
const {randomBytes}=require('node:crypto');
const {category}=require('./check-db.cjs');
const {labTriggerMetadata,makeConnection,labEmptyAccounts}=require('../src/lab-guardian-guard.cjs');
const {LAB_DATABASE}=require('./check-trigger-lab.cjs');
const name=prefix=>prefix+'_'+randomBytes(12).toString('hex');
function ensure(value,key){if(!value)throw Error('lab_test_'+key)}
async function check(conn){
 await labTriggerMetadata(conn,1);
 const [[{n:tables}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
 );
 const [[{n:fks}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY'"
 );
 if(Number(tables)!==63||Number(fks)!==119)throw Error('lab_schema_mismatch');
 await labEmptyAccounts(conn);
 const teacherName=name('labt');
 const pupilNo=name('labp');
 const guardianName=name('labg'),studentName=name('labs');
 const label=name('LAB');
 let inTransaction=false;
 try{
  await conn.beginTransaction();inTransaction=true;
  const [teacher]=await conn.execute(
   "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,'teacher',?,?,1)",
   [teacherName,'Synthetic Lab Teacher','not-a-password','not-a-hash']
  );
  const [room]=await conn.execute(
   'INSERT INTO classrooms(grade,room,label,advisor_user_id) VALUES(1,1,?,?)',
   [label,teacher.insertId]
  );
  const [pupil]=await conn.execute(
   'INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES(?,?,1,?,1)',
   [pupilNo,room.insertId,'Synthetic Lab Pupil']
  );
  const [student]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES(?,?,'student',?,?,?,1,?)",
   [studentName,'Synthetic Lab Student',pupil.insertId,'fake-salt','fake-hash',teacher.insertId]
  );
  const [guardian]=await conn.execute(
   "INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,active,created_by) VALUES(?,?,'guardian',NULL,?,?,1,?)",
   [guardianName,'Synthetic Lab Guardian','fake-salt','fake-hash',teacher.insertId]
  );
  // An existing student account satisfies FK, so only the new trigger may
  // reject this invalid parent role.
  let invalidRejected=false;
  try{
   await conn.execute(
    'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES (?,?,?)',
    [student.insertId,pupil.insertId,teacher.insertId]
   );
  }catch(e){
   invalidRejected=e?.sqlState==='45000'||e?.errno===1644;
   if(!invalidRejected)throw e;
  }
  ensure(invalidRejected,'student_link_was_not_rejected');
  await conn.execute(
   'INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES (?,?,?)',
   [guardian.insertId,pupil.insertId,teacher.insertId]
  );
  const [links]=await conn.execute(
   'SELECT 1 AS present FROM guardian_student_links WHERE guardian_account_id=? AND student_id=?',
   [guardian.insertId,pupil.insertId]
  );
  ensure(links.length===1,'guardian_link_failed');
 }finally{
  if(inTransaction)await conn.rollback();
 }
 await labEmptyAccounts(conn);
 await labTriggerMetadata(conn,1);
 return {database:LAB_DATABASE,installed_guardian_triggers:1,student_role_rejected:true,
  guardian_role_accepted:true,temporary_data_rolled_back:true};
}
async function run({makePool=makeConnection,env=process.env,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  pool=await makePool({env});
  conn=await pool.getConnection();
  const result=await check(conn);
  log('STEP 7.5 TEST OK: actual MariaDB guardian INSERT trigger rejected student account and accepted guardian.');
  log('ROLLBACK VERIFIED: no synthetic teacher, classroom, pupil or portal records remain.');
  log('LAB STATUS: '+JSON.stringify(result));
  log('KNOWN GAP: guardian-link UPDATE and portal role changes are not protected by this single trigger.');
  log('LIVE APP UNCHANGED: login remains disabled and school D1 is untouched.');
  return 0;
 }catch(e){
  const message=String(e?.message||'');
  warn('STEP 7.5 TEST FAILED ('+(message.startsWith('lab_')?message:category(e))+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.5 TEST FAILED (unknown).');process.exitCode=1;
});
module.exports={check,run};
