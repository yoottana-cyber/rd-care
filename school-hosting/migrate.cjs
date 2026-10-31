'use strict';
// Offline one-command deployment schema installer for the SELF-HOSTED SQLite
// database. Runs the EXACT Worker migrations in filename order.
// Does not read Cloudflare D1, use MariaDB, import students or start a server.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {privateDbPath}=require('./d1-sqlite.cjs');
const ROOT=path.resolve(__dirname,'..');
const MIGRATIONS=path.join(ROOT,'worker','migrations');
const WEB_ROOT=path.join(ROOT,'web');
const CONFIRM='INITIALIZE_PRIVATE_SCHOOL_SQLITE';
function fileSet(root=MIGRATIONS){
 const names=fs.readdirSync(root).filter(n=>/^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
 if(!names.length||new Set(names).size!==names.length)throw Error('school_migrations_missing');
 return names.map(name=>{
  const content=fs.readFileSync(path.join(root,name),'utf8');
  return {name,content,sha:crypto.createHash('sha256').update(content).digest('hex')};
 });
}
function migrate({filename,webRoot=WEB_ROOT,root=MIGRATIONS,confirm,log=console.log}={}){
 if(confirm!==CONFIRM)throw Error('school_init_explicit_confirmation_required');
 const target=privateDbPath(filename,webRoot);
 const names=fileSet(root);
 const existed=fs.existsSync(target);
 if(existed&&(fs.statSync(target).mode&0o077)!==0)
  throw Error('school_database_permissions_insecure');
 if(!existed){
  const fd=fs.openSync(target,'wx',0o600);
  fs.closeSync(fd);
 }
 let db;
 try{
  db=new DatabaseSync(target,{allowExtension:false});
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const mode=db.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode;
  if(String(mode).toLowerCase()!=='wal')throw Error('school_wal_unavailable');
  db.exec('PRAGMA synchronous=FULL');
  // An existing DB with unknown schema must never be automatically "upgraded".
  const history=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school_schema_migrations'").get();
  if(existed&&!history)throw Error('school_existing_database_without_migration_ledger');
  if(!history){
   db.exec(`CREATE TABLE school_schema_migrations (
    filename TEXT PRIMARY KEY, sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  }
  const old=db.prepare('SELECT filename,sha256 FROM school_schema_migrations').all();
  const hashes=new Map(old.map(r=>[r.filename,r.sha256]));
  for(const previous of old)
   if(!names.some(n=>n.name===previous.filename))throw Error('school_migration_file_removed');
  for(const item of names){
   if(hashes.has(item.name)){
    if(hashes.get(item.name)!==item.sha)throw Error('school_migration_checksum_mismatch');
    continue;
   }
   db.exec('BEGIN IMMEDIATE');
   try{
    db.exec(item.content);
    db.prepare('INSERT INTO school_schema_migrations(filename,sha256) VALUES(?,?)')
     .run(item.name,item.sha);
    db.exec('COMMIT');
   }catch(e){
    try{db.exec('ROLLBACK')}catch{}
    throw Error('school_migration_failed_'+item.name.replace('.sql',''));
   }
  }
  // One-time 48-classroom catalog from the original D1 deployment.
  // Do NOT seed demo students, overwrite a school catalog or change advisors.
  const roomCount=db.prepare('SELECT COUNT(*) AS n FROM classrooms').get()?.n;
  if(roomCount===0){
   const seed=fs.readFileSync(path.join(ROOT,'worker','classrooms_only.sql'),'utf8');
   db.exec('BEGIN IMMEDIATE');
   try{
    db.exec(seed);
    if(Number(db.prepare('SELECT COUNT(*) AS n FROM classrooms').get()?.n)!==48)
     throw Error('school_room_seed_incomplete');
    db.exec('COMMIT');
   }catch(e){try{db.exec('ROLLBACK')}catch{}throw e}
  }
  const count=db.prepare('SELECT count(*) AS n FROM school_schema_migrations').get();
  if(Number(count.n)!==names.length)throw Error('school_migration_count_mismatch');
  const state=db.prepare('PRAGMA integrity_check').get();
  if(state.integrity_check!=='ok')throw Error('school_database_integrity_check_failed');
  const fk=db.prepare('PRAGMA foreign_key_check').all();
  if(fk.length)throw Error('school_foreign_key_check_failed');
  log('SCHOOL SQLITE SCHEMA READY: '+names.length+' original Worker migrations verified.');
  log('DATABASE INTEGRITY: OK; FOREIGN KEYS: OK; WAL: ON.');
  log('NO D1 REMOTE ACCESS / NO REAL STUDENT IMPORT / NO PUBLIC API ENABLED BY THIS COMMAND.');
  return {migrations:names.length,integrity:true};
 }finally{if(db)db.close()}
}
if(require.main===module){
 try{migrate({filename:process.env.RD_SQLITE_FILE,
  confirm:process.env.RD_SCHOOL_INIT_CONFIRM})}
 catch(e){const msg=String(e?.message||'');
  const allowed=/^school_[a-z0-9_]+$/;
  console.error('SCHOOL SQLITE INIT BLOCKED ('+(allowed.test(msg)?msg:'migration_or_sqlite_error')+').');
  process.exitCode=1;
 }
}
module.exports={CONFIRM,fileSet,migrate};
