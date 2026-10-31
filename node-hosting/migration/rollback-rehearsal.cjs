'use strict';
// RD CONNECT migration: private, rollback-only MariaDB staging replay.
// No D1 connection, public route, schema change, COMMIT or foreign-key bypass.
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const {NAME}=require('./safe-rehearsal-constants.cjs');

function need(ok,why){if(!ok)throw Error('migration_'+why)}
function decodeCell(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){
  need(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)),
   'unsafe_json_number');
  return value;
 }
 need(value&&typeof value==='object'&&!Array.isArray(value),
  'unsupported_json_cell');
 const keys=Object.keys(value);
 need(keys.length===1&&keys[0]==='$binary_base64'&&
  typeof value.$binary_base64==='string','unsupported_json_cell');
 const b64=value.$binary_base64;
 need(b64.length<=16*1024*1024&&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64),
  'invalid_binary_encoding');
 const bytes=Buffer.from(b64,'base64');
 need(bytes.toString('base64')===b64,'invalid_binary_encoding');
 return bytes;
}
function rowValues(line,columns){
 let value;
 try{value=JSON.parse(line)}catch{throw Error('migration_invalid_jsonl')}
 need(value&&typeof value==='object'&&!Array.isArray(value),
  'jsonl_record_not_object');
 const keys=Object.keys(value);
 need(keys.length===columns.length&&
  keys.every(k=>columns.includes(k)),'jsonl_columns_mismatch');
 return columns.map(col=>decodeCell(value[col]));
}
async function* readRows(base,table){
 need(NAME.test(table.name)&&table.file===table.name+'.jsonl',
  'jsonl_path_invalid');
 const filename=path.resolve(base,table.file);
 need(path.dirname(filename)===path.resolve(base),'jsonl_path_invalid');
 const stat=fs.lstatSync(filename);
 need(stat.isFile()&&!stat.isSymbolicLink(),'jsonl_not_regular');
 const input=fs.createReadStream(filename,{encoding:'utf8'});
 const lines=readline.createInterface({input,crlfDelay:Infinity});
 let count=0;
 try{
  for await(const line of lines){
   need(Buffer.byteLength(line,'utf8')<=8*1024*1024,'jsonl_line_too_large');
   need(line.length>0,'jsonl_blank_line');
   ++count;
   need(count<=table.rows,'jsonl_rows_mismatch');
   yield rowValues(line,table.columns);
  }
 }finally{lines.close();input.destroy()}
 need(count===table.rows,'jsonl_rows_mismatch');
}
function sqlFor(table,rowCount){
 need(NAME.test(table.name)&&table.columns.every(c=>NAME.test(c)),
  'sql_identifier_invalid');
 const cols=table.columns.map(c=>'`'+c+'`').join(',');
 const row='('+table.columns.map(()=>'?').join(',')+')';
 return 'INSERT INTO `'+table.name+'` ('+cols+') VALUES '+
  Array(rowCount).fill(row).join(',');
}
async function replay(conn,base,manifest,plan,{batchSize=25}={}){
 need(Number.isSafeInteger(batchSize)&&batchSize>=1&&batchSize<=50,
  'batch_size_invalid');
 need(plan&&Array.isArray(plan.stages)&&
  Array.isArray(plan.cyclic_or_blocked_tables)&&
  plan.cyclic_or_blocked_tables.length===0,'fk_cycle_blocked');
 const tables=new Map(manifest.tables.map(t=>[t.name,t]));
 const visited=new Set();
 let inserted=0;
 for(const stage of plan.stages){
  need(Array.isArray(stage),'fk_stage_invalid');
  for(const name of stage){
   need(tables.has(name)&&!visited.has(name),'fk_stage_invalid');
   visited.add(name);
   const table=tables.get(name);
   let chunk=[];
   const flush=async()=>{
    if(!chunk.length)return;
    await conn.execute(sqlFor(table,chunk.length),chunk.flat());
    inserted+=chunk.length;
    chunk=[];
   };
   for await(const values of readRows(base,table)){
    chunk.push(values);
    if(chunk.length===batchSize)await flush();
   }
   await flush();
  }
 }
 need(visited.size===tables.size&&inserted===manifest.total_rows,
  'import_inventory_incomplete');
 return {tables:visited.size,rows:inserted};
}
module.exports={decodeCell,rowValues,readRows,sqlFor,replay};
