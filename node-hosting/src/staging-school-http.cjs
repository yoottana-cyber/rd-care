'use strict';
// Batch 1 / offline HTTP adapter for authenticated read-only school views.
// INTENTIONALLY NOT imported by Passenger http-handler.cjs.
// Requires injected MariaDB connection and token validated by auth.me.
// No DB pool, file writes, CORS, push, or public listener.
const {normalizeAppPath}=require('./http-handler.cjs');
const school=require('./school-read-service.cjs');
const security={
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'Pragma':'no-cache','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'"
};
const ROUTES=Object.freeze({
 '/api/classrooms':{kind:'staff',action:'rooms'},
 '/api/students':{kind:'staff',action:'roster'},
 '/api/attendance/daily':{kind:'staff',action:'daily'},
 '/api/my-timetable':{kind:'staff',action:'timetable'},
 '/api/portal/children':{kind:'portal',action:'children'},
 '/api/portal/attendance':{kind:'portal',action:'attendance'},
 '/api/portal/behavior':{kind:'portal',action:'behavior'}
});
function send(res,status,value){
 res.writeHead(status,{...security});
 res.end(JSON.stringify(value));
}
function safeError(err){
 switch(err?.status){
  case 400:return {status:400,error:'invalid_request'};
  case 401:return {status:401,error:'authentication_required'};
  case 403:return {status:403,error:'forbidden'};
  case 404:return {status:404,error:'not_found'};
  default:return {status:503,error:'service_unavailable'};
 }
}
function requestPath(value){
 const u=new URL(value||'/','http://offline.invalid');
 const path=normalizeAppPath(u.pathname);
 if(!path.startsWith('/api/'))throw Error('invalid_path');
 return {path,query:u.searchParams};
}
async function handleStagingSchoolRead(req,res,{connection,services=school}={}){
 if(!connection)return send(res,503,{ok:false,error:'service_unavailable'});
 let parsed;try{parsed=requestPath(req.url)}catch{
  return send(res,400,{ok:false,error:'invalid_request'});
 }
 const route=ROUTES[parsed.path];
 if(!route)return send(res,404,{ok:false,error:'not_found'});
 if(req.method!=='GET')return send(res,405,{ok:false,error:'method_not_allowed'});
 try{
  const current=await services.trustedSession(
   connection,route.kind,req.headers?.authorization);
  const query=parsed.query,room=query.get('classroom_id'),date=query.get('date');
  let value;
  switch(route.action){
   case 'rooms':value=await services.listRooms(connection,current);break;
   case 'roster':value=await services.roster(connection,current,room,date);break;
   case 'daily':value=await services.dailyAttendance(connection,current,room,date);break;
   case 'timetable':value=await services.teacherTimetable(connection,current);break;
   case 'children':value=await services.portalChildren(connection,current);break;
   case 'attendance':value=await services.portalAttendance(connection,current,
    query.get('student_id'),query.get('from'),query.get('to'));break;
   case 'behavior':value=await services.portalBehavior(connection,current,
    query.get('student_id'),query.get('from'),query.get('to'));break;
   default:throw Error('unknown_action');
  }
  return send(res,200,value);
 }catch(err){
  const safe=safeError(err);
  return send(res,safe.status,{ok:false,error:safe.error});
 }
}
module.exports={ROUTES,security,send,safeError,requestPath,handleStagingSchoolRead};
