'use strict';
// Stage 7.15: OFFLINE contract audit; NO MariaDB connections, writes or sockets.
// Caller identity is synthetic and supplied as trusted server-side principal.
// Actual Passenger HTTP handler MUST still return 501 for timetable routes.
const {planWrite,errorResponse,successResponse}=require('../src/timetable-offline-api-contract.cjs');
const {conflictError}=require('../src/timetable-locked-insert.cjs');
const {requestHandler}=require('../src/http-handler.cjs');

function need(ok,reason){if(!ok)throw Error('lab_http_'+reason)}
const teacher={kind:'staff',authenticated:true,active:true,role:'teacher',user_id:17};
const lesson={classroom_id:31,day_of_week:1,period:1,end_period:2,
 subject:'Synthetic Offline',active:1};
function assertStatus(fn,status,code){
 let error=null;try{fn()}catch(e){error=e}
 need(error!=null,'expected_denial');
 const res=errorResponse(error);
 need(res.status===status&&res.body?.error===code,'wrong_denial_mapping');
 return res;
}
function assertResponse(error,status,code,after){
 const res=errorResponse(error);
 need(res.status===status&&res.body?.error===code,'wrong_http_status');
 need(res.headers['Cache-Control']==='no-store','no_store');
 need(!res.headers['Access-Control-Allow-Origin'],'unexpected_cors');
 need(!JSON.stringify(res).includes('MYSQL_SECRET'),'secret_leak');
 if(after)after(res);
 return res;
}
function invokePublic(method,path){
 const res={status:0,text:'',headers:{},
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.text=String(body??'')}
 };
 requestHandler({url:path,method,headers:{}},res);
 return res;
}
async function run({log=console.log,warn=console.error}={}){
 try{
  const own=planWrite(teacher,'insert',{body:lesson});
  need(own.teacher_user_id===17&&own.lesson.teacher_user_id===17,'owner_not_server_bound');
  const existing={id:55,teacher_user_id:17};
  need(planWrite(teacher,'update',{id:55,existing,
   body:{...lesson,period:3,end_period:3}}).action==='update','own_update');
  need(planWrite(teacher,'delete',{id:55,existing}).action==='delete','own_delete');
  let denied=0;
  for(const who of [null,
   {kind:'portal',authenticated:true,active:true,role:'student',user_id:17},
   {kind:'portal',authenticated:true,active:true,role:'guardian',user_id:17}]){
   assertStatus(()=>planWrite(who,'insert',{body:lesson}),401,'authentication_required');denied++;
  }
  for(const who of [{kind:'staff',authenticated:true,active:true,role:'admin',user_id:17},
   {kind:'staff',authenticated:true,active:true,role:'staff',user_id:17},
   {kind:'staff',authenticated:true,active:false,role:'teacher',user_id:17}]){
   assertStatus(()=>planWrite(who,'insert',{body:lesson}),403,'forbidden');denied++;
  }
  assertStatus(()=>planWrite(teacher,'insert',{body:{...lesson,teacher_user_id:999}}),403,'forbidden');denied++;
  assertStatus(()=>planWrite(teacher,'update',{id:99,existing:{id:99,teacher_user_id:999},body:lesson}),403,'forbidden');denied++;
  assertStatus(()=>planWrite(teacher,'delete',{id:99,existing:{id:99,teacher_user_id:999}}),403,'forbidden');denied++;
  assertStatus(()=>planWrite(teacher,'delete',{id:99,existing:null}),404,'not_found');denied++;
  assertStatus(()=>planWrite(teacher,'insert',{body:{...lesson,period:11}}),400,'invalid_request');denied++;
  assertStatus(()=>planWrite(teacher,'insert',{body:{...lesson,subject:''}}),400,'invalid_request');denied++;
  const overlap=conflictError();
  assertResponse(overlap,409,'timetable_overlap');
  assertResponse(Error('lab_timetable_stale_snapshot'),409,'timetable_changed');
  assertResponse(Error('lab_named_lock_busy'),503,'timetable_busy',
   r=>need(r.headers['Retry-After']==='1','retry_after'));
  assertResponse(Object.assign(Error('busy'),{errno:1205}),503,'timetable_busy');
  assertResponse(Object.assign(Error('deadlock'),{errno:1213}),503,'timetable_busy');
  assertResponse(Error('lab_timetable_retry_exhausted'),503,'timetable_busy');
  const unsafe=Error('MYSQL_SECRET: connection credentials; SQL SELECT * FROM students');
  assertResponse(unsafe,503,'service_unavailable');
  need(successResponse('insert',{id:7}).status===201,'insert_success');
  need(successResponse('update',{id:7}).status===200,'update_success');
  need(successResponse('delete',{}).status===204,'delete_success');
  const routes=[
   ['POST','/api/timetable'],
   ['PATCH','/api/timetable/55'],
   ['DELETE','/api/timetable/55'],
   ['POST','/web/rd-connect-node-test/api/timetable'],
   ['GET','/api/auth/me']
  ];
  for(const [method,path] of routes){
   const res=invokePublic(method,path);
   need(res.status===501&&JSON.parse(res.text).error==='endpoint_not_migrated',
    'public_endpoint_exposed');
   need(res.headers['Cache-Control']==='no-store','public_cache_headers');
  }
  log('STEP 7.15 OFFLINE API CONTRACT OK: teacher-only ownership checks and HTTP error mapping verified.');
  log('AUTHORIZATION: '+denied+' negative cases denied; portal and admin writes not silently enabled.');
  log('HTTP RESPONSES: 400/401/403/404/409/503, no secrets, no CORS, no-store.');
  log('PUBLIC API CLOSED: timetable and auth routes still return 501 via Passenger handler.');
  log('NO DB ACCESS: no SQL, no school records, no DDL/DML and no network listener.');
  return 0;
 }catch(e){
  warn('STEP 7.15 OFFLINE API CONTRACT FAILED (http_or_authorization_contract).');
  return 1;
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('STEP 7.15 OFFLINE API CONTRACT FAILED (unexpected).');process.exitCode=1;
});
module.exports={run,invokePublic,assertStatus,assertResponse};
