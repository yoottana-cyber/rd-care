'use strict';
// RD CONNECT stage 7.15: OFFLINE-ONLY future timetable HTTP/authorization contract.
// This module is deliberately NOT imported by http-handler or app.js.
// The caller must supply a server-verified STAFF principal, never an identity
// parsed from a request body, cookie, query string, or X-User header.
// Admin privileges to edit other teachers' lessons are NOT assumed.
const {normalizeLesson,classifyTimetableDbError}=require('./timetable-write-coordination.cjs');
const {assertSubject}=require('./timetable-locked-insert.cjs');

const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store',
 'Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'"
});
function deny(status,code){const e=new Error(code);e.status=status;return e}
function isPositiveId(n){return Number.isSafeInteger(n)&&n>0}
function principalId(principal){
 // Only an authenticated, active staff TEACHER can manage personal timetable.
 // Student/guardian area, student-affairs as a separate principal, admin,
 // generic staff, and a missing session all fail closed.
 if(!principal||principal.kind!=='staff'||principal.authenticated!==true||
   !isPositiveId(principal.user_id))throw deny(401,'authentication_required');
 if(principal.active!==true||principal.role!=='teacher')
  throw deny(403,'forbidden');
 return principal.user_id;
}
function ownerOnly(principal,existing){
 const id=principalId(principal);
 if(!existing)throw deny(404,'not_found');
 if(!isPositiveId(existing.teacher_user_id)||
    existing.teacher_user_id!==id)throw deny(403,'forbidden');
 return id;
}
function normalizePayload(input,id){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw deny(400,'invalid_request');
 // Never allow the client to assign another teacher's timetable.
 if(Object.prototype.hasOwnProperty.call(input,'teacher_user_id')&&
    input.teacher_user_id!==id)throw deny(403,'forbidden');
 try{
  const s=normalizeLesson({...input,teacher_user_id:id});
  const subject=assertSubject(input.subject);
  return {...s,subject};
 }catch(e){
  if(String(e?.message||'').startsWith('lab_invalid_')||
     e?.message==='lab_lesson_required')
   throw deny(400,'invalid_request');
  throw e;
 }
}
function planWrite(principal,action,{id,body,existing}={}){
 if(!['insert','update','delete'].includes(action))
  throw deny(405,'method_not_allowed');
 const teacherId=action==='insert'?principalId(principal):ownerOnly(principal,existing);
 if(action!=='insert'&&(!isPositiveId(id)||id!==existing.id))
  throw deny(400,'invalid_request');
 if(action==='delete')return {action,id,teacher_user_id:teacherId};
 return {action,id:action==='insert'?null:id,
  teacher_user_id:teacherId,lesson:normalizePayload(body,teacherId)};
}
function errorResponse(error){
 // Map ONLY explicit, allow-listed errors to public messages.
 // No SQL, connection details, tokens, exception messages or stack traces.
 let status=503,code='service_unavailable',retryAfter=null;
 if(error?.status===400){status=400;code='invalid_request'}
 else if(error?.status===401){status=401;code='authentication_required'}
 else if(error?.status===403){status=403;code='forbidden'}
 else if(error?.status===404){status=404;code='not_found'}
 else if(error?.status===405){status=405;code='method_not_allowed'}
 else if(error?.message==='lab_timetable_stale_snapshot'){
  status=409;code='timetable_changed'
 }else if(error?.message==='lab_timetable_retry_exhausted'){
  status=503;code='timetable_busy';retryAfter='1';
 }else{
  const category=classifyTimetableDbError(error);
  if(category==='overlap'){status=409;code='timetable_overlap'}
  else if(category==='busy_retry_new_transaction'||category==='deadlock_retry_new_transaction'){
   status=503;code='timetable_busy';retryAfter='1';
  }
 }
 const headers={...HEADERS};
 if(retryAfter!==null)headers['Retry-After']=retryAfter;
 return {status,headers,body:{ok:false,error:code}};
}
function successResponse(action,value){
 if(!['insert','update','delete'].includes(action))
  throw deny(405,'method_not_allowed');
 if(action==='delete')return {status:204,headers:{...HEADERS},body:null};
 if(!isPositiveId(value?.id))throw Error('lab_invalid_result');
 return {status:action==='insert'?201:200,headers:{...HEADERS},
  body:{ok:true,id:value.id}};
}
module.exports={HEADERS,deny,principalId,ownerOnly,normalizePayload,planWrite,
 errorResponse,successResponse};
