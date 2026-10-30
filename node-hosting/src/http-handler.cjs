'use strict';
const {makeAuthProbe}=require('./https-auth-probe.cjs');
const handleAuthProbe=makeAuthProbe();
// Fail-closed migration shell: no real accounts, attendance, score, or Push routes
// have been ported. Do not advertise readiness or process school records.
function reply(res,status,data){
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
 });
 res.end(JSON.stringify(data));
}
// CloudLinux/Passenger may forward either /api/* or the full application URL
// /web/rd-connect-node-test/api/*. Accept only this configured staging mount;
// never match an arbitrary URL suffix (which could bypass route boundaries).
const STAGING_MOUNT_PATH='/web/rd-connect-node-test';
function normalizeAppPath(path){
 if(path===STAGING_MOUNT_PATH||path===STAGING_MOUNT_PATH+'/')return '/';
 if(path.startsWith(STAGING_MOUNT_PATH+'/'))return path.slice(STAGING_MOUNT_PATH.length);
 return path;
}
function requestHandler(req,res){
 const method=req.method||'GET';
 let path='/';
 try{path=normalizeAppPath(new URL(req.url||'/', 'http://local.invalid').pathname)}
 catch{return reply(res,400,{ok:false,error:'invalid_path'})}
 // Never mirror untrusted Origin, session keys or request data.
 // Stage 6.8: secret-guarded one-time SYNTHETIC transaction only.
 // Disabled by default. Never expose any actual auth route or school account.
 if(path==='/api/migration/auth-probe'){
  if((req.url||'').includes('?'))return reply(res,404,{ok:false,error:'not_found'});
  return handleAuthProbe(req,res);
 }
 // Static, unprivileged transport probe for school staging only.
 // A 200 proves Passenger/HTTPS routing, NOT database/application readiness.
 // Do not include runtime versions, environment details, tokens or SQL results.
 if(path==='/api/migration/transport'&&method==='GET')
  return reply(res,200,{
   ok:true,
   check:'transport_only',
   login_enabled:false,
   migration_ready:false
  });
 if(path==='/api/migration/transport')
  return reply(res,405,{ok:false,error:'method_not_allowed'});
 if(path==='/api/health'&&method==='GET')
  return reply(res,503,{
   ok:false,
   service:'RD CONNECT school Node.js migration',
   error:'migration_not_ready'
  });
 if(path==='/api/health')
  return reply(res,405,{ok:false,error:'method_not_allowed'});
 if(path==='/api'||path.startsWith('/api/'))
  return reply(res,501,{ok:false,error:'endpoint_not_migrated'});
 return reply(res,404,{ok:false,error:'not_found'});
}
module.exports={requestHandler,normalizeAppPath};
