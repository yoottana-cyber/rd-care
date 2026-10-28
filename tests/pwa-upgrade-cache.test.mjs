import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {registerPwaUpdates,showPwaUpdateNotice} from '../web/pwa-updates.js';

const root=new URL('../web/',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const code=read('sw.js');
const assets=Array.from((/const ASSETS=\[([\s\S]+?)\];/.exec(code)||[])[1]?.matchAll(/'(\.[^']+)'/g)||[],x=>x[1]);
const relativePath=value=>value.replace(/^\.\//,'');
const assetSet=new Set(assets.map(relativePath));
test('all offline assets are real public files, and no API or user data is precached',()=>{
 assert.ok(assets.length>50);
 assert.equal(assetSet.size,assets.length);
 for(const item of assets){
  assert.ok(item.startsWith('./'),item);
  assert.ok(!item.includes('?')&&!item.includes('..'),item);
  assert.ok(existsSync(new URL(relativePath(item),root)),item+' is missing');
  assert.doesNotMatch(item,/\/api\/|student-record|\.json$/i);
 }
 assert.match(code,/const CACHE='rd-care-shell-v\d+'/);
 assert.match(code,/cache:\s*'reload'/);
 assert.match(code,/cache:\s*'no-store'/);
});
test('app module dependencies and all page styles are included in versioned offline shell',()=>{
 const visited=new Set();
 const walk=path=>{
  if(visited.has(path))return;
  visited.add(path);
  assert.ok(assetSet.has(path),'Missing offline JS import: '+path);
  const src=read(path);
  const deps=[...src.matchAll(/\bfrom\s*['"](\.[^'"]+\.js)['"]/g)];
  for(const match of deps){
   const dep=relativePath(resolve('/',path,'..',match[1]).slice(1));
   walk(dep);
  }
 };
 walk('app.js');
 for(const [,value] of read('index.html').matchAll(/(?:href|src)="(\.\/[^"]+)"/g)){
  if(!/\.(?:js|css|png|svg|webp|webmanifest)$/.test(value))continue;
  assert.ok(assetSet.has(relativePath(value)),'Missing shell style/asset: '+value);
 }
 for(const name of ['score-recording.js','score-history.js','score-history-popup.js',
  'behavior-adjustment.js','teacher-score-monitor.js','teacher-score-monitor.css',
  'pwa-updates.js','app.js','portal-ui.js','portal-admin.js']){
  assert.ok(assetSet.has(name),name);
 }
});
function swHarness(){
 const handlers=new Map(),entries=new Map(),put=[];
 const cache={
  async addAll(requests){for(const request of requests)entries.set(request.url,{status:200,body:'precached '+request.url})},
  async put(key,value){put.push(key);entries.set(String(key),value)},
  async match(key){return entries.get(String(key))||null}
 };
 const caches={
  async open(){return cache},
  async keys(){return ['rd-care-shell-v76','rd-care-shell-v77','rd-care-shell-v78','rd-care-shell-v79','rd-care-shell-v80','rd-care-shell-v81','rd-care-shell-v82','rd-care-shell-v83','rd-care-shell-v84','rd-care-shell-v85','rd-care-shell-v86','rd-care-shell-v87','rd-care-shell-v88','rd-care-shell-v89','rd-care-shell-v90','rd-care-shell-v91','rd-care-shell-v92','rd-care-shell-v93','rd-care-shell-v94','rd-care-shell-v95','rd-care-shell-v96','rd-care-shell-v97','another-app-data']},
  async delete(key){deleted.push(key);return true}
 };
 const deleted=[],requested=[];
 let fetchResponse={ok:true,type:'basic',redirected:false,clone(){return this},value:'fresh'};
 let fetchError=null;
 const self={
  location:{origin:'https://example.test'},
  registration:{scope:'https://example.test/rd-care/'},
  skipWaiting:async()=>{},
  clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async()=>{}},
  addEventListener(name,handler){handlers.set(name,handler)}
 };
 runInNewContext(code,{self,caches,URL,Request,Response,
  fetch:async(req,options)=>{requested.push({url:req.url||req,options});
   if(fetchError)throw fetchError;
   return fetchResponse},
  console});
 return {
  handlers,entries,requested,put,deleted,
  setResponse(value){fetchResponse=value},
  setError(error){fetchError=error}
 };
}
test('worker preloads shell and removes only old RD CONNECT caches, retaining unrelated app data',async()=>{
 const h=swHarness();
 await new Promise((resolve,reject)=>h.handlers.get('install')({
  waitUntil:p=>p.then(resolve,reject)
 }));
 assert.ok(h.entries.has('https://example.test/rd-care/score-history-popup.js'));
 assert.ok(h.entries.has('https://example.test/rd-care/teacher-score-monitor.js'));
 assert.ok(h.entries.has('https://example.test/rd-care/pwa-updates.js'));
 await new Promise((resolve,reject)=>h.handlers.get('activate')({waitUntil:p=>p.then(resolve,reject)}));
 assert.deepEqual(h.deleted,['rd-care-shell-v76','rd-care-shell-v77','rd-care-shell-v78','rd-care-shell-v79','rd-care-shell-v80','rd-care-shell-v81','rd-care-shell-v82','rd-care-shell-v83','rd-care-shell-v84','rd-care-shell-v85','rd-care-shell-v86','rd-care-shell-v87','rd-care-shell-v88','rd-care-shell-v89','rd-care-shell-v90','rd-care-shell-v91','rd-care-shell-v92','rd-care-shell-v93','rd-care-shell-v94','rd-care-shell-v95','rd-care-shell-v96','rd-care-shell-v97']);
});
test('worker never intercepts private API calls or unknown same-origin resources',()=>{
 const h=swHarness(),fetchHandler=h.handlers.get('fetch');
 let intercepted=false;
 const send=url=>{intercepted=false;fetchHandler({request:{url,method:'GET',mode:'cors'},
  respondWith:()=>{intercepted=true}});return intercepted};
 assert.equal(send('https://example.test/api/behavior?student_id=42'),false);
 assert.equal(send('https://example.test/rd-care/api/attendance'),false);
 assert.equal(send('https://example.test/rd-care/private/records.json'),false);
 assert.equal(send('https://other.example.test/rd-care/app.js'),false);
 assert.equal(send('https://example.test/rd-care/score-recording.js'),true);
});
test('online static modules prefer fresh network responses, offline use only known cached assets',async()=>{
 const h=swHarness();
 const script='https://example.test/rd-care/teacher-score-monitor.js';
 h.entries.set(script,{value:'offline cached'});
 let out;
 h.handlers.get('fetch')({request:{url:script,method:'GET',mode:'cors'},
  respondWith:p=>{out=p}});
 assert.equal((await out).value,'fresh');
 assert.ok(h.requested[0].options.cache==='no-store');
 assert.ok(h.put.includes(script));
 h.setError(new Error('offline'));
 h.handlers.get('fetch')({request:{url:script,method:'GET',mode:'cors'},
  respondWith:p=>{out=p}});
 assert.equal((await out).value,'fresh','most recent cached version survives network outage');
 let navigation;
 h.entries.set('https://example.test/rd-care/index.html',{value:'offline shell'});
 h.handlers.get('fetch')({request:{
  url:'https://example.test/rd-care/?login=guardian',method:'GET',mode:'navigate'
 },respondWith:p=>{navigation=p}});
 assert.equal((await navigation).value,'offline shell');
 // Navigation with an unrecognized path must not substitute the shell.
 let arbitrary=false;
 h.handlers.get('fetch')({request:{
  url:'https://example.test/rd-care/private/student/42',method:'GET',mode:'navigate'
 },respondWith:()=>{arbitrary=true}});
 assert.equal(arbitrary,false);
});
test('update handler registers no-cache and checks version on startup and periodically without auto reload',async()=>{
 let handler,registered=null,checkCount=0,noticeCount=0,interval=null;
 const listeners={};
 const serviceWorker={
  controller:{id:'old'},
  addEventListener:(name,fn)=>{if(name==='controllerchange')handler=fn},
  removeEventListener:()=>{},
  register:async(url,options)=>{
   registered={url,options};
   return {update:async()=>{checkCount++}};
  }
 };
 const fakeWindow={
  location:{protocol:'https:',hostname:'example.test'},
  addEventListener:(name,fn)=>{listeners['window:'+name]=fn},
  setInterval:(fn)=>{interval=fn;return 7},
  clearInterval:()=>{}
 };
 const fakeDoc={visibilityState:'visible',addEventListener:(name,fn)=>{
  listeners['document:'+name]=fn
 }};
 const result=await registerPwaUpdates({
  navigatorRef:{serviceWorker,onLine:true},
  windowRef:fakeWindow,documentRef:fakeDoc,
  onUpdate:()=>{noticeCount++},onError:()=>{throw Error('Unexpected registration error')}
 });
 assert.ok(result);
 assert.equal(registered.url,'./sw.js');
 assert.deepEqual(registered.options,{updateViaCache:'none'});
 assert.equal(checkCount,1);
 handler();handler();
 assert.equal(noticeCount,1);
 // The timer is throttled instead of issuing an API request every minute.
 interval();
 assert.equal(checkCount,1);
});
test('initial install does not show an update prompt and blocked contexts do not register',async()=>{
 let prompted=0,controllerChange;
 const serviceWorker={
  controller:null,
  addEventListener:(_,fn)=>{controllerChange=fn},
  removeEventListener:()=>{},
  register:async()=>({update:async()=>{}})
 };
 const fakeWindow={
  location:{protocol:'https:',hostname:'example.test'},
  addEventListener:()=>{},setInterval:()=>1
 };
 const fakeDoc={visibilityState:'visible',addEventListener:()=>{}};
 await registerPwaUpdates({
  navigatorRef:{serviceWorker,onLine:true},windowRef:fakeWindow,documentRef:fakeDoc,
  onUpdate:()=>{prompted++}
 });
 controllerChange();
 assert.equal(prompted,0);
 assert.equal(await registerPwaUpdates({
  navigatorRef:{serviceWorker},windowRef:{location:{protocol:'http:',hostname:'example.test'}},
  documentRef:fakeDoc
 }),null);
});
test('notice provides explicit update and postpone controls without immediately refreshing',()=>{
 const children=new Map();
 const makeButton=()=>({callbacks:{},addEventListener(name,fn){this.callbacks[name]=fn}});
 const now=makeButton(),later=makeButton();
 const doc={
  body:{appendChild(node){children.set(node.id,node)}},
  getElementById:id=>children.get(id)||null,
  createElement:()=>({
   setAttribute(){},
   querySelector:selector=>selector==='[data-pwa-update-now]'?now:later,
   remove(){children.delete(this.id)}
  })
 };
 let reloads=0;
 showPwaUpdateNotice(doc,()=>{reloads++});
 showPwaUpdateNotice(doc,()=>{reloads++});
 assert.equal(children.size,1);
 assert.equal(reloads,0);
 later.callbacks.click();
 assert.equal(children.size,0);
 assert.equal(reloads,0);
 showPwaUpdateNotice(doc,()=>{reloads++});
 now.callbacks.click();
 assert.equal(reloads,1);
});
