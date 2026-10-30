'use strict';
// RD CONNECT Batch 2 — read-only post-import structural reconciliation.
// No row-level values, names, passwords, attendance or scores leave this module.
// Count parity + FK orphan checks are necessary but NOT sufficient for data parity.
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function need(v,k){if(!v)throw Error('migration_'+k)}
const q=n=>{need(typeof n==='string'&&NAME.test(n),'identifier_invalid');return '`'+n+'`'};
function groupFk(rows){
 const groups=new Map();
 for(const r of rows){
  need(r&&r.REFERENCED_TABLE_NAME&&NAME.test(r.TABLE_NAME)&&
   NAME.test(r.REFERENCED_TABLE_NAME)&&NAME.test(r.COLUMN_NAME)&&
   NAME.test(r.REFERENCED_COLUMN_NAME),'foreign_key_invalid');
  const k=r.TABLE_NAME+'/'+String(r.CONSTRAINT_NAME);
  if(!groups.has(k))groups.set(k,{child:r.TABLE_NAME,parent:r.REFERENCED_TABLE_NAME,columns:[]});
  const group=groups.get(k);
  need(group.parent===r.REFERENCED_TABLE_NAME,'foreign_key_mismatch');
  group.columns.push({child:r.COLUMN_NAME,parent:r.REFERENCED_COLUMN_NAME,
   position:Number(r.ORDINAL_POSITION)});
 }
 return [...groups.values()];
}
async function countParity(conn,manifest){
 let total=0,mismatches=0;
 for(const table of manifest.tables){
  const [[count]]=await conn.execute('SELECT COUNT(*) AS n FROM '+q(table.name));
  const rows=Number(count?.n);
  need(Number.isSafeInteger(rows)&&rows>=0,'count_invalid');
  total+=rows;
  if(rows!==table.rows)mismatches++;
 }
 return {tables_checked:manifest.tables.length,total_rows:total,
  expected_rows:manifest.total_rows,mismatched_tables:mismatches};
}
async function fkOrphans(conn,constraints){
 let invalid=0;
 for(const group of constraints){
  const columns=group.columns.sort((a,b)=>a.position-b.position);
  const joined=columns.map(c=>'c.'+q(c.child)+'=p.'+q(c.parent)).join(' AND ');
  const present=columns.map(c=>'c.'+q(c.child)+' IS NOT NULL').join(' AND ');
  const sql='SELECT 1 AS orphan FROM '+q(group.child)+' c LEFT JOIN '+
   q(group.parent)+' p ON '+joined+' WHERE '+present+
   ' AND p.'+q(columns[0].parent)+' IS NULL LIMIT 1';
  const [rows]=await conn.execute(sql);
  if(rows.length)invalid++;
 }
 return {foreign_keys_checked:constraints.length,orphan_constraints:invalid};
}
async function reconcile(conn,manifest){
 const [[db]]=await conn.execute('SELECT DATABASE() AS db');
 need(db?.db==='ratsadaa_connect','target_must_be_staging');
 const [keys]=await conn.execute(
  'SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,ORDINAL_POSITION '+
  'FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
 const fk=groupFk(keys);
 need(fk.length===119,'fk_inventory_invalid');
 const counts=await countParity(conn,manifest);
 const integrity=await fkOrphans(conn,fk);
 return {...counts,...integrity,
  counts_match:counts.mismatched_tables===0&&counts.total_rows===manifest.total_rows,
  relations_match:integrity.orphan_constraints===0,
  fully_reconciled:false}; // row-hash, chronology, attendance and score auditing still required
}
module.exports={q,groupFk,countParity,fkOrphans,reconcile};
