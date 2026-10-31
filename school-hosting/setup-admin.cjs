'use strict';
// Offline one-time school administrator creation on the LOCAL DB.
// No setup token or public /api/setup route is needed. Credentials are
// read from temporary DirectAdmin ENV and never logged or committed.
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {openLocalD1}=require('./d1-sqlite.cjs');
const {verifyReady,WEB_ROOT}=require('./server.cjs');
const CONFIRM='CREATE_FIRST_SCHOOL_ADMIN';
async function run({env=process.env,log=console.log}={}){
 if(env.RD_SCHOOL_ADMIN_CONFIRM!==CONFIRM)
  throw Error('school_admin_confirmation_required');
 const username=String(env.RD_SETUP_USERNAME||'').trim().toLowerCase();
 const name=String(env.RD_SETUP_DISPLAY_NAME||'').trim();
 const password=env.RD_SETUP_PASSWORD;
 if(!/^[a-z0-9._-]{3,40}$/.test(username)||
  !name||name.length>100||typeof password!=='string'||
  password.length<12||password.length>128)
  throw Error('school_admin_invalid_account_input');
 const db=openLocalD1({filename:env.RD_SQLITE_FILE,webRoot:WEB_ROOT});
 try{
  verifyReady(db);
  const passwordLib=await import(pathToFileURL(
   path.resolve(__dirname,'../worker/src/password.js')).href);
  const salt=passwordLib.newPasswordSalt();
  const hash=await passwordLib.passwordHash(password,salt);
  db.sqlite.exec('BEGIN IMMEDIATE');
  try{
   if(db.sqlite.prepare('SELECT 1 AS found FROM users LIMIT 1').get())
    throw Error('school_admin_already_initialized');
   const result=db.sqlite.prepare(
    "INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,'admin',?,?,1)")
    .run(username,name,salt,hash);
   db.sqlite.prepare(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES(?,'initial_setup','users',?)")
    .run(result.lastInsertRowid,String(result.lastInsertRowid));
   db.sqlite.exec('COMMIT');
  }catch(e){
   try{db.sqlite.exec('ROLLBACK')}catch{}
   throw e;
  }
  log('SCHOOL INITIAL ADMIN CREATED: one active administrator; no credentials printed.');
  log('REMOVE RD_SETUP_PASSWORD, RD_SETUP_USERNAME, RD_SETUP_DISPLAY_NAME AND RD_SCHOOL_ADMIN_CONFIRM NOW.');
  return {created:true};
 }finally{db.close()}
}
if(require.main===module)run().catch(e=>{
 const msg=String(e?.message||'');
 console.error('SCHOOL ADMIN SETUP BLOCKED ('+
  (/^school_[a-z0-9_]+$/.test(msg)?msg:'setup_failed')+').');
 process.exitCode=1;
});
module.exports={CONFIRM,run};
