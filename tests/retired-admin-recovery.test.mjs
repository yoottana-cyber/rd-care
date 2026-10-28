import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('staff login has no temporary Admin recovery menu or credential form',()=>{
 const html=read('web/app.js'),css=read('web/login.css');
 assert.doesNotMatch(html,/openAdminRecovery|adminRecoveryForm|adminRecoveryToken|recover-admin/);
 assert.doesNotMatch(css,/login-recovery-panel/);
 assert.match(html,/id="loginForm"/);
 assert.match(html,/api\/auth\/login/);
});
test('retired temporary public recovery endpoint is not reachable from Worker',()=>{
 const worker=read('worker/src/worker.js');
 assert.doesNotMatch(worker,/recoverAdminPassword|api\/auth\/recover-admin/);
 assert.match(worker,/api\/auth\/login/);
 assert.match(worker,/api\/setup/);
});
