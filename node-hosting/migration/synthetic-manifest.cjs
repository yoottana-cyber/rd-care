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
// A real D1 migration must stop on FK cycles. Synthetic-only fixtures may
// schedule zero-row tables after the acyclic stages: they execute no INSERT.
function syntheticReplayOrder(manifest,topology){
 if(!Array.isArray(topology.stages)||!Array.isArray(topology.cyclic_or_blocked_tables))
  throw Error('migration_invalid_topology');
 const rowCount=new Map(manifest.tables.map(t=>[t.name,t.rows]));
 const seen=new Set(topology.stages.flat());
 const blocked=topology.cyclic_or_blocked_tables;
 if(blocked.some(name=>!rowCount.has(name)||rowCount.get(name)>0))
  throw Error('migration_fk_cycle_with_rows');
 const leftovers=manifest.tables.map(t=>t.name).filter(name=>!seen.has(name)).sort();
 if(leftovers.some(name=>rowCount.get(name)>0))
  throw Error('migration_unordered_populated_table');
 return {stages:[...topology.stages,...(leftovers.length?[leftovers]:[])],
  cyclic_or_blocked_tables:[]};
}
module.exports={SOURCE,loadSyntheticManifest,syntheticReplayOrder};
