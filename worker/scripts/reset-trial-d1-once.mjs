// ONE-TIME destructive reset of the RD Care trial D1 (not a production migration).
// Activated only from the guarded CI job and verified against the exact D1 UUID.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EXPECTED_DB_NAME,EXPECTED_DB_ID,MARKER,isLegacyStudents,planTrialTableDrops}
 from './trial-db-reset-plan.mjs';

const dryRun=process.env.RD_TRIAL_RESET_DRY_RUN==='1';
if(!dryRun&&process.env.RD_TRIAL_RESET_CONFIRMED!=='RESET-RD-CARE-DEV-TRIAL-ALL'){
 throw Error('Reset confirmation environment missing; database untouched');
}
const config=readFileSync('wrangler.toml','utf8');
for(const token of [
 'database_name = "'+EXPECTED_DB_NAME+'"',
 'database_id = "'+EXPECTED_DB_ID+'"',
 'binding = "DB"',
]){
 if(!config.includes(token))throw Error('D1 configuration changed; database untouched');
}
function wrangler(...args){
 return execFileSync('npx',['--no-install','wrangler',...args],
  {encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
}
function json(output){
 const v=output.trim();
 if(!v.startsWith('[')&&!v.startsWith('{'))throw Error('Unrecognized JSON from Wrangler; no reset');
 return JSON.parse(v);
}
const dbs=json(wrangler('d1','list','--json'));
if(!Array.isArray(dbs)||!dbs.some(x=>x.name===EXPECTED_DB_NAME&&x.uuid===EXPECTED_DB_ID)){
 throw Error('Cloudflare account does not contain the exact expected trial D1 UUID');
}
const introspect=()=>{
 const output=json(wrangler('d1','execute',EXPECTED_DB_NAME,'--remote','--json',
  '--command',"SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"));
 const item=Array.isArray(output)?output[0]:output;
 if(!item?.success||!Array.isArray(item.results))throw Error('D1 schema inspection failed');
 return item.results;
};
const schema=introspect();
const students=schema.find(x=>x.name==='students');
const marker=schema.find(x=>x.name===MARKER);
const newIndex=()=>{
 const output=json(wrangler('d1','execute',EXPECTED_DB_NAME,'--remote','--json',
  '--command',"SELECT name FROM sqlite_master WHERE type='index' AND name='uq_students_current_room_roll'"));
 const result=Array.isArray(output)?output[0]:output;
 return result?.success&&result.results?.length>0;
};
if(students&&!isLegacyStudents(students.sql)){
 if(!marker&&newIndex()){
  console.log('Already upgraded: no trial records were reset.');
  process.exit(0);
 }
 throw Error('Unexpected students schema: refusing to erase a nonlegacy database');
}
if(!students&&!marker&&schema.length===0){
 console.log('Trial D1 is already empty; migrations may proceed.');
 process.exit(0);
}
if(!students&&!marker){
 throw Error('Partial/unrecognized D1 schema without reset marker: no reset');
}
const allow=new Set();
for(const file of readdirSync('migrations').filter(x=>/^\d{4}_.+\.sql$/.test(x))){
 const source=readFileSync(join('migrations',file),'utf8');
 for(const match of source.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["\[]?([a-zA-Z_]\w*)/gi))
  allow.add(match[1]);
}
allow.add('d1_migrations');
if(allow.size<20)throw Error('Schema allowlist unexpectedly small; refusing reset');
// Plan BEFORE any write: unknown tables/foreign-key cycles must not be destroyed.
const proposal=planTrialTableDrops(schema,allow);
if(dryRun){
 console.log('DRY RUN ONLY: verified exact D1 UUID; planned '+proposal.length+' dependency-safe table drops.');
 console.log('Last table:',proposal.at(-1));
 process.exit(0);
}
// Create an in-database marker to make retries recover if interrupted.
if(!marker){
 wrangler('d1','execute',EXPECTED_DB_NAME,'--remote','--yes',
  '--command','CREATE TABLE IF NOT EXISTS '+MARKER+'(id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}
const all=introspect();
const drops=planTrialTableDrops(all,allow);
console.log('Verified trial database UUID. Resetting '+drops.length+' known tables, children first.');
const folder=mkdtempSync(join(tmpdir(),'rd-care-trial-reset-'));
try{
 for(let i=0;i<drops.length;i+=10){
  const file=join(folder,'drop-'+String(i)+'.sql');
  writeFileSync(file,drops.slice(i,i+10).join('\n')+'\n','utf8');
  // Each batch executes in dependency order. No FK disable, no copied histories.
  wrangler('d1','execute',EXPECTED_DB_NAME,'--remote','--yes','--file',file);
  console.log('Dropped '+Math.min(i+10,drops.length)+'/'+drops.length+' tables.');
 }
 const remaining=introspect().map(x=>x.name).filter(name=>name!==MARKER);
 if(remaining.length)throw Error('Reset incomplete: unexpected remaining application tables');
 wrangler('d1','execute',EXPECTED_DB_NAME,'--remote','--yes',
  '--command','DROP TABLE IF EXISTS '+MARKER);
 if(introspect().length!==0)throw Error('D1 did not become empty');
 console.log('Verified original D1 has no trial tables. Migration and room seed can run.');
}finally{
 rmSync(folder,{recursive:true,force:true});
}
