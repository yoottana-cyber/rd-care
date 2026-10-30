'use strict';
// Step 6.2: Read + transactional-write smoke-test of the EMPTY school MariaDB staging DB.
// NEVER a real login endpoint: it creates random credentials in memory only, then ROLLBACK.
// The database MUST be ratsadaa_connect, InnoDB, and contain no users/students/portal accounts.
// All SQL uses parameter binding. Never log credentials, IDs, user rows or SQL exceptions.
const {openPool}=require('../src/database.cjs');
const {category}=require('./check-db.cjs');
const {hashTemporaryPassword,matchesTemporaryPassword,createTemporaryCredentials}=require('../src/test-auth-crypto.cjs');
const EXPECTED_DB='ratsadaa_connect';
async function preflight(conn){
 const [dbRows]=await conn.execute('SELECT DATABASE() AS db');
 if(dbRows[0]?.db!==EXPECTED_DB)throw new Error('staging_database_required');
 const [engineRows]=await conn.execute("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','sessions','students','portal_accounts')");
 if(engineRows.length!==4||engineRows.some(row=>String(row.ENGINE).toUpperCase()!=='INNODB'))
  throw new Error('staging_innodb_required');
 for(const table of ['users','students','portal_accounts','sessions']){
  // The table name is taken from a hard-coded allowlist, never external input.
  const [rows]=await conn.execute('SELECT 1 FROM `'+table+'` LIMIT 1');
  if(rows.length)throw new Error('staging_database_not_empty');
 }
}
async function smokeTest(conn,{makeCredentials=createTemporaryCredentials,hash=hashTemporaryPassword,verify=matchesTemporaryPassword}={}){
 await preflight(conn);
 const credentials=makeCredentials();
 const hashed=await hash(credentials.password,credentials.salt);
 let transacting=false;
 try{
  await conn.beginTransaction();
  transacting=true;
  const [write]=await conn.execute(
   'INSERT INTO users (username,display_name,role,password_salt,password_hash,active) VALUES (?,?,?,?,?,1)',
   [credentials.username,'RD CONNECT isolated test','teacher',credentials.salt,hashed]
  );
  if(!Number.isSafeInteger(write.insertId)||write.insertId<=0)throw new Error('temporary_user_insert_failed');
  const [userRows]=await conn.execute(
   'SELECT id,role,password_salt,password_hash FROM users WHERE username=? AND active=1',
   [credentials.username]
  );
  if(userRows.length!==1||userRows[0].role!=='teacher')throw new Error('temporary_user_lookup_failed');
  if(!await verify(credentials.password,userRows[0].password_salt,userRows[0].password_hash))
   throw new Error('temporary_password_match_failed');
  if(await verify('incorrect-test-password-never-authenticate',userRows[0].password_salt,userRows[0].password_hash))
   throw new Error('temporary_password_rejection_failed');
  const expires=Math.floor(Date.now()/1000)+600;
  await conn.execute('INSERT INTO sessions (token_hash,user_id,expires_at,remember_device) VALUES (?,?,?,0)',
   [credentials.tokenHash,write.insertId,expires]);
  const [sessionRows]=await conn.execute(
   'SELECT user_id FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
   [credentials.tokenHash,write.insertId,Math.floor(Date.now()/1000)]
  );
  if(sessionRows.length!==1)throw new Error('temporary_session_lookup_failed');
 }finally{
  if(transacting)await conn.rollback();
 }
 const [accountLeft]=await conn.execute('SELECT 1 FROM users WHERE username=? LIMIT 1',[credentials.username]);
 const [sessionLeft]=await conn.execute('SELECT 1 FROM sessions WHERE token_hash=? LIMIT 1',[credentials.tokenHash]);
 if(accountLeft.length||sessionLeft.length)throw new Error('temporary_data_rollback_failed');
 return true;
}
function safeCategory(e){
 if(/^staging_/.test(String(e?.message||'')))return e.message;
 return category(e);
}
async function run({makePool=openPool,log=console.log,warn=console.error,makeCredentials,hash,verify}={}){
 let pool,conn;
 try{
  pool=makePool(process.env);
  conn=await pool.getConnection();
  await smokeTest(conn,{makeCredentials,hash,verify});
  log('STEP 6.2 OK: temporary user, password verification, and session round-trip worked.');
  log('ROLLBACK VERIFIED: temporary user and session are not stored. Existing D1/PWA unchanged.');
  log('NOT A LIVE LOGIN: no public login API or real account migration is enabled.');
  return 0;
 }catch(e){
  warn('STEP 6.2 FAILED ('+safeCategory(e)+').');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{console.error('STEP 6.2 FAILED (unknown).');process.exitCode=1});
module.exports={preflight,smokeTest,safeCategory,run};
