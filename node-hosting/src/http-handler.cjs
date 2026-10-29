'use strict';
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
function requestHandler(req,res){
 const method=req.method||'GET';
 let path='/';
 try{path=new URL(req.url||'/', 'http://local.invalid').pathname}
 catch{return reply(res,400,{ok:false,error:'invalid_path'})}
 // Never mirror untrusted Origin, session keys or request data.
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
module.exports={requestHandler};
