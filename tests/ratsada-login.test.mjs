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
test('official Ratsada school crest remains valid and available locally',()=>{
 const logo=verifyWebp('web/media/ratsada-crest.webp');
 assert.ok(logo.byteLength>2000);
});
test('staff login uses Ratsada identity, school crest with local fallback, and developer credit',()=>{
 const app=read('web/app.js');
 const region=app.slice(app.indexOf('function loginPage(){'),app.indexOf('function renderLogin(){'));
 assert.match(region,/ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา/);
 assert.match(region,/src="https:\/\/www\.ratsada\.ac\.th\/images\/symbol\.png"/);
 assert.match(app,/ratsada-crest\.webp/);
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
test('login style is scoped, responsive and preserves green school identity',()=>{
 const css=read('web/login.css');
 assert.match(css,/\.login-wrap\{/);
 assert.doesNotMatch(css,/ratsada-campus|url\(/);
 assert.match(css,/linear-gradient\(145deg,#f9fdfb/);
 assert.match(css,/\.login-role-tabs/);
 assert.match(css,/\.login-crest/);
 assert.match(css,/object-fit:contain/);
 assert.match(css,/\[data-theme="dark"\] \.login-wrap/);
 assert.match(css,/@media\(max-width:570px\)/);
 assert.match(css,/focus-visible/);
 const meta=read('web/index.html');
 assert.match(meta,/stylesheet" href="\.\/login\.css"/);
 assert.match(meta,/ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา/);
});
test('new login assets are precached for PWA with offline crest fallback',()=>{
 const sw=read('web/sw.js');
 for(const name of ['login.css','ratsada-crest.webp'])
  assert.ok(sw.includes(name),name);
 assert.doesNotMatch(sw,/ratsada-campus\.webp/);
 assert.match(sw,/rd-care-shell-v\\d+/);
 const index=read('web/index.html');
 assert.match(index,/img-src 'self' data:/);
 const manifest=JSON.parse(read('web/manifest.webmanifest'));
 assert.equal(manifest.theme_color,'#098a55');
});
