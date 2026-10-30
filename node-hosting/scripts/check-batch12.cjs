'use strict';
// RD CONNECT consolidated batch 1+2 audit for DirectAdmin.
// One command; offline unit tests followed by a READ-ONLY migration planner.
// Exit 0 is NOT a production GO; if source manifest is missing exit 2.
// This script cannot import data, enable APIs, or alter live Cloudflare.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {run:plan}=require('./check-d1-migration-plan.cjs');

async function run({env=process.env,execute=spawnSync,migration=plan,
 log=console.log,warn=console.error}={}){
 const tests=[
  path.join(__dirname,'../test/batch1-school-read.test.cjs'),
  path.join(__dirname,'../test/batch1-attendance-write.test.cjs'),
  path.join(__dirname,'../test/batch2-manifest.test.cjs'),
  path.join(__dirname,'../test/batch2-reconciliation.test.cjs'),
  path.join(__dirname,'../test/timetable-offline-api-contract.test.cjs')
 ];
 const proc=execute(process.execPath,['--test',...tests],{
  cwd:path.join(__dirname,'..'),
  env:{...env},encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024
 });
 if(proc.error||proc.status!==0){
  warn('BATCH 1+2 OFFLINE TESTS FAILED (unit_contract).');
  // Avoid printing stack traces, tokens or confidential file contents.
  return 1;
 }
 log('BATCH 1 OFFLINE OK: staff/portal read-only authorization, rosters, daily and portal views.');
 log('BATCH 1 HTTP CLOSED: Passenger still blocks unported school API routes.');
 log('BATCH 2 PLANNER OK: manifest validation, file integrity and foreign-key ordering unit tests.');
 const code=await migration({env,log,warn});
 if(code===2){
  warn('BATCH 1+2 SOURCE/MIGRATION PENDING: no school data imported; production NOT READY.');
  return 2;
 }
 if(code!==0){warn('BATCH 1+2 PLAN FAILED; no import executed.');return 1}
 warn('BATCH 1+2 DRY RUN ONLY: data migration and full API parity NOT COMPLETE.');
 return 2;
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('BATCH 1+2 AUDIT FAILED (unknown).');process.exitCode=1;
});
module.exports={run};
