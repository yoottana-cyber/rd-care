'use strict';
// RD CONNECT: NON-DESTRUCTIVE backup restore rehearsal.
// Restores a verified school backup to a private *temporary copy* in the
// backup directory. NEVER opens the live DB writable or overwrites it.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {backupRoot}=require('./backup.cjs');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {verifyReady,WEB_ROOT}=require('./server.cjs');
const TABLES=Object.freeze([
 'classrooms','users','students','student_enrollments',
 'attendance_daily','attendance_period','portal_accounts',
 'guardian_student_links','behavior_records'
]);
const BACKUP_FILE=/^rd-connect-\d{4}-\d\d-\d\dT[0-9TZ-]+-[a-f0-9]{10}\.sqlite$/;
function latestBackup(directory){
 const files=fs.readdirSync(directory,{withFileTypes:true})
  .filter(x=>x.isFile()&&BACKUP_FILE.test(x.name))
  .map(x=>{
   const file=path.join(directory,x.name),stat=fs.lstatSync(file);
   if(stat.isSymbolicLink()||stat.size<1024||stat.mode&0o077)
    throw Error('school_backup_file_insecure');
   return {file,name:x.name,mtimeMs:stat.mtimeMs,size:stat.size};
  })
  .sort((a,b)=>b.mtimeMs-a.mtimeMs);
 if(!files.length)throw Error('school_backup_not_found');
 return files[0];
}
function snapshot(db){
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
  throw Error('school_restore_integrity_failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)
  throw Error('school_restore_foreign_keys_failed');
 return Object.fromEntries(TABLES.map(name=>[
  name,Number(db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n)
 ]));
}
async function run({env=process.env,backupFile=null,log=console.log}={}){
 const source=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 if(!fs.existsSync(source))throw Error('school_live_database_missing');
 const directory=backupRoot(env);
 if(path.resolve(source).startsWith(directory+path.sep))
  throw Error('school_backup_cannot_include_live_database');
 let backup=latestBackup(directory);
 if(backupFile){
  // Only accept a real private backup in the configured backup directory.
  if(typeof backupFile!=='string'||path.dirname(path.resolve(backupFile))!==directory||
   !BACKUP_FILE.test(path.basename(backupFile)))
   throw Error('school_restore_invalid_backup_selection');
  const file=path.resolve(backupFile);
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1024||stat.mode&0o077)
   throw Error('school_backup_file_insecure');
  backup={file,name:path.basename(file),mtimeMs:stat.mtimeMs,size:stat.size};
 }
 if(fs.realpathSync(source)===fs.realpathSync(backup.file))
  throw Error('school_backup_equals_live_database');
 const destinationDir=fs.mkdtempSync(path.join(directory,'.rd-restore-check-'));
 fs.chmodSync(destinationDir,0o700);
 const restored=path.join(destinationDir,'restored.sqlite');
 let original,copy;
 try{
  fs.copyFileSync(backup.file,restored,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(restored,0o600);
  original=new DatabaseSync(backup.file,{readOnly:true,allowExtension:false});
  copy=new DatabaseSync(restored,{readOnly:true,allowExtension:false});
  const baseline=snapshot(original);
  const restoredCounts=snapshot(copy);
  verifyReady({sqlite:copy});
  for(const table of TABLES)
   if(baseline[table]!==restoredCounts[table])
    throw Error('school_restore_counts_mismatch');
  if(Number(copy.prepare('SELECT COUNT(*) AS n FROM classrooms').get().n)!==48)
   throw Error('school_restore_classroom_count_mismatch');
  // Backup cannot change while copying/checking (guards against simultaneous
  // rotations); read-only live source is never opened and no import is run.
  const stat=fs.statSync(backup.file);
  if(stat.size!==backup.size||stat.mtimeMs!==backup.mtimeMs)
   throw Error('school_backup_changed_during_check');
  log('SCHOOL BACKUP RESTORE TEST PASS: latest private backup restored to isolated temporary copy.');
  log('SCHEMA CHECKSUMS / INTEGRITY / FOREIGN KEYS / 48 CLASSROOMS / ROW COUNTS: OK.');
  log('LIVE SCHOOL DATABASE UNTOUCHED; TEMPORARY COPY REMOVED; NO REAL PUSH OR IMPORT.');
  return {ok:true};
 }finally{
  try{copy?.close()}catch{}
  try{original?.close()}catch{}
  fs.rmSync(destinationDir,{recursive:true,force:true});
 }
}
if(require.main===module)run().catch(err=>{
 const code=String(err?.message||'');
 console.error('SCHOOL RESTORE TEST BLOCKED ('+
  (/^school_[a-z0-9_]+$/.test(code)?code:'restore_verification_failed')+').');
 process.exitCode=1;
});
module.exports={TABLES,BACKUP_FILE,latestBackup,snapshot,run};
