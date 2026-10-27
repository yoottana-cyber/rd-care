import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {homeScreenRole,configureRolePwa,PWA_ROLES} from '../web/pwa-role.js';
const data=path=>readFileSync(new URL('../'+path,import.meta.url));
const read=path=>data(path).toString('utf8');
const json=path=>JSON.parse(read(path));
const roles=['staff','student','guardian'];

test('three installed home-screen apps use distinct PWA ids, startup routes and role icons',()=>{
 const ids=new Set(),startUrls=new Set();
 for(const role of roles){
  const m=json('web/manifest-'+role+'.webmanifest');
  assert.equal(m.display,'standalone');
  assert.equal(m.scope,'./');
  assert.equal(m.start_url,'./?login='+role);
  assert.ok(m.id.includes('rd_connect_app='+role));
  assert.match(m.name,/RD CONNECT/);
  assert.match(m.short_name,/RD/);
  assert.ok(!ids.has(m.id),'manifest IDs must be unique');ids.add(m.id);
  assert.ok(!startUrls.has(m.start_url),'start URL must be role-specific');startUrls.add(m.start_url);
  assert.deepEqual(m.icons.map(i=>i.sizes),['192x192','512x512']);
  for(const icon of m.icons){
   assert.equal(icon.type,'image/png');
   assert.match(icon.src,new RegExp('icons/'+role+'-'));
   const bin=data('web/'+icon.src.replace('./',''));
   assert.equal(bin.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.equal(bin.readUInt32BE(16),Number(icon.sizes.split('x')[0]));
  }
 }
 const pngs=roles.map(role=>data('web/icons/'+role+'-192.png'));
 assert.notDeepEqual(pngs[0],pngs[1]);
 assert.notDeepEqual(pngs[0],pngs[2]);
 assert.notDeepEqual(pngs[1],pngs[2]);
});
test('role resolver respects explicit login, attendance push, QR gate and guardian notices',()=>{
 for(const role of roles){
  assert.equal(homeScreenRole('?login='+role),role);
 }
 assert.equal(homeScreenRole('?late_qr=gate&login=guardian'),'student');
 assert.equal(homeScreenRole('?portal_notice=truancy&notice_id=7'),'guardian');
 assert.equal(homeScreenRole('?tab=advisorCenter&notice_kind=truancy&notice_id=6'),'staff');
 assert.equal(homeScreenRole(''),null);
 assert.equal(homeScreenRole('?login=incorrect'),null);
});
function fakeDoc(){
 const nodes=[],head={appendChild(el){nodes.push(el);el.isConnected=true}};
 const element=tag=>({
  tag,attrs:{},isConnected:false,setAttribute(k,v){this.attrs[k]=v},
  getAttribute(k){return this.attrs[k]},
  remove(){const n=nodes.indexOf(this);if(n>=0)nodes.splice(n,1);this.isConnected=false}
 });
 function match(selector){
  const link=/^link\[rel="([^"]+)"\](?:\[type="([^"]+)"\])?$/.exec(selector);
  const meta=/^meta\[(name)="([^"]+)"\]$/.exec(selector);
  return nodes.filter(n=>link?n.tag==='link'&&n.attrs.rel===link[1]&&(!link[2]||n.attrs.type===link[2]):
   meta?n.tag==='meta'&&n.attrs[meta[1]]===meta[2]:false);
 }
 return{head,documentElement:{dataset:{}},title:'',createElement:element,
  querySelector(selector){return match(selector)[0]||null},
  querySelectorAll(selector){return match(selector)}};
}
test('dynamic manifest, favicon and iOS home icon change with each selected role',()=>{
 const doc=fakeDoc();
 for(const role of roles){
  assert.equal(configureRolePwa('?login='+role,doc),role);
  assert.equal(doc.querySelectorAll('link[rel="manifest"]').length,1);
  assert.equal(doc.querySelector('link[rel="manifest"]').getAttribute('href'),PWA_ROLES[role].manifest);
  assert.equal(doc.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'),PWA_ROLES[role].icon);
  assert.equal(doc.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content'),PWA_ROLES[role].name);
  assert.equal(doc.documentElement.dataset.rdPwaRole,role);
  assert.match(doc.title,/RD CONNECT/);
 }
 assert.equal(configureRolePwa('',doc),null);
 assert.equal(doc.querySelectorAll('link[rel="manifest"]').length,0,'no ambiguous generic installation');
});
test('login choice is browser-only; all installed app launches bypass selection',()=>{
 const app=read('web/app.js'),portal=read('web/portal-ui.js'),index=read('web/index.html');
 assert.doesNotMatch(index,/<link rel="manifest"/);
 assert.match(app,/configureRolePwa\(location\.search\)/);
 assert.match(app,/const entrance=resolveLoginEntrance\(location\.search\)/);
 assert.match(app,/if\(entrance==='student'\|\|entrance==='guardian'\)/);
 assert.match(app,/if\(!state\.token\)\{renderLogin\(\);return\}/);
 assert.match(app,/isInstalledPwa\(\)/);
 assert.match(app,/loginInstallApp/);
 assert.match(portal,/id="portalInstallApp"/);
 assert.match(portal,/isInstalledPwa\(\)/);
 assert.match(read('web/sw.js'),/manifest-staff\.webmanifest/);
 assert.match(read('web/sw.js'),/manifest-student\.webmanifest/);
 assert.match(read('web/sw.js'),/manifest-guardian\.webmanifest/);
});
test('student and guardian remembered login credentials are role-scoped, old tokens still load',()=>{
 const portal=read('web/portal-ui.js');
 assert.match(portal,/rd_portal_guardian_token/);
 assert.match(portal,/rd_portal_student_token/);
 assert.match(portal,/readAuthSession\('rd_portal_token'\)/);
 assert.match(portal,/saveAuthSession\(activeTokenKey/);
 assert.match(portal,/clearAuthSession\(activeTokenKey/);
});
