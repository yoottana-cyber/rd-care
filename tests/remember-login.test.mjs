import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passwordHash} from '../worker/src/password.js';
import worker from '../worker/src/worker.js';
import {portalRoutes} from '../worker/src/portal.js';
import {readAuthSession,saveAuthSession,clearAuthSession} from '../web/auth-session.js';

const storage=()=>{const map=new Map();return {
 getItem:k=>map.has(k)?map.get(k):null,
 setItem:(k,v)=>map.set(k,String(v)),
 removeItem:k=>map.delete(k),
 has:k=>map.has(k)
}};
test('remembered staff token survives a tab restart but expires and is revoked locally',()=>{
 const local=storage(),tab=storage();
 const previousLocal=globalThis.localStorage,previousTab=globalThis.sessionStorage;
 globalThis.localStorage=local;globalThis.sessionStorage=tab;
 try{
  const token='a'.repeat(64);
  saveAuthSession('rd_token',token,30*86400,true);
  assert.equal(tab.getItem('rd_token'),null);
  assert.equal(readAuthSession('rd_token'),token);
  // Opening a fresh tab/new installed PWA should still find the same credential.
  globalThis.sessionStorage=storage();
  assert.equal(readAuthSession('rd_token'),token);
  local.setItem('rd_token_remember_v1',JSON.stringify({token,expiresAt:Date.now()-1000}));
  assert.equal(readAuthSession('rd_token'),'');
  assert.equal(local.getItem('rd_token_remember_v1'),null);
  saveAuthSession('rd_token',token,8*3600,true);
  clearAuthSession('rd_token');
  assert.equal(readAuthSession('rd_token'),'');
 }finally{if(previousLocal===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousLocal;
  if(previousTab===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previousTab}
});
test('unchecking remember me stays tab-only and removes prior remembered tokens',()=>{
 const prevLocal=globalThis.localStorage,prevTab=globalThis.sessionStorage;
 const local=storage(),tab=storage();globalThis.localStorage=local;globalThis.sessionStorage=tab;
 try{
  const token='b'.repeat(64);
  saveAuthSession('rd_token',token,8*3600,false);
  assert.equal(local.getItem('rd_token_remember_v1'),null);
  assert.equal(tab.getItem('rd_token'),token);
  saveAuthSession('rd_token','c'.repeat(64),30*86400,true);
  assert.equal(tab.getItem('rd_token'),null);
  saveAuthSession('rd_token',token,8*3600,false);
  assert.equal(local.getItem('rd_token_remember_v1'),null);
  assert.equal(readAuthSession('rd_token'),token);
  assert.throws(()=>saveAuthSession('rd_token','invalid',12,true));
 }finally{if(prevLocal===undefined)delete globalThis.localStorage;else globalThis.localStorage=prevLocal;
  if(prevTab===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=prevTab}
});

async function fakeLoginDb(role,options={}){
 const salt='test-salt',password='correct-horse';
 const hash=await passwordHash(password,salt);
 const user={id:7,username:'demo',display_name:'Teacher Test',role,active:1,
  password_hash:hash,password_salt:salt,
  ...(role==='student'||role==='guardian'?{must_change_password:options.must_change_password?1:0}:{})};
 const calls=[];
 const db={prepare(sql){
  const call={sql,args:[]};calls.push(call);
  return {bind(...args){call.args=args;return {
   first:async()=>{
    if(sql.includes('FROM login_attempts')||sql.includes('FROM portal_login_attempts'))return null;
    if(sql.includes('FROM users WHERE username')||sql.includes('FROM portal_accounts WHERE username'))return user;
    throw Error('unexpected SELECT: '+sql)
   },
   run:async()=>({meta:{changes:1}})
  }}};
 }};
 return {env:{DB:db},calls,user,password};
}
test('staff remember me issues 30-day server token; unchecked remains 8 hours',async()=>{
 for(const remember of [true,false]){
  const {env,calls,password}=await fakeLoginDb('teacher');
  const before=Math.floor(Date.now()/1000);
  const req=new Request('https://rd.test/api/auth/login',{method:'POST',
   body:JSON.stringify({username:'demo',password,remember})});
  const response=await worker.fetch(req,env);
  assert.equal(response.status,200);
  const body=await response.json();
  const expected=remember?30*86400:8*3600;
  assert.equal(body.expires_in,expected);
  assert.match(body.token,/^[0-9a-f]{64}$/);
  const insert=calls.find(c=>c.sql.includes('INSERT INTO sessions'));
  assert.ok(insert,'session created in D1');
  assert.equal(insert.args[2]>=before+expected&&insert.args[2]<=before+expected+5,true);
 }
});
test('student and guardian remember only when requested, never before password change',async()=>{
 for(const [role,remember,firstChange,expected] of [
  ['student',true,false,30*86400],['guardian',true,false,30*86400],
  ['student',false,false,8*3600],['guardian',true,true,8*3600]
 ]){
  const {env,calls,password}=await fakeLoginDb(role,{must_change_password:firstChange});
  const url='/api/portal/auth/login';
  const response=await portalRoutes(new Request('https://rd.test'+url,{
   method:'POST',body:JSON.stringify({role,username:'demo',password,remember})
  }),env,url);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.expires_in,expected);
  const insert=calls.find(c=>c.sql.includes('INSERT INTO portal_sessions'));
  assert.ok(insert);
 }
});
test('all login/portal screens wire storage cleanup and explicit opt-in flags',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../web/portal-ui.js',import.meta.url),'utf8');
 assert.match(app,/rememberStaff/);
 assert.match(app,/saveAuthSession\('rd_token'/);
 assert.match(app,/clearAuthSession\('rd_token'/);
 assert.match(app,/readAuthSession\('rd_token'\)/);
 assert.match(portal,/name="remember"/);
 assert.match(portal,/saveAuthSession\(activeTokenKey/);
 assert.match(portal,/rd_portal_guardian_token/);
 assert.match(portal,/rd_portal_student_token/);
 assert.match(portal,/clearAuthSession\(activeTokenKey/);
});
