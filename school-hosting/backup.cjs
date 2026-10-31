'use strict';
// Consistent private SQLite snapshot of a running WAL database.
// NO live data is printed. Backup remains on school-owned private filesystem.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {backup,DatabaseSync}=require('node:sqlite');
const {openLocalD1,privateDbPath}=require('./d1-sqlite.cjs');
const WEB_ROOT=path.resolve(__dirname,'../web');
function backupRoot(env){
 const folder=env.RD_SQLITE_BACKUP_DIR;
 if(typeof folder!=='string'||!path.isAbsolute(folder))
  throw Error('school_backup_absolute_directory_required');
 const dir=path.resolve(folder);
 if(dir.includes('public_html')||dir===WEB_ROOT||dir.startsWith(WEB_ROOT+path.sep))
  throw Error('school_backup_must_be_private');
 if(!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink()||
  !fs.statSync(dir).isDirectory())throw Error('school_backup_directory_missing');
 return dir;
}
async function run({env=process.env,log=console.log}={}){
 const filepath=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 const dir=backupRoot(env);
 if(path.dirname(filepath)===dir)throw Error('school_backup_must_use_separate_directory');
 const src=openLocalD1({filename:filepath,webRoot:WEB_ROOT,readonly:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const name='rd-connect-'+stamp+'-'+crypto.randomBytes(5).toString('hex')+'.sqlite';
 const target=path.join(dir,name);
 try{
  await backup(src.sqlite,target);
  fs.chmodSync(target,0o600);
  const check=new DatabaseSync(target,{readOnly:true,allowExtension:false});
  try{
   if(check.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
    throw Error('school_backup_integrity_failed');
   if(check.prepare('PRAGMA foreign_key_check').all().length)
    throw Error('school_backup_foreign_keys_failed');
  }finally{check.close()}
  log('SCHOOL SQLITE BACKUP VERIFIED: '+name);
  log('SOURCE UNCHANGED / NO RECORDS EXPORTED OVER NETWORK.');
  return {file:target};
 }catch(e){
  try{fs.unlinkSync(target)}catch{}
  throw e;
 }finally{src.close()}
}
if(require.main===module)run().catch(e=>{
 const msg=String(e?.message||'');
 console.error('SCHOOL BACKUP BLOCKED ('+
  (/^school_[a-z0-9_]+$/.test(msg)?msg:'backup_failed')+').');
 process.exitCode=1;
});
module.exports={backupRoot,run};
