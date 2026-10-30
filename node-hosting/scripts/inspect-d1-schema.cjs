'use strict';
// Offline inspector for a D1 --no-data SQL export. Never executes SQL or logs rows.
const fs=require('node:fs');
function inspect(source){
  if(typeof source!=='string'||!source.trim())throw new Error('empty_schema');
  // Fail closed if a full export containing personal data is accidentally selected.
  if(/^\s*(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\b/im.test(source))
    throw new Error('contains_data_use_no_data_export');
  const names=[...source.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([\w]+)"|`([\w]+)`|\[([\w]+)\]|([\w]+))/gi)]
    .map(m=>m[1]||m[2]||m[3]||m[4]);
  const unique=[...new Set(names)];
  if(unique.length===0)throw new Error('no_create_tables_found');
  return {
    tables:unique.length,
    indexes:(source.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/gi)||[]).length,
    triggers:(source.match(/\bCREATE\s+(?:TEMP\s+)?TRIGGER\b/gi)||[]).length,
    views:(source.match(/\bCREATE\s+VIEW\b/gi)||[]).length,
    note:'Inventory only. SQLite DDL and triggers must be ported and tested before MariaDB import.'
  };
}
function run(argv=process.argv,read=fs.readFileSync,log=console.log,warn=console.error){
  if(argv.length!==3){warn('Usage: node scripts/inspect-d1-schema.cjs <D1-schema-only.sql>');return 2;}
  try{
    const data=read(argv[2],'utf8');
    const report=inspect(data);
    log(JSON.stringify(report,null,2));
    return 0;
  }catch(error){
    warn('D1 schema inspection: '+(/^(empty_schema|contains_data_use_no_data_export|no_create_tables_found)$/.test(error?.message)?error.message:'unable_to_read_schema'));
    return 1;
  }
}
if(require.main===module)process.exitCode=run();
module.exports={inspect,run};
