'use strict';
// Stage 7.2: OFFLINE review of three D1 -> MariaDB trigger drafts.
// Does not open MariaDB or run SQL. It is NOT a MariaDB syntax/concurrency test.
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const FILE=join(__dirname,'../migrations/drafts/0001_guardian_timetable_10_4.sql');
const NAMES=Object.freeze([
 'guardian_link_role_guard',
 'timetable_clash_insert',
 'timetable_clash_update'
]);
function ensure(condition,reason){
 if(!condition)throw Error(reason);
}
function validateDraft(original){
 ensure(typeof original==='string'&&original.length<16000,'invalid_draft_file');
 ensure(original.includes('DRAFT ONLY | DO NOT EXECUTE'),'draft_safety_banner_missing');
 const stripped=original.split('\n')
  .filter(line=>!line.trimStart().startsWith('--')).join('\n');
 const names=[...stripped.matchAll(/\bCREATE\s+TRIGGER\s+([a-z0-9_]+)/gi)]
  .map(m=>m[1].toLowerCase());
 ensure(names.length===NAMES.length&&names.every((name,i)=>name===NAMES[i]),'trigger_inventory_mismatch');
 ensure((stripped.match(/\bSIGNAL\s+SQLSTATE\s+'45000'/gi)||[]).length===3,'signal_guard_missing');
 ensure((stripped.match(/\bFOR\s+EACH\s+ROW/gi)||[]).length===3,'row_trigger_missing');
 ensure(!/\b(?:DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE\s+TABLE|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(stripped),
  'unsafe_statement_in_draft');
 ensure(/\bDELIMITER\s+\$\$/i.test(stripped)&&/\bDELIMITER\s+;/i.test(stripped),'delimiter_missing');
 const [guardian,insert,update]=NAMES.map((name,i)=>{
  const start=stripped.indexOf('CREATE TRIGGER '+name);
  ensure(start>=0,'trigger_block_missing');
  const next=i===NAMES.length-1?stripped.lastIndexOf('DELIMITER ;'):
   stripped.indexOf('CREATE TRIGGER '+NAMES[i+1]);
  ensure(next>start,'trigger_block_boundary_missing');
  return stripped.slice(start,next);
 });
 ensure(/BEFORE\s+INSERT\s+ON\s+guardian_student_links/i.test(guardian),'guardian_event_mismatch');
 ensure(/pa\.role\s*=\s*'guardian'/i.test(guardian)&&
  /NEW\.guardian_account_id/i.test(guardian)&&/guardian_account_required/.test(guardian),'guardian_role_guard_missing');
 ensure(/BEFORE\s+INSERT\s+ON\s+timetable/i.test(insert),'timetable_insert_event_mismatch');
 ensure(/BEFORE\s+UPDATE\s+ON\s+timetable/i.test(update),'timetable_update_event_mismatch');
 for(const block of [insert,update]){
  for(const required of [
   'NEW.active = 1','t.active = 1','t.day_of_week = NEW.day_of_week',
   't.classroom_id = NEW.classroom_id','t.teacher_user_id = NEW.teacher_user_id',
   't.period <= COALESCE(NEW.end_period, NEW.period)',
   'COALESCE(t.end_period, t.period) >= NEW.period',
   'TIMETABLE_OVERLAP'
  ])ensure(block.includes(required),'timetable_overlap_condition_missing');
 }
 ensure(update.includes('t.id <> OLD.id'),'update_self_exclusion_missing');
 return {draft_triggers:names,sql_applied:false,database_access:false,
  review_required:['mariadb_10_4_syntax','two_connection_overlap_race','guardian_role_update_bypass']};
}
function run({read=readFileSync,log=console.log,warn=console.error}={}){
 try{
  const report=validateDraft(read(FILE,'utf8'));
  log('STEP 7.2 DRAFT OK: '+report.draft_triggers.join(', ')+'.');
  log('NO DATABASE ACCESS / NO DDL: static review of draft SQL only.');
  log('NOT APPROVED FOR DEPLOYMENT: concurrency and guardian role-change cases require independent tests.');
  return 0;
 }catch{
  warn('STEP 7.2 DRAFT FAILED (static_review).');
  return 1;
 }
}
if(require.main===module)process.exitCode=run();
module.exports={FILE,NAMES,validateDraft,run};
