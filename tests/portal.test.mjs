import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/worker.js';
import {portalRoutes,portalAdminRoutes} from '../worker/src/portal.js';
const url='https://rd-care-preview.pages.dev';
const admin={id:1,username:'admin',role:'admin',active:1};
const teacher={id:2,username:'teacher',role:'teacher',active:1};

test('portal login refuses missing/invalid role without DB reads',async()=>{
 for(const role of ['',null,'admin','teacher','parent']){
  const req=new Request(url+'/api/portal/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role,username:'demo',password:'x'})});
  await assert.rejects(portalRoutes(req,{DB:{prepare(){throw Error('unexpected SQL query')}}},'/api/portal/auth/login'),e=>e.code===400);
 }
});
test('anonymous cannot see portal children, attendance or account',async()=>{
 const env={DB:{prepare(){throw Error('unexpected SQL query')}}};
 for(const path of ['/api/portal/children','/api/portal/records?student_id=1&from=2026-10-01&to=2026-10-25','/api/portal/auth/me']){
  await assert.rejects(portalRoutes(new Request(url+path),env,path),e=>e.code===401);
 }
});
test('teacher and student may not provision guardian accounts or links',async()=>{
 const env={DB:{prepare(){throw Error('unexpected SQL query')}}};
 for(const actor of [teacher,{id:12,role:'student'},{id:13,role:'guardian'}]){
  await assert.rejects(portalAdminRoutes(new Request(url+'/api/admin/portal/accounts',{method:'POST',body:'{}'}),env,actor,'/api/admin/portal/accounts'),e=>e.code===403);
  await assert.rejects(portalAdminRoutes(new Request(url+'/api/admin/portal/links',{method:'POST',body:'{}'}),env,actor,'/api/admin/portal/links'),e=>e.code===403);
 }
});
test('admin must attest checked relationship, rejects otherwise before touching DB',async()=>{
 const req=new Request(url+'/api/admin/portal/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guardian_account_id:2,student_id:1,identity_verified:false})});
 await assert.rejects(portalAdminRoutes(req,{DB:{prepare(){throw Error('database should not be queried')}}},admin,'/api/admin/portal/links'),e=>e.code===400);
});
test('normal Worker login cannot be used as portal token',async()=>{
 const response=await worker.fetch(new Request(url+'/api/portal/children',{headers:{Authorization:'Bearer '+'not-a-real-token'}}),{});
 assert.equal(response.status,401);
});
test('portal response CORS remains no-store and does not list student data to anonymous users',async()=>{
 const response=await worker.fetch(new Request(url+'/api/portal/records?student_id=1&from=2026-10-01&to=2026-10-25'),{});
 assert.equal(response.status,401);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
