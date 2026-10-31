'use strict';
// Synthetic-only wrapper around the strict private JSONL validator.
// The authoritative D1 exporter retains its original source marker.
const fs=require('node:fs');
const path=require('node:path');
const {validateManifest}=require('./manifest-planner.cjs');
const SOURCE='synthetic-staging-schema';
function loadSyntheticManifest(file){
 const name=path.resolve(file);
 if(path.basename(name)!=='manifest.json')throw Error('migration_manifest_file_name_invalid');
 const stats=fs.lstatSync(name);
 if(!stats.isFile()||stats.isSymbolicLink()||stats.size<1||stats.size>2097152)
  throw Error('migration_manifest_file_invalid');
 const raw=JSON.parse(fs.readFileSync(name,'utf8'));
 if(raw?.source!==SOURCE)throw Error('migration_only_synthetic_source_allowed');
 const manifest=validateManifest({...raw,source:'trusted-local-wrangler-d1-sql'});
 return {base:path.dirname(name),manifest:{...manifest,source:SOURCE}};
}
module.exports={SOURCE,loadSyntheticManifest};
