'use strict';
// Stage 6.8: test the disabled-by-default public gate WITHOUT MariaDB,
// external HTTP, a real token, or changing any school data.
const {makeAuthProbe}=require('../src/https-auth-probe.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const SECRET='ab'.repeat(32);
const NOW=1800000000000;
function req(method='POST',secret=SECRET){
 return {method,url:'/api/migration/auth-probe',
  headers:secret===null?{}:{'x-rd-https-probe-secret':secret,'content-length':'0'}};
}
function res(){
 return {status:null,headers:{},body:null,
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.body=JSON.parse(body)}
 };
}
async function invoke(handler,request){
 const response=res();
 await handler(request,response);
 if(response.status===null||response.body===null)throw Error('incomplete_http_response');
 if(response.headers['Cache-Control']!=='no-store')throw Error('missing_no_store');
 return response;
}
async function run({log=console.log,warn=console.error}={}){
 try{
  let dbCalls=0,closed=0,released=0;
  const makePool=()=>{dbCalls++;return {
   getConnection:async()=>({release:()=>{released++}}),
   end:async()=>{closed++}
  }};
  const verifyAll=async()=>true;
  const gateOptions={now:()=>NOW,makePool,verifyAll};
  for(const env of [
   {},{RD_AUTH_HTTPS_PROBE_ENABLE:'1',RD_AUTH_HTTPS_PROBE_SECRET:'short',RD_AUTH_HTTPS_PROBE_UNTIL:String(NOW/1000+600)},
   {RD_AUTH_HTTPS_PROBE_ENABLE:'1',RD_AUTH_HTTPS_PROBE_SECRET:SECRET,RD_AUTH_HTTPS_PROBE_UNTIL:String(NOW/1000-1)},
   {RD_AUTH_HTTPS_PROBE_ENABLE:'1',RD_AUTH_HTTPS_PROBE_SECRET:SECRET,RD_AUTH_HTTPS_PROBE_UNTIL:String(NOW/1000+7200)}
  ]){
   const r=await invoke(makeAuthProbe({...gateOptions,env}),req());
   if(r.status!==404||r.body.error!=='not_found')throw Error('unsafe_disabled_gate');
  }
  if(dbCalls!==0)throw Error('db_opened_while_disabled');
  const activeEnv={
   RD_AUTH_HTTPS_PROBE_ENABLE:'1',
   RD_AUTH_HTTPS_PROBE_SECRET:SECRET,
   RD_AUTH_HTTPS_PROBE_UNTIL:String(NOW/1000+600)
  };
  const gate=makeAuthProbe({...gateOptions,env:activeEnv});
  for(const request of [req('GET'),req('POST',null),req('POST','cd'.repeat(32))]){
   const r=await invoke(gate,request);
   if(r.status!==(request.method==='GET'?405:404))throw Error('unauthorized_probe');
  }
  if(dbCalls!==0)throw Error('unauthorized_db_access');
  const good=await invoke(gate,req());
  if(good.status!==200||good.body.check!=='https_auth_transaction'||
     good.body.rollback_verified!==true||good.body.login_enabled!==false||
     good.body.migration_ready!==false)throw Error('successful_gate_contract');
  if(dbCalls!==1||released!==1||closed!==1)throw Error('connection_lifecycle');
  const replay=await invoke(gate,req());
  if(replay.status!==429||dbCalls!==1)throw Error('replay_or_parallel_probe');
  const failed=makeAuthProbe({
   ...gateOptions,env:activeEnv,makePool:()=>{throw Error('SECRET_DB_PASSWORD_WILL_NOT_BE_LOGGED')}
  });
  const failure=await invoke(failed,req());
  if(failure.status!==503||failure.body.error!=='staging_probe_failed'||
     JSON.stringify(failure.body).includes('SECRET_DB_PASSWORD'))throw Error('internal_error_leaked');
  for(const path of ['/api/auth/login','/api/portal/auth/login']){
   const r=res();await requestHandler({method:'POST',url:path,headers:{}},r);
   if(r.status!==501||r.body.error!=='endpoint_not_migrated')throw Error('public_auth_accidentally_open');
  }
  log('STEP 6.8 GATE OK: disabled, expired, invalid-secret, rate-limit and one-shot guards verified.');
  log('ROLLBACK PROBE CONTRACT OK: only synthetic test runner may execute behind an authorized POST.');
  log('LIVE AUTH STILL CLOSED: /api/auth/login and /api/portal/auth/login return 501.');
  log('NO DATABASE ACCESS: this preflight uses a simulated pool; HTTPS has not been tested yet.');
  return 0;
 }catch{
  warn('STEP 6.8 FAILED (https_probe_gate_contract).');
  return 1;
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 6.8 FAILED (unknown).');process.exitCode=1;
});
module.exports={run};
