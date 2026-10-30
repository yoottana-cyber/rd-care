'use strict';
// ONE-SHOT HTTPS ingress -> MariaDB auth transaction probe, school STAGING ONLY.
// Disabled without three explicit env settings. No real credentials or identities.
// The active application's Login/Me/Logout endpoints remain HTTP 501.
// The probe does not import or authenticate any school user's real records.
const {timingSafeEqual}=require('node:crypto');
const HEX_32_BYTES=/^[a-f0-9]{64}$/i;
const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store',
 'Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'"
});
function reply(res,status,body){
 res.writeHead(status,HEADERS);
 res.end(JSON.stringify(body));
}
function configured(env,at){
 if(env.RD_AUTH_HTTPS_PROBE_ENABLE!=='1')return false;
 if(typeof env.RD_AUTH_HTTPS_PROBE_SECRET!=='string'||!HEX_32_BYTES.test(env.RD_AUTH_HTTPS_PROBE_SECRET))return false;
 if(typeof env.RD_AUTH_HTTPS_PROBE_UNTIL!=='string'||!/^[0-9]{10,11}$/.test(env.RD_AUTH_HTTPS_PROBE_UNTIL))return false;
 const expires=Number(env.RD_AUTH_HTTPS_PROBE_UNTIL);
 const now=Math.floor(at/1000);
 return Number.isSafeInteger(expires)&&expires>now&&expires<=now+3600;
}
function secretMatches(provided,expected){
 if(typeof provided!=='string'||!HEX_32_BYTES.test(provided))return false;
 return timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(expected,'hex'));
}
function makeAuthProbe({env=process.env,now=Date.now,makePool,verifyAll}={}){
 // Mutable state only within the server process; restart the app to rerun.
 let attempted=false;
 return async function handleAuthProbe(req,res){
  const current=now();
  if(!configured(env,current))return reply(res,404,{ok:false,error:'not_found'});
  if(req.method!=='POST')return reply(res,405,{ok:false,error:'method_not_allowed'});
  const rawSecret=req.headers?.['x-rd-https-probe-secret'];
  if(!secretMatches(rawSecret,env.RD_AUTH_HTTPS_PROBE_SECRET))
   return reply(res,404,{ok:false,error:'not_found'});
  if(req.headers?.['transfer-encoding']||
    (req.headers?.['content-length']!==undefined&&
     (Number(req.headers['content-length'])!==0)))
   return reply(res,400,{ok:false,error:'body_not_allowed'});
  if(attempted)return reply(res,429,{ok:false,error:'probe_already_attempted'});
  attempted=true; // reserve before first await, also preventing overlapping requests
  let pool,conn;
  try{
   // Import only after authorization so ordinary HTTP calls never initialize DB.
   const poolFn=makePool||require('./database.cjs').openPool;
   const testFn=verifyAll||require('../scripts/check-auth-http-db.cjs').verifyAll;
   pool=poolFn(env);
   conn=await pool.getConnection();
   const passed=await testFn(conn);
   if(passed!==true)throw Error('probe_did_not_complete');
   return reply(res,200,{
    ok:true,
    check:'https_auth_transaction',
    roles_verified:['teacher','student','guardian'],
    rollback_verified:true,
    login_enabled:false,
    migration_ready:false
   });
  }catch{
   // Avoid returning raw SQL failures, credentials, internal stack traces.
   return reply(res,503,{ok:false,error:'staging_probe_failed'});
  }finally{
   if(conn){try{conn.release()}catch{}}
   if(pool){try{await pool.end()}catch{}}
  }
 };
}
module.exports={makeAuthProbe,configured,secretMatches,HEADERS};
