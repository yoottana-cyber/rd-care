'use strict';
// Native SQLite 3 adapter for the existing Cloudflare D1 Worker.
// This preserves the Worker API and original SQLite migrations; it is NOT
// MariaDB, and deliberately cannot access Cloudflare's remote D1 database.
// Node.js >=24, server-local private DB file, one open connection per process.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');

function privateDbPath(filename,webRoot){
 if(typeof filename!=='string'||!path.isAbsolute(filename))
  throw Error('school_database_absolute_path_required');
 const resolved=path.resolve(filename);
 if(!resolved.endsWith('.sqlite')&&!resolved.endsWith('.db'))
  throw Error('school_database_extension_required');
 const publicRoot=path.resolve(webRoot);
 if(resolved===publicRoot||resolved.startsWith(publicRoot+path.sep))
  throw Error('school_database_must_be_outside_webroot');
 if(resolved.split(path.sep).some(part=>part==='public_html'))
  throw Error('school_database_must_be_private');
 if(fs.existsSync(resolved)&&fs.lstatSync(resolved).isSymbolicLink())
  throw Error('school_database_symlink_blocked');
 const dir=path.dirname(resolved);
 if(!fs.existsSync(dir))throw Error('school_database_parent_missing');
 if(fs.lstatSync(dir).isSymbolicLink())throw Error('school_database_parent_symlink_blocked');
 const realDir=fs.realpathSync(dir);
 if(realDir.split(path.sep).some(part=>part==='public_html')||
  realDir===publicRoot||realDir.startsWith(publicRoot+path.sep))
  throw Error('school_database_real_path_not_private');
 return resolved;
}
function plain(row){
 if(row==null)return null;
 // sqlite returns null-prototype rows. Preserve numeric/boolean values and
 // only plain JSON data in D1-like results, never a mutable SQLite row object.
 return Object.fromEntries(Object.entries(row).map(([key,value])=>
  [key,typeof value==='bigint'?Number(value):value]));
}
function d1Value(v){
 if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='bigint')return v;
 if(typeof v==='boolean')return v?1:0;
 if(v instanceof Uint8Array)return Buffer.from(v);
 if(v instanceof ArrayBuffer)return Buffer.from(v);
 throw Error('unsupported_d1_bound_value');
}
function isRead(sql){
 return /^\s*(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)||
  /^\s*WITH\b/i.test(sql);
}
class D1Prepared{
 constructor(db,sql,params=[]){
  if(typeof sql!=='string'||!sql.trim())throw Error('d1_sql_required');
  this.db=db;this.sql=sql;this.params=params;
 }
 bind(...values){return new D1Prepared(this.db,this.sql,values.map(d1Value))}
 _statement(){return this.db.prepare(this.sql)}
 async first(column){
  const value=plain(this._statement().get(...this.params));
  if(column===undefined)return value;
  if(typeof column!=='string'||!column)throw Error('invalid_d1_column');
  if(value===null)return null;
  if(!(column in value))throw Error('unknown_d1_column');
  return value[column];
 }
 _allSync(){
  return {success:true,results:this._statement().all(...this.params).map(plain),
   meta:{served_by:'school-sqlite'}};
 }
 async all(){return this._allSync()}
 _runSync(){
  const state=this._statement().run(...this.params);
  return {success:true,meta:{
   changes:Number(state.changes),
   last_row_id:Number(state.lastInsertRowid),
   served_by:'school-sqlite'
  }};
 }
 async run(){return this._runSync()}
 async raw({columnNames=false}={}){
  const stmt=this._statement();
  const columns=stmt.columns().map(x=>x.name);
  const rows=stmt.all(...this.params).map(item=>columns.map(col=>plain(item)[col]));
  return columnNames?[columns,...rows]:rows;
 }
}
class SchoolD1{
 constructor(sqlite){this.sqlite=sqlite}
 prepare(sql){return new D1Prepared(this.sqlite,sql)}
 async batch(statements){
  if(!Array.isArray(statements)||statements.length===0||
   statements.some(s=>!(s instanceof D1Prepared)||s.db!==this.sqlite))
   throw Error('invalid_d1_batch');
  this.sqlite.exec('BEGIN IMMEDIATE');
  try{
   const results=[];
   for(const s of statements)
    results.push(s._statement().columns().length?s._allSync():s._runSync());
   this.sqlite.exec('COMMIT');
   return results;
  }catch(e){
   try{this.sqlite.exec('ROLLBACK')}catch{}
   throw e;
  }
 }
 async exec(sql){
  this.sqlite.exec(sql);
  return {success:true};
 }
 close(){this.sqlite.close()}
}
function openLocalD1({filename,webRoot,readonly=false}){
 const file=privateDbPath(filename,webRoot);
 if(!readonly&& !fs.existsSync(file))
  throw Error('school_database_not_initialized');
 const sqlite=new DatabaseSync(file,{readOnly:readonly,allowExtension:false});
 // SQLite foreign-key integrity and cross-process waiting are mandatory.
 sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec('PRAGMA busy_timeout=5000');
 if(!readonly){
  const value=sqlite.prepare('PRAGMA journal_mode=WAL').get();
  if(String(value?.journal_mode||'').toLowerCase()!=='wal'){
   sqlite.close();
   throw Error('school_database_wal_unavailable');
  }
  sqlite.exec('PRAGMA synchronous=FULL');
 }
 return new SchoolD1(sqlite);
}
module.exports={D1Prepared,SchoolD1,privateDbPath,openLocalD1,plain,isRead,d1Value};
