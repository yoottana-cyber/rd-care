import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renewRememberedSession,REMEMBER_SECONDS} from '../worker/src/remember-session.js';
import {
 readAuthSession,saveAuthSession,clearAuthSession,shouldRenewAuthSession,
 extendAuthSession
} from '../web/auth-session.js';

const storage=()=>{const data=new Map();return {
 getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
 removeItem:k=>data.delete(k)
}};
function pretendMobile(work){
 const previous=globalThis.window,local=globalThis.localStorage,tab=globalThis.sessionStorage;
 globalThis.localStorage=storage();globalThis.sessionStorage=storage();
 globalThis.window={matchMedia:()=>({matches:true}),navigator:{}};
 try{return work(globalThis.localStorage)}finally{
  if(previous===undefined)delete globalThis.window;else globalThis.window=previous;
  if(local===undefined)delete globalThis.localStorage;else globalThis.localStorage=local;
  if(tab===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=tab;
 }
}
function database(row){
 let called=null;
 return {prepare(sql){called={sql,values:[]};return {
  bind(...values){called.values=values;return this},
  async first(){return row}
 }},query:()=>called};
}
test('mobile remembered sessions roll forward with another 30 days of inactivity',async()=>{
 for(const [portal,table] of [[false,'sessions'],[true,'portal_sessions']]){
  const db=database({expires_at:1730000000});
  const at=1730000000;
  const data=await renewRememberedSession(db,'a'.repeat(64),portal,at);
  assert.equal(data.expires_in,REMEMBER_SECONDS);
  assert.match(db.query().sql,new RegExp('UPDATE '+table));
  assert.match(db.query().sql,/remember_device=1/);
  assert.match(db.query().sql,/expires_at>\?/);
  assert.equal(db.query().values[0],at+30*86400);
  assert.equal(db.query().values[2],at);
 }
});
test('expired or nonremembered sessions cannot be renewed',async()=>{
 const db=database(null);
 await assert.rejects(renewRememberedSession(db,'a'.repeat(64)),{code:403});
 assert.match(db.query().sql,/expires_at-CAST\(strftime/);
 assert.deepEqual(db.query().values.slice(-2),[29*86400,31*86400]);
});
test('only remembered mobile credentials are extended in device storage',()=>{
 pretendMobile(local=>{
  const key='rd_token',token='c'.repeat(64);
  saveAuthSession(key,token,30*86400,true);
  const now=Date.now();
  assert.equal(shouldRenewAuthSession(key,token,now+1000),false);
  const record=JSON.parse(local.getItem('rd_token_remember_v1'));
  local.setItem('rd_token_remember_v1',JSON.stringify({...record,refreshedAt:now-86400000}));
  assert.equal(shouldRenewAuthSession(key,token,now),true);
  assert.equal(extendAuthSession(key,token,30*86400,now),true);
  assert.equal(shouldRenewAuthSession(key,token,now+1000),false);
  assert.equal(readAuthSession(key),token);
  assert.equal(extendAuthSession(key,'wrong',30*86400),false);
  assert.equal(extendAuthSession(key,token,31*86400),false);
  clearAuthSession(key);
  assert.equal(readAuthSession(key),'');
 });
});
test('tab-only and desktop sessions are not auto-renewed',()=>{
 pretendMobile(local=>{
  const token='d'.repeat(64);
  saveAuthSession('rd_portal_student_token',token,8*3600,false);
  assert.equal(shouldRenewAuthSession('rd_portal_student_token',token),false);
  assert.equal(local.getItem('rd_portal_student_token_remember_v1'),null);
  saveAuthSession('rd_portal_student_token',token,30*86400,true);
  globalThis.window.matchMedia=()=>({matches:false});
  assert.equal(shouldRenewAuthSession('rd_portal_student_token',token,Date.now()+86400000),false);
 });
});
test('UI and backend wire staff, student and guardian renewal without exposing passwords',()=>{
 const worker=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../worker/src/portal.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../web/portal-ui.js',import.meta.url),'utf8');
 const migration=readFileSync(new URL('../worker/migrations/0034_remembered_sessions.sql',import.meta.url),'utf8');
 assert.match(worker,/api\/auth\/keep-alive/);
 assert.match(portal,/api\/portal\/auth\/keep-alive/);
 assert.match(worker,/INSERT INTO sessions\(token_hash,user_id,expires_at,remember_device\)/);
 assert.match(portal,/INSERT INTO portal_sessions\(token_hash,account_id,expires_at,remember_device\)/);
 assert.match(app,/renewStaffRememberedSession/);
 assert.match(ui,/renewPortalRememberedSession/);
 assert.match(ui,/isPersonalMobileDevice\(\)\?'checked'/);
 assert.match(migration,/ALTER TABLE sessions ADD COLUMN remember_device/);
 assert.match(migration,/ALTER TABLE portal_sessions ADD COLUMN remember_device/);
 assert.doesNotMatch(migration,/DROP TABLE/);
});
