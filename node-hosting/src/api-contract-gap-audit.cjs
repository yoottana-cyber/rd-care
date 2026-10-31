'use strict';
// RD CONNECT Stage 13: representative route-name and HTTP-method parity audit.
// This is NOT a functional test of SQL, role permissions, response schemas,
// Push, backup or real student data. Public Passenger must stay closed.
const auth=require('./staging-auth-http.cjs');
const school=require('./staging-school-http.cjs');
const {requestHandler}=require('./http-handler.cjs');

// Verified against worker/src/worker.js, portal.js, teacher-timetable.js,
// student-affairs.js, staff-push.js and late-qr.js on 31 Oct 2026.
// Representative *priority* contracts, not an exhaustive Worker inventory.
// Never infer a successful migration from a matching route alone.
const CONTRACTS=Object.freeze([
 {method:'POST',path:'/api/auth/login',group:'staff_identity'},
 {method:'GET',path:'/api/auth/me',group:'staff_identity'},
 {method:'POST',path:'/api/auth/logout',group:'staff_identity'},
 {method:'POST',path:'/api/auth/keep-alive',group:'staff_identity'},
 {method:'POST',path:'/api/portal/auth/login',group:'portal_identity'},
 {method:'GET',path:'/api/portal/auth/me',group:'portal_identity'},
 {method:'POST',path:'/api/portal/auth/logout',group:'portal_identity'},
 {method:'POST',path:'/api/portal/auth/keep-alive',group:'portal_identity'},
 {method:'POST',path:'/api/portal/auth/change-password',group:'portal_identity'},
 {method:'GET',path:'/api/portal/children',group:'portal_history'},
 {method:'GET',path:'/api/portal/records',group:'portal_history'},
 {method:'GET',path:'/api/portal/truancy',group:'portal_history'},
 {method:'POST',path:'/api/portal/late/qr',group:'late_qr'},
 {method:'GET',path:'/api/classrooms',group:'attendance'},
 {method:'GET',path:'/api/students',group:'attendance'},
 {method:'GET',path:'/api/attendance',group:'attendance'},
 {method:'POST',path:'/api/attendance',group:'attendance'},
 {method:'GET',path:'/api/my-timetable',group:'timetable'},
 {method:'POST',path:'/api/my-timetable',group:'timetable'},
 {method:'GET',path:'/api/my-timetable/week-status',group:'timetable'},
 {method:'GET',path:'/api/my-timetable/report',group:'timetable'},
 {method:'GET',path:'/api/school/period-clock',group:'timetable'},
 {method:'GET',path:'/api/dashboard',group:'staff_dashboard'},
 {method:'GET',path:'/api/truancy/advisor',group:'truancy'},
 {method:'GET',path:'/api/behavior',group:'behavior'},
 {method:'GET',path:'/api/affairs/behavior/rules',group:'behavior'},
 {method:'POST',path:'/api/affairs/behavior/record',group:'behavior'},
 {method:'POST',path:'/api/affairs/behavior/record/bulk',group:'behavior'},
 {method:'POST',path:'/api/affairs/behavior/adjust',group:'behavior'},
 {method:'GET',path:'/api/affairs/behavior/monitor/summary',group:'behavior'},
 {method:'GET',path:'/api/late/qr/print',group:'late_qr'},
 {method:'GET',path:'/api/late/qr/queue',group:'late_qr'},
 {method:'GET',path:'/api/push/target',group:'push'},
 {method:'POST',path:'/api/push/subscribe',group:'push'},
 {method:'POST',path:'/api/push/unsubscribe',group:'push'},
 {method:'GET',path:'/api/portal/push/target',group:'push'},
 {method:'GET',path:'/api/portal/student-push/target',group:'push'},
 {method:'GET',path:'/api/admin/school-settings',group:'school_admin'},
 {method:'GET',path:'/api/admin/unified-import/health',group:'data_import'},
 {method:'POST',path:'/api/admin/unified-import/preview',group:'data_import'},
 {method:'POST',path:'/api/admin/unified-import/commit',group:'data_import'}
].map(x=>Object.freeze(x)));

const REQUIRED_PATH_DIFF=Object.freeze({
 cloudflare:'/api/portal/records',
 node_prototype_attendance:'/api/portal/attendance',
 node_prototype_behavior:'/api/portal/behavior'
});
function privateRouteFor(method,path,{staffAuth=auth.ROUTES,schoolRead=school.ROUTES}={}){
 const a=staffAuth[path];
 if(a&&a.method===method)return true;
 const s=schoolRead[path];
 if(s&&method==='GET')return true;
 return false;
}
function report(contracts=CONTRACTS,router){
 const seen=new Set();
 const rows=contracts.map(c=>{
  const key=c.method+' '+c.path;
  if(!['GET','POST'].includes(c.method)||!/^\/api\/[a-z0-9/-]+$/.test(c.path)||
    !/^[a-z_]+$/.test(c.group)||seen.has(key))
   throw Error('stage13_invalid_route_contract');
  seen.add(key);
  const internal=privateRouteFor(c.method,c.path,router);
  return {method:c.method,path:c.path,group:c.group,
   coverage:internal?'PRIVATE_ROUTE_PRESENT_SHAPE_UNVERIFIED':'NO_MATCHING_PRIVATE_ROUTE'};
 });
 const matched=rows.filter(x=>x.coverage==='PRIVATE_ROUTE_PRESENT_SHAPE_UNVERIFIED').length;
 return {total:rows.length,private_route_present:matched,
  private_route_missing:rows.length-matched,rows,
  release_ready:false};
}
function publicIsClosed(){
 // In-process ONLY, no Listener/Database/Push, no personal data.
 for(const req of [
  {method:'POST',url:'/api/auth/login',expected:501},
  {method:'GET',url:'/api/portal/records',expected:501},
  {method:'GET',url:'/api/classrooms',expected:501},
  {method:'POST',url:'/api/attendance',expected:501},
  {method:'GET',url:'/api/health',expected:503}
 ]){
  const response={code:null,data:null,
   writeHead(code){this.code=code},
   end(body){this.data=JSON.parse(body)}};
  requestHandler({method:req.method,url:req.url},response);
  if(response.code!==req.expected||response.data?.ok!==false)
   throw Error('stage13_public_api_not_closed');
 }
 return true;
}
module.exports={CONTRACTS,REQUIRED_PATH_DIFF,privateRouteFor,report,publicIsClosed};
