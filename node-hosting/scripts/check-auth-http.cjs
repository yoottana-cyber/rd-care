'use strict';
// In-process HTTP contract tests, no network socket, no database access.
// The adapter has not been registered with the public Passenger listener.
const {Readable}=require('node:stream');
const {handleStagingAuthRequest}=require('../src/staging-auth-http.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const EXPECTED_TOKEN='c'.repeat(64);
function makeReq(method,path,body,headers={}){
 const data=body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))];
 const req=Readable.from(data);
 req.method=method;req.url=path;
 req.headers={...(body===undefined?{}:{'content-type':'application/json'}),...headers};
 return req;
}
function makeRes(){
 const res={status:0,headers:{},text:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.text=String(body||'')},
  json(){return JSON.parse(this.text)}
 };
 return res;
}
function mockServices(){
 const calls=[];
 const impl={
  async login(conn,{kind,body}){
   calls.push({action:'login',kind});
   if(body.password!=='synthetic-password')throw {status:401};
   if(kind==='portal'&&!['student','guardian'].includes(body.role))throw {status:400};
   return {token:EXPECTED_TOKEN,expires_in:28800,
    ...(kind==='portal'?{account:{role:body.role,username:'synthetic'}}:{user:{role:'teacher',username:'synthetic'}})};
  },
  async me(conn,{kind,authorization}){
   calls.push({action:'me',kind});
   if(authorization!=='Bearer '+EXPECTED_TOKEN)throw {status:401};
   return kind==='portal'?{account:{role:'student'}}:{user:{role:'teacher'}};
  },
  async logout(conn,{kind,authorization}){
   calls.push({action:'logout',kind});
   if(authorization!=='Bearer '+EXPECTED_TOKEN)throw {status:401};
   return {ok:true};
  }
 };
 return {calls,impl};
}
async function invoke(method,path,body,headers,opts){
 const req=makeReq(method,path,body,headers);const res=makeRes();
 await handleStagingAuthRequest(req,res,opts);
 if(!res.status||!res.text)throw Error('incomplete_response');
 return res;
}
async function run({log=console.log,warn=console.error}={}){
 try{
  const connection={synthetic:true};
  const {impl,calls}=mockServices();
  const opts={connection,services:impl};
  const staff=await invoke('POST','/api/auth/login',{username:'synthetic',password:'synthetic-password'},{},opts);
  if(staff.status!==200||staff.json().user?.role!=='teacher')throw Error('staff_login_contract');
  const student=await invoke('POST','/web/rd-connect-node-test/api/portal/auth/login',
   {username:'synthetic',password:'synthetic-password',role:'student'},{},opts);
  if(student.status!==200||student.json().account?.role!=='student')throw Error('student_login_contract');
  const guardian=await invoke('POST','/api/portal/auth/login',
   {username:'synthetic',password:'synthetic-password',role:'guardian'},{},opts);
  if(guardian.status!==200||guardian.json().account?.role!=='guardian')throw Error('guardian_login_contract');
  const staffMe=await invoke('GET','/api/auth/me',undefined,{authorization:'Bearer '+EXPECTED_TOKEN},opts);
  if(staffMe.status!==200||staffMe.json().user?.role!=='teacher')throw Error('staff_me_contract');
  const portalMe=await invoke('GET','/api/portal/auth/me',undefined,{authorization:'Bearer '+EXPECTED_TOKEN},opts);
  if(portalMe.status!==200||portalMe.json().account?.role!=='student')throw Error('portal_me_contract');
  const logout=await invoke('POST','/api/auth/logout',undefined,{authorization:'Bearer '+EXPECTED_TOKEN},opts);
  if(logout.status!==200||logout.json().ok!==true)throw Error('logout_contract');
  const negative=[
   await invoke('POST','/api/auth/login',{username:'synthetic',password:'bad'}, {},opts),
   await invoke('POST','/api/portal/auth/login',{username:'synthetic',password:'synthetic-password',role:'staff'}, {},opts),
   await invoke('GET','/api/auth/login',undefined,{},opts),
   await invoke('POST','/api/auth/login','{bad-json',{},opts),
   await invoke('POST','/api/auth/login','anything',{'content-type':'text/plain'},opts),
   await invoke('POST','/api/auth/login','x'.repeat(8200),{},opts),
   await invoke('GET','/api/auth/me',undefined,{},opts),
   await invoke('POST','/api/portal/auth/logout',undefined,{authorization:'Bearer bad'},opts),
   await invoke('POST','/api/auth/login',{username:'synthetic',password:'synthetic-password'},{},{services:impl})
  ];
  const expected=[401,400,405,400,415,413,401,401,503];
  for(let i=0;i<negative.length;i++){
   if(negative[i].status!==expected[i])throw Error('negative_contract_'+i);
   const text=negative[i].text;
   if(text.includes('synthetic-password')||text.includes(EXPECTED_TOKEN))throw Error('secret_in_error');
   if(!negative[i].headers['Cache-Control']?.includes('no-store'))throw Error('cache_control_missing');
   if(negative[i].headers['Access-Control-Allow-Origin'])throw Error('unexpected_cors');
  }
  for(const path of ['/api/auth/login','/api/portal/auth/login','/web/rd-connect-node-test/api/auth/login']){
   const res=makeRes();
   requestHandler(makeReq('POST',path,{username:'synthetic',password:'synthetic-password'}),res);
   if(res.status!==501||res.json().error!=='endpoint_not_migrated')throw Error('public_auth_exposed');
  }
  if(calls.length<7)throw Error('service_not_called');
  log('STEP 6.5 OK: HTTP Login, Me, Logout contracts for staff/student/guardian passed.');
  log('NEGATIVE TESTS OK: 400/401/405/413/415, missing DB connection, no CORS, safe error responses.');
  log('PUBLIC AUTH STILL CLOSED: the Passenger HTTP router returns 501; no DB/socket used by this test.');
  return 0;
 }catch(error){
  warn('STEP 6.5 FAILED (http_contract_check).');
  return 1;
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{console.error('STEP 6.5 FAILED (unknown).');process.exitCode=1});
module.exports={run,invoke,makeReq,makeRes};
