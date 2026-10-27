import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loginHref,resolveLoginEntrance} from '../web/login-route.js';
const read=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');

test('entrance has stable explicit staff, student and guardian links',()=>{
 for(const role of ['staff','student','guardian']){
  assert.equal(loginHref(role),'./?login='+role);
  assert.equal(resolveLoginEntrance('?login='+role),role);
 }
 assert.equal(resolveLoginEntrance(''),null);
 assert.equal(resolveLoginEntrance('?login=admin'),null);
 assert.throws(()=>loginHref('admin'));
});
test('QR scans and Push deep links override the wrong login parameter',()=>{
 assert.equal(resolveLoginEntrance('?login=staff&late_qr=gate'),'student');
 assert.equal(resolveLoginEntrance('?late_qr='+ 'a'.repeat(40)),'student');
 assert.equal(resolveLoginEntrance('?login=student&portal_notice=late&notice_id=17'),'guardian');
 assert.equal(resolveLoginEntrance('?tab=advisorCenter&notice_kind=truancy&notice_id=44'),'staff');
 assert.equal(resolveLoginEntrance('?login=guardian&tab=lateGate&notice_kind=late&notice_id=8'),'staff');
});
test('separated screens and role-specific remembered sessions',()=>{
 const app=read('app.js'),portal=read('portal-ui.js'),sw=read('sw.js');
 for(const role of ['staff','student','guardian'])assert.match(app,new RegExp('data-choice="'+role+'"'));
 assert.match(app,/function showEntrySelection\(\)/);
 assert.match(app,/if\(entrance===null\)\{showEntrySelection\(\);return\}/);
 assert.match(app,/portalUi\.resume\(entrance\)/);
 assert.match(app,/id="loginForm"/);
 assert.match(portal,/id="portalLoginForm"/);
 assert.doesNotMatch(portal,/portal-role-choice/);
 assert.match(portal,/if\(expectedRole&&state\.account\.role!==expectedRole\)/);
 assert.match(sw,/login-route\.js/);
 assert.match(sw,/portal_notice/);
});
