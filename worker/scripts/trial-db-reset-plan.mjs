// Child-before-parent table reset for the explicitly authorized trial D1 only.
export const EXPECTED_DB_NAME='rd-care-dev';
export const EXPECTED_DB_ID='161c2fb5-cd80-42bd-bbab-28b5d61df3e0';
export const MARKER='rdcare_trial_reset_marker';
const goodName=/^[a-zA-Z_][a-zA-Z0-9_]*$/;
const oldRoomUnique=/\bUNIQUE\s*\(\s*classroom_id\s*,\s*roll_no\s*\)/i;
const refPattern=/\bREFERENCES\s+["'\x60\[]?([a-zA-Z_][a-zA-Z0-9_]*)/gi;

export function isLegacyStudents(sql){return oldRoomUnique.test(String(sql||''))}
export function planTrialTableDrops(schema,allowlist){
 if(!Array.isArray(schema)||!(allowlist instanceof Set))throw Error('Schema input missing');
 const rows=schema.filter(x=>x.name!==MARKER&&!x.name.startsWith('sqlite_')&&x.name!=='_cf_KV');
 for(const r of rows){
  if(!goodName.test(r.name)||!['table','view'].includes(r.type))throw Error('Unsupported schema item');
  if(!allowlist.has(r.name)&&r.name!=='d1_migrations')throw Error('Unknown D1 table: '+r.name);
  if(r.type==='view')throw Error('Views require inspection: '+r.name);
  if(!r.sql||/CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql))throw Error('Unexpected table schema');
 }
 const all=new Map(rows.map(r=>[r.name,r]));
 const edges=new Map(rows.map(r=>[r.name,new Set()]));
 const degrees=new Map(rows.map(r=>[r.name,0]));
 for(const r of rows){
  for(const m of String(r.sql).matchAll(refPattern)){
   const parent=m[1];
   if(parent===r.name)continue;
   if(!all.has(parent))throw Error('Unknown referenced table: '+r.name+' -> '+parent);
   if(!edges.get(r.name).has(parent)){
    edges.get(r.name).add(parent);
    degrees.set(parent,degrees.get(parent)+1);
   }
  }
 }
 for(const r of rows){
  if(r.name==='d1_migrations')continue;
  if(all.has('d1_migrations')&&!edges.get(r.name).has('d1_migrations')){
   edges.get(r.name).add('d1_migrations');
   degrees.set('d1_migrations',degrees.get('d1_migrations')+1);
  }
 }
 const pending=new Set(all.keys()),order=[];
 while(pending.size){
  const available=[...pending].filter(name=>degrees.get(name)===0).sort();
  if(!available.length)throw Error('Foreign-key cycle: refusing to drop');
  for(const name of available){
   pending.delete(name);order.push(name);
   for(const parent of edges.get(name))degrees.set(parent,degrees.get(parent)-1);
  }
 }
 return order.map(name=>'DROP TABLE IF EXISTS "'+name+'";');
}
