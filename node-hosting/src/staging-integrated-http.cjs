'use strict';
// RD CONNECT: private offline integration of AUTH -> authenticated school reads.
// Not imported by app.js, http-handler.cjs or any Passenger entrypoint.
// Caller injects an isolated MariaDB connection; no pool, network, COMMIT,
// school writes, production accounts, CORS or server listeners in this file.
const {normalizeAppPath}=require('./http-handler.cjs');
const auth=require('./staging-auth-http.cjs');
const school=require('./staging-school-http.cjs');

const AUTH_PATHS=new Set(Object.keys(auth.ROUTES));
const SCHOOL_PATHS=new Set(Object.keys(school.ROUTES));
const ROUTES=Object.freeze([...AUTH_PATHS,...SCHOOL_PATHS].sort());

function safeReply(res,status,error){
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'"
 });
 res.end(JSON.stringify({ok:false,error}));
}
function parsePath(value){
 // One defined staging mount only; unknown paths MUST NOT be routed to a
 // public handler or guessed based on suffix.
 const url=new URL(value||'/','http://offline.invalid');
 if(url.username||url.password)throw Error('invalid_url');
 const path=normalizeAppPath(url.pathname);
 if(!path.startsWith('/api/'))throw Error('invalid_path');
 return path;
}
async function handleIntegratedStaging(req,res,{
 connection,authServices,schoolServices
}={}){
 if(!connection)return safeReply(res,503,'service_unavailable');
 let path;
 try{path=parsePath(req.url)}catch{
  return safeReply(res,400,'invalid_request');
 }
 if(AUTH_PATHS.has(path)){
  const opts={connection};
  if(authServices)opts.services=authServices;
  return auth.handleStagingAuthRequest(req,res,opts);
 }
 if(SCHOOL_PATHS.has(path)){
  const opts={connection};
  if(schoolServices)opts.services=schoolServices;
  return school.handleStagingSchoolRead(req,res,opts);
 }
 return safeReply(res,404,'not_found');
}
module.exports={ROUTES,AUTH_PATHS,SCHOOL_PATHS,parsePath,handleIntegratedStaging};
