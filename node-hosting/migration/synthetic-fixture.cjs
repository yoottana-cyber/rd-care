'use strict';
// Generates synthetic-only JSONL outside Git and webroot using READ-ONLY staging metadata.
// It does NOT read any school records, connect to D1, create DB rows or send Push.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {SOURCE}=require('./synthetic-manifest.cjs');
const {FORMAT}=require('./manifest-planner.cjs');
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const USER_FIELDS=['username','display_name','role','password_salt','password_hash','active'];
function need(ok,reason){if(!ok)throw Error('migration_'+reason)}
function safeLocation(dir){
 const resolved=path.resolve(dir);
 const segments=resolved.split(path.sep).map(p=>p.toLowerCase());
 need(!segments.some(x=>['public_html','htdocs','wwwroot','www'].includes(x)),
  'fixture_inside_webroot');
 for(let current=resolved; ;current=path.dirname(current)){
  need(!fs.existsSync(path.join(current,'.git')),'fixture_inside_git');
  if(current===path.dirname(current))break;
 }
 need(!fs.existsSync(resolved),'fixture_already_exists');
 need(fs.existsSync(path.dirname(resolved)),'fixture_parent_missing');
 return resolved;
}
function createModel(tables,metadata,{nonce=randomBytes(8).toString('hex')}={}){
 need(Array.isArray(tables)&&tables.length===63,'fixture_table_count');
 need(Array.isArray(metadata),'fixture_columns_missing');
 const byTable=new Map();
 for(const c of metadata){
  if(!byTable.has(c.TABLE_NAME))byTable.set(c.TABLE_NAME,[]);
  if(!/GENERATED/i.test(String(c.EXTRA||''))&&NAME.test(c.COLUMN_NAME))
   byTable.get(c.TABLE_NAME).push(c.COLUMN_NAME);
 }
 const tableNames=new Set();
 const records=[];
 for(const table of [...tables].sort((a,b)=>a.TABLE_NAME.localeCompare(b.TABLE_NAME,'en'))){
  const name=table.TABLE_NAME;
  need(NAME.test(name)&&!tableNames.has(name),'fixture_table_name_invalid');
  tableNames.add(name);
  const options=byTable.get(name)||[];
  need(options.length>0,'fixture_no_writable_columns');
  const columns=name==='users'?USER_FIELDS:[options[0]];
  need(columns.every(c=>options.includes(c)),'fixture_users_columns_mismatch');
  const sample=name==='users'?{
   username:'rd_fixture_'+nonce,
   display_name:'Synthetic Migration Only',
   role:'teacher',
   password_salt:'fixture-salt-invalid',
   password_hash:'fixture-hash-invalid',
   active:0
  }:null;
  records.push({name,file:name+'.jsonl',columns,
   rows:sample?1:0,contents:sample?JSON.stringify(sample)+'\n':''});
 }
 need(tableNames.has('users'),'fixture_users_missing');
 return records;
}
function writeFixture(dir,model){
 const output=safeLocation(dir);
 let created=false;
 try{
  fs.mkdirSync(output,{mode:0o700});created=true;
  let total=0;
  const tables=[];
  for(const record of model){
   const bytes=Buffer.from(record.contents,'utf8');
   fs.writeFileSync(path.join(output,record.file),bytes,{flag:'wx',mode:0o600});
   tables.push({
    name:record.name,file:record.file,columns:record.columns,
    rows:record.rows,sha256:createHash('sha256').update(bytes).digest('hex')
   });
   total+=record.rows;
  }
  const manifest={format:FORMAT,source:SOURCE,table_count:tables.length,
   total_rows:total,tables};
  fs.writeFileSync(path.join(output,'manifest.json'),
   JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {manifestPath:path.join(output,'manifest.json'),
   tables:tables.length,rows:total};
 }catch(error){
  if(created)fs.rmSync(output,{force:true,recursive:true});
  throw error;
 }
}
function defaultLocation(home=os.homedir()){
 return path.join(home,'.rd-connect-stage12-synthetic-'+randomBytes(5).toString('hex'));
}
module.exports={USER_FIELDS,createModel,writeFixture,defaultLocation,safeLocation};
