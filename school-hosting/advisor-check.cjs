'use strict';
// RD CONNECT: school-hosted advisor coverage inspection (no names or usernames).
// Opens private SQLite read-only. Never changes users, assignments, attendance or Push.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {settings,WEB_ROOT,verifyReady}=require('./server.cjs');
const {privatePermissions,TEMP_VARS}=require('./pilot-check.cjs');

function inspectAdvisorCoverage(sqlite){
 const query=[
  "SELECT c.label,c.advisor_user_id AS primary_id,c.advisor2_user_id AS secondary_id,",
  "p.id AS p_id,p.role AS p_role,p.active AS p_active,p.deleted_at AS p_deleted,",
  "s.id AS s_id,s.role AS s_role,s.active AS s_active,s.deleted_at AS s_deleted,",
  "(SELECT COUNT(*) FROM student_enrollments h",
  " JOIN students st ON st.id=h.student_id AND st.active=1 AND st.deleted_at IS NULL",
  " WHERE h.classroom_id=c.id AND h.end_date IS NULL) AS students",
  "FROM classrooms c LEFT JOIN users p ON p.id=c.advisor_user_id",
  "LEFT JOIN users s ON s.id=c.advisor2_user_id ORDER BY c.grade,c.room,c.id"
 ].join(' ');
 const rooms=sqlite.prepare(query).all();
 const valid=(r,prefix)=>r[prefix+'_id']!==null&&r[prefix+'_active']===1&&
  r[prefix+'_deleted']===null&&['teacher','staff'].includes(r[prefix+'_role']);
 const result={total:rooms.length,covered:0,oneAdvisor:0,twoAdvisors:0,unassigned:[],invalid:[]};
 for(const room of rooms){
  const primary=room.primary_id!==null,secondary=room.secondary_id!==null;
  if(!primary&&!secondary){
   result.unassigned.push({room:room.label,students:Number(room.students)});
   continue;
  }
  const reasons=[];
  if(!primary&&secondary)reasons.push('secondary_without_primary');
  if(primary&&!valid(room,'p'))reasons.push('primary_inactive_or_invalid');
  if(secondary&&!valid(room,'s'))reasons.push('secondary_inactive_or_invalid');
  if(primary&&secondary&&room.primary_id===room.secondary_id)reasons.push('same_teacher_in_two_slots');
  if(reasons.length){
   result.invalid.push({room:room.label,students:Number(room.students),reasons});
   continue;
  }
  result.covered++;
  if(secondary)result.twoAdvisors++;
  else result.oneAdvisor++;
 }
 return result;
}
function run({env=process.env,log=console.log}={}){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('school_advisor_node_24_required');
 settings(env);
 if(TEMP_VARS.some(name=>Object.hasOwn(env,name)))
  throw Error('school_advisor_setup_secrets_present');
 const file=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 if(!fs.existsSync(file))throw Error('school_advisor_database_missing');
 privatePermissions(path.dirname(file),file);
 const sqlite=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 let result;
 try{
  verifyReady({sqlite});
  result=inspectAdvisorCoverage(sqlite);
 }finally{sqlite.close()}
 if(result.total!==48)throw Error('school_advisor_room_catalog_mismatch');
 log('RD CONNECT ADVISOR COVERAGE — READ ONLY; NO DATA CHANGED.');
 log('ROOMS: '+result.total+'; valid advisor coverage '+result.covered+
  '; one advisor '+result.oneAdvisor+'; two advisors '+result.twoAdvisors+'.');
 log('ROOMS WITHOUT ADVISOR: '+result.unassigned.length+'.');
 for(const room of result.unassigned)
  log('ASSIGN ADVISOR: '+room.room+' (active enrolled students '+room.students+').');
 log('ROOMS WITH INVALID ASSIGNMENTS: '+result.invalid.length+'.');
 for(const room of result.invalid)
  log('REVIEW ADVISOR: '+room.room+' (active enrolled students '+room.students+
   '; issues '+room.reasons.join(', ')+').');
 const ready=result.unassigned.length===0&&result.invalid.length===0;
 log(ready?'ALL 48 CLASSROOMS HAVE VALID ACTIVE ADVISORS.':
  'ADVISOR COVERAGE PENDING. Update ONLY the named classrooms through Admin > Teachers / Advisor assignment.');
 log('No user names, student IDs or secrets printed; no writes, no Push, no imports.');
 return {ready,...result};
}
if(require.main===module){
 try{const result=run();if(!result.ready)process.exitCode=2}
 catch(e){
  const code=String(e?.message||'');
  console.error('SCHOOL ADVISOR CHECK BLOCKED ('+
   (/^school_[a-z0-9_]+$/.test(code)?code:'school_advisor_read_only_check_failed')+').');
  process.exitCode=1;
 }
}
module.exports={inspectAdvisorCoverage,run};
