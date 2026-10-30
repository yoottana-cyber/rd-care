'use strict';
// Step 6.7: in-process pre-deploy check. This does NOT make an HTTPS request.
// The user must open the real school staging URL in a browser after uploading.
const {requestHandler}=require('../src/http-handler.cjs');

function checkPath(path,method){
 const res={
  status:0,headers:{},body:'',
  writeHead(code,headers){this.status=code;this.headers=headers},
  end(body){this.body=String(body)}
 };
 requestHandler({url:path,method},res);
 return {status:res.status,headers:res.headers,body:JSON.parse(res.body)};
}
function run({log=console.log,warn=console.error}={}){
 try{
  const checks=[
   ['/api/migration/transport','GET',200,'transport_only'],
   ['/web/rd-connect-node-test/api/migration/transport','GET',200,'transport_only'],
   ['/api/migration/transport','POST',405,'method_not_allowed'],
   ['/api/health','GET',503,'migration_not_ready'],
   ['/web/rd-connect-node-test/api/health','GET',503,'migration_not_ready'],
   ['/api/auth/login','POST',501,'endpoint_not_migrated'],
   ['/api/portal/auth/login','POST',501,'endpoint_not_migrated'],
   ['/web/rd-connect-node-test/api/auth/login','POST',501,'endpoint_not_migrated'],
   ['/web/rd-connect-node-test/api/portal/auth/login','POST',501,'endpoint_not_migrated']
  ];
  for(const [path,method,status,marker] of checks){
   const result=checkPath(path,method);
   if(result.status!==status)throw Error('unexpected_http_status');
   if(result.body.check!==marker && result.body.error!==marker)throw Error('unexpected_http_payload');
   if(result.headers['Cache-Control']!=='no-store')throw Error('no_store_missing');
   if(result.headers['Access-Control-Allow-Origin'])throw Error('unexpected_cors');
   if(result.body.check==='transport_only'&&(result.body.login_enabled!==false||result.body.migration_ready!==false))
    throw Error('accidental_readiness_claim');
  }
  log('STEP 6.7 LOCAL OK: staging transport route is available, read-only and does not check DB.');
  log('LOGIN CLOSED: staff and portal auth routes still respond 501; health stays 503.');
  log('NEXT: open the real HTTPS staging transport URL in a browser to confirm external routing.');
  return 0;
 }catch{
  warn('STEP 6.7 FAILED (staging_http_transport_contract).');
  return 1;
 }
}
if(require.main===module)process.exitCode=run();
module.exports={run,checkPath};
