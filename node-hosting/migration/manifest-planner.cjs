'use strict';
// RD CONNECT batch 2: READ-ONLY offline D1 JSONL manifest inspection and
// MariaDB schema dependency planning. Never executes INSERT, UPDATE, DELETE,
// DDL, SET FOREIGN_KEY_CHECKS or reads student values into logs.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const TABLES=63,FOREIGN_KEYS=119;
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const FORMAT='rd-connect-d1-jsonl-v1';
function need(cond,reason){if(!cond)throw Error('migration_'+reason)}
function validateManifest(obj){
 need(obj&&typeof obj==='object'&&!Array.isArray(obj),'manifest_invalid');
 need(obj.format===FORMAT&&obj.source==='trusted-local-wrangler-d1-sql',
  'manifest_source_invalid');
 need(obj.table_count===TABLES&&Array.isArray(obj.tables)&&obj.tables.length===TABLES,
  'manifest_table_count');
 const tableNames=new Set();
 let sum=0;
 for(const t of obj.tables){
  need(t&&typeof t==='object'&&NAME.test(t.name),'manifest_table_name');
  need(!tableNames.has(t.name),'manifest_duplicate_table');
  tableNames.add(t.name);
  need(t.file===t.name+'.jsonl','manifest_file_name');
  need(Number.isSafeInteger(t.rows)&&t.rows>=0,'manifest_row_count');
  need(HASH.test(t.sha256),'manifest_file_hash');
  need(Array.isArray(t.columns)&&t.columns.length>0,'manifest_columns');
  const cols=new Set(t.columns);
  need(cols.size===t.columns.length&&t.columns.every(c=>NAME.test(c)),
   'manifest_invalid_columns');
  sum+=t.rows;
  need(Number.isSafeInteger(sum),'manifest_rows_overflow');
 }
 need(obj.total_rows===sum,'manifest_total_mismatch');
 return {format:obj.format,table_count:TABLES,total_rows:sum,
  tables:obj.tables};
}
function loadManifest(file){
 need(typeof file==='string'&&file.trim().length>0,'manifest_path_required');
 const name=path.resolve(file);
 need(path.basename(name)==='manifest.json','manifest_file_name_invalid');
 const stats=fs.statSync(name);
 need(stats.isFile()&&stats.size>0&&stats.size<2097152,'manifest_file_size');
 const raw=JSON.parse(fs.readFileSync(name,'utf8'));
 return {base:path.dirname(name),manifest:validateManifest(raw)};
}
async function fileDigest(file){
 return new Promise((resolve,reject)=>{
  const h=createHash('sha256'),stream=fs.createReadStream(file);
  let rows=0,length=0;
  stream.on('data',buffer=>{
   h.update(buffer);length+=buffer.length;
   for(const byte of buffer)if(byte===10)rows++;
  });
  stream.on('error',reject);
  stream.on('end',()=>resolve({sha256:h.digest('hex'),rows,bytes:length}));
 });
}
async function checkFiles(base,manifest){
 let verified=0;
 for(const table of manifest.tables){
  const target=path.join(base,table.file);
  need(path.dirname(target)===base,'jsonl_path_escape');
  const stat=fs.lstatSync(target);
  need(stat.isFile()&&!stat.isSymbolicLink(),'jsonl_regular_file_required');
  const hash=await fileDigest(target);
  need(hash.sha256===table.sha256&&hash.rows===table.rows,
   'jsonl_digest_or_rows_mismatch');
  verified++;
 }
 return {verified_files:verified,verified_rows:manifest.total_rows};
}
function topology(tables,fks){
 const all=new Set(tables),indeg=new Map(),children=new Map();
 for(const t of tables){indeg.set(t,0);children.set(t,new Set())}
 for(const e of fks){
  const child=e.TABLE_NAME,parent=e.REFERENCED_TABLE_NAME;
  need(all.has(child)&&all.has(parent),'foreign_key_unknown_table');
  if(parent===child)continue; // self-link requires row-level ordering
  if(children.get(parent).has(child))continue;
  children.get(parent).add(child);
  indeg.set(child,indeg.get(child)+1);
 }
 const stages=[],done=new Set();
 for(let i=0;i<tables.length;i++){
  const ready=tables.filter(t=>!done.has(t)&&indeg.get(t)===0).sort();
  if(!ready.length)break;
  stages.push(ready);
  for(const t of ready){done.add(t);for(const child of children.get(t))indeg.set(child,indeg.get(child)-1)}
 }
 const blocked=tables.filter(t=>!done.has(t)).sort();
 return {stages,cyclic_or_blocked_tables:blocked};
}
function compareSchema(manifest,dbTables,columns,foreignKeys,foreignKeyCount){
 need(Array.isArray(dbTables)&&dbTables.length===TABLES,'target_table_count');
 need(Array.isArray(columns)&&columns.length>0,'target_columns_missing');
 need(Array.isArray(foreignKeys)&&foreignKeyCount===FOREIGN_KEYS,'target_fk_count');
 const sources=new Map(manifest.tables.map(t=>[t.name,t]));
 const targets=new Map(dbTables.map(t=>[t.TABLE_NAME,t]));
 need(targets.size===TABLES,'target_duplicate_names');
 for(const [name,table] of targets){
  need(sources.has(name),'source_table_missing');
  need(String(table.ENGINE).toUpperCase()==='INNODB','target_non_innodb');
 }
 const columnSet=new Map();
 for(const c of columns){
  if(!columnSet.has(c.TABLE_NAME))columnSet.set(c.TABLE_NAME,new Set());
  columnSet.get(c.TABLE_NAME).add(c.COLUMN_NAME);
 }
 for(const table of manifest.tables){
  const names=columnSet.get(table.name)||new Set();
  for(const col of table.columns)need(names.has(col),'target_column_missing');
 }
 return topology([...targets.keys()],foreignKeys);
}
module.exports={TABLES,FOREIGN_KEYS,FORMAT,validateManifest,loadManifest,
 fileDigest,checkFiles,topology,compareSchema};
