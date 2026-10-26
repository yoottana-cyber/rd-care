import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {userPasswordMinimum,validateUserPassword} from '../worker/src/user-password-policy.js';
import {planAdvisorImport} from '../worker/src/advisor-import.js';
import {prepareAdvisorRows} from '../web/advisor-import.js';

test('teacher allows four-character password, rejects three and identity number',()=>{
 assert.equal(userPasswordMinimum('teacher'),4);
 assert.equal(validateUserPassword('abcd','teacher'),true);
 assert.equal(validateUserPassword('abc','teacher'),false);
 assert.equal(validateUserPassword('1234567890123','teacher'),false);
 assert.equal(validateUserPassword('ab\ncd','teacher'),false);
 assert.equal(validateUserPassword('x'.repeat(129),'teacher'),false);
});
test('staff and admin still require 12 characters, including setup unchanged',()=>{
 for(const role of ['staff','admin']){
  assert.equal(userPasswordMinimum(role),12);
  assert.equal(validateUserPassword('abcd',role),false);
  assert.equal(validateUserPassword('StrongPass123',role),true);
 }
 const backend=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 assert.match(backend,/!validateUserPassword\(pass,b\.role\)/);
 assert.match(backend,/pass\.length<12\|\|pass\.length>128/);
});
test('four-character advisor importer agrees between frontend and backend',()=>{
 const rooms=[{id:1,label:'ม.1/1',advisor_user_id:null}];
 const values={classroom:'ม.1/1',full_name:'ครูตัวอย่าง',username:'teacher001',password:'aBc4'};
 const planned=planAdvisorImport([values],new Map(rooms.map(r=>[r.label,r])));
 assert.equal(planned.ready,true);
 const ui=prepareAdvisorRows([['classroom','full_name','username','password'],
  ['ม.1/1','ครูตัวอย่าง','teacher001','aBc4']],rooms);
 assert.equal(ui[0].status,'ready');
});
test('three-character advisor password fails in frontend and backend',()=>{
 const rooms=[{id:1,label:'ม.1/1',advisor_user_id:null}];
 const values={classroom:'ม.1/1',full_name:'ครูตัวอย่าง',username:'teacher001',password:'abc'};
 assert.equal(planAdvisorImport([values],new Map(rooms.map(r=>[r.label,r]))).ready,false);
 const ui=prepareAdvisorRows([['classroom','full_name','username','password'],
 ['ม.1/1','ครูตัวอย่าง','teacher001','abc']],rooms);
 assert.equal(ui[0].status,'error');
});
test('teacher creation screen switches minimum when choosing staff',()=>{
 const settings=readFileSync(new URL('../web/admin-settings.js',import.meta.url),'utf8');
 assert.match(settings,/password\.minLength=role\.value==='teacher'\?4:12/);
 assert.match(settings,/role\?\.addEventListener\('change',sync\)/);
});
