import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const verifyWebp=path=>{
 const bytes=readFileSync(new URL('../'+path,import.meta.url));
 assert.equal(bytes.toString('ascii',0,4),'RIFF');
 assert.equal(bytes.toString('ascii',8,12),'WEBP');
 assert.equal(bytes.readUInt32LE(4)+8,bytes.length);
 return bytes;
};
test('school photo and official Ratsada crest bundled locally as valid WebP assets',()=>{
 const photo=verifyWebp('web/media/ratsada-campus.webp');
 const logo=verifyWebp('web/media/ratsada-crest.webp');
 assert.ok(photo.byteLength>2000);
 assert.ok(logo.byteLength>2000);
});
test('staff login uses Ratsada school full name, official crest, role tabs and developer credit',()=>{
 const app=read('web/app.js');
 const region=app.slice(app.indexOf('function loginPage(){'),app.indexOf('function renderLogin(){'));
 assert.match(region,/ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา/);
 assert.match(region,/src="\.\/media\/ratsada-crest\.webp"/);
 assert.match(region,/พัฒนาโดย ครูยุทธนา บุญจันทร์/);
 for(const id of ['loginForm','username','password','portalStudentLogin','portalGuardianLogin','studentLateEntry'])
  assert.ok(region.includes(id),id);
 assert.match(app,/api\/auth\/login/);
 assert.match(app,/portalUi\.showLogin\('student'\)/);
 assert.match(app,/portalUi\.showLogin\('guardian'\)/);
});
test('student guardian login shares school design and retains separate token-scoped portal authentication',()=>{
 const portal=read('web/portal-ui.js');
 assert.match(portal,/function frame\(inner,login=false\)/);
 assert.match(portal,/login-brand/);
 assert.match(portal,/พัฒนาโดย ครูยุทธนา บุญจันทร์/);
 assert.match(portal,/portalBackTop/);
 assert.match(portal,/api\/portal\/auth\/login/);
 assert.match(portal,/data-role="student"/);
 assert.match(portal,/data-role="guardian"/);
 assert.match(portal,/frame\(`[\s\S]*?`,true\)/);
 assert.match(portal,/rd_portal_token/);
});
test('login style is scoped, mobile responsive and does not change the dashboard palette',()=>{
 const css=read('web/login.css');
 assert.match(css,/\.login-wrap\{/);
 assert.match(css,/url\('\.\/media\/ratsada-campus\.webp'\)/);
 assert.match(css,/\.login-role-tabs/);
 assert.match(css,/\[data-theme="dark"\] \.login-wrap/);
 assert.match(css,/@media\(max-width:570px\)/);
 assert.match(css,/focus-visible/);
 const meta=read('web/index.html');
 assert.match(meta,/stylesheet" href="\.\/login\.css"/);
 assert.match(meta,/ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา/);
});
test('new login assets are precached for PWA and remain self-hosted',()=>{
 const sw=read('web/sw.js');
 for(const name of ['login.css','ratsada-campus.webp','ratsada-crest.webp'])
  assert.ok(sw.includes(name),name);
 assert.match(sw,/rd-care-shell-v23/);
 const index=read('web/index.html');
 assert.match(index,/img-src 'self' data:/);
 const manifest=JSON.parse(read('web/manifest.webmanifest'));
 assert.equal(manifest.theme_color,'#098a55');
});
