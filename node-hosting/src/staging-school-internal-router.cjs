'use strict';
// RD CONNECT Batch 1: INTERNAL-ONLY composition of existing auth and read APIs.
// Deliberately NOT imported by app.js or public Passenger http-handler.cjs.
// Only accepts an explicitly injected SQL connection, never creates a pool.
// Actual logged-in teacher/student/guardian access uses DB sessions and
// role-bound relations, not caller-supplied permissions.
const {normalizeAppPath}=require('./http-handler.cjs');
const auth=require('./staging-auth-http.cjs');
const school=require('./staging-school-http.cjs');
const security=school.security;
const AUTH_PATHS=new Set(Object.keys(auth.ROUTES));
const READ_PATHS=new Set(Object.keys(school.ROUTES));
function reply(res,status,error){
 res.writeHead(status,{...security});
 res.end(JSON.stringify({ok:false,error}));
}
function normalize(request){
 const url=new URL(request?.url||'/','http://offline.invalid');
 if(url.username||url.password||url.hash)throw Error('invalid_url');
 return normalizeAppPath(url.pathname);
}
async function handleInternalSchoolRequest(req,res,{connection,
 authServices,readServices}={}){
 if(!connection)return reply(res,503,'service_unavailable');
 let path;
 try{path=normalize(req)}catch{return reply(res,400,'invalid_request')}
 if(AUTH_PATHS.has(path)){
  return auth.handleStagingAuthRequest(req,res,
   {connection,...(authServices?{services:authServices}:{})});
 }
 if(READ_PATHS.has(path)){
  return school.handleStagingSchoolRead(req,res,
   {connection,...(readServices?{services:readServices}:{})});
 }
 // A route mismatch never falls back to the production HTTP listener.
 return reply(res,404,'not_found');
}
module.exports={AUTH_PATHS,READ_PATHS,normalize,handleInternalSchoolRequest};
