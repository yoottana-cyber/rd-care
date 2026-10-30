'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {handleInternalSchoolRequest,AUTH_PATHS,READ_PATHS}
 =require('../src/staging-school-internal-router.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
function mock(url,method='GET',payload,authorization){
 const chunks=payload===undefined?[]:[Buffer.from(JSON.stringify(payload))];
 const req=Readable.from(chunks);
 req.method=method;req.url=url;
 req.headers={...(payload===undefined?{}:{'content-type':'application/json'}),
  ...(authorization?{authorization}:{})};
 const res={status:0,headers:{},raw:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(raw){this.raw=String(raw??'')},
  json(){return JSON.parse(this.raw)}
 };
 return {req,res};
}
const TOKEN='d'.repeat(64);
const authServices={
 async login(conn,{kind,body}){
  if(body.username!=='synthetic'||body.password!=='offline-password'){
   const e=Error('credentials');e.status=401;throw e;
  }
  return {token:TOKEN,...(kind==='staff'?{user:{role:'teacher'}}:
   {account:{role:body.role}})};
 },
 async me(conn,{kind,authorization}){
  if(authorization!=='Bearer '+TOKEN){const e=Error('token');e.status=401;throw e}
  return kind==='staff'?{user:{role:'teacher'}}:{account:{role:'guardian'}};
 },
 async logout(){return {ok:true}}
};
const readServices={
 async trustedSession(conn,kind,authorization){
  if(authorization!=='Bearer '+TOKEN){const e=Error('no_auth');e.status=401;throw e}
  return {kind,role:kind==='staff'?'teacher':'guardian',id:5};
 },
 async listRooms(){return {items:[{id:11,label:'Synthetic Room'}]}},
 async portalChildren(){return {items:[{id:22}]}}
};
async function invoke(url,method='GET',payload,authorization,options={}){
 const {req,res}=mock(url,method,payload,authorization);
 await handleInternalSchoolRequest(req,res,{
  connection:{synthetic:true},authServices,readServices,...options});
 return res;
}
test('one internal-only router exposes only the exact supported auth/read paths',()=>{
 assert.equal(AUTH_PATHS.size,6);
 assert.ok(READ_PATHS.has('/api/attendance'));
 assert.ok(READ_PATHS.has('/api/portal/children'));
 assert.ok(!READ_PATHS.has('/api/portal/auth/login'));
});
test('staff login, session and authorized room reading chain through one internal adapter',async()=>{
 const login=await invoke('/web/rd-connect-node-test/api/auth/login','POST',
  {username:'synthetic',password:'offline-password'});
 assert.equal(login.status,200);
 assert.equal(login.json().user.role,'teacher');
 const me=await invoke('/api/auth/me','GET',undefined,'Bearer '+TOKEN);
 assert.equal(me.status,200);
 const rooms=await invoke('/api/classrooms','GET',undefined,'Bearer '+TOKEN);
 assert.equal(rooms.status,200);
 assert.equal(rooms.json().items[0].id,11);
});
test('portal auth reads only portal paths with injected token verification',async()=>{
 const login=await invoke('/api/portal/auth/login','POST',
  {username:'synthetic',password:'offline-password',role:'guardian'});
 assert.equal(login.status,200);
 assert.equal(login.json().account.role,'guardian');
 const child=await invoke('/api/portal/children','GET',undefined,'Bearer '+TOKEN);
 assert.equal(child.status,200);
 assert.deepEqual(child.json().items,[{id:22}]);
});
test('missing connection or token, wrong HTTP method, and unknown URL fail closed',async()=>{
 const absent=mock('/api/auth/login','POST',{username:'x'});
 await handleInternalSchoolRequest(absent.req,absent.res);
 assert.equal(absent.res.status,503);
 assert.equal((await invoke('/api/classrooms')).status,401);
 assert.equal((await invoke('/api/classrooms','POST',{},'Bearer '+TOKEN)).status,405);
 assert.equal((await invoke('/api/not-migrated','GET',undefined,'Bearer '+TOKEN)).status,404);
});
test('no CORS, no cache, and no secret echo in error responses',async()=>{
 const error=await invoke('/api/auth/login','POST',
  {username:'synthetic',password:'private-test-password'});
 assert.equal(error.status,401);
 assert.equal(error.headers['Cache-Control'],'no-store');
 assert.equal(error.headers['Access-Control-Allow-Origin'],undefined);
 assert.equal(error.raw.includes('private-test-password'),false);
});
test('public Passenger STILL rejects every internal auth and read path with 501',()=>{
 for(const [method,url] of [
  ['POST','/api/auth/login'],['GET','/api/classrooms'],
  ['GET','/api/portal/children'],['GET','/api/portal/attendance'],
  ['GET','/api/attendance?kind=period'],['GET','/api/portal/behavior']
 ]){
  const {req,res}=mock(url,method);
  requestHandler(req,res);
  assert.equal(res.status,501);
  assert.equal(res.json().error,'endpoint_not_migrated');
 }
});
