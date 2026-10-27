import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guardianTruancyItems} from '../worker/src/truancy-push.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function fakeDB(){
 const calls=[];
 return {calls,DB:{prepare(sql){return{bind(...args){
  calls.push({sql,args});
  return{all:async()=>({results:[{id:8,student_id:21,school_date:'2026-10-27'}]})};
 }}}}};
}
test('guardian attendance notifications use selected date bounds with verified family scope',async()=>{
 const env=fakeDB(),account={role:'guardian',id:7};
 const records=await guardianTruancyItems(env,account,{from:'2026-10-20',to:'2026-10-27'});
 assert.equal(records[0].student_id,21);
 assert.match(env.calls[0].sql,/guardian_student_links/);
 assert.match(env.calls[0].sql,/e\.school_date BETWEEN \? AND \?/);
 assert.match(env.calls[0].sql,/e\.student_id/);
 assert.deepEqual(env.calls[0].args,[7,'2026-10-20','2026-10-27']);
});
test('legacy callers retain 30-day notifications and student accounts cannot access them',async()=>{
 const env=fakeDB();
 await guardianTruancyItems(env,{role:'guardian',id:7});
 assert.match(env.calls[0].sql,/e\.school_date>=date\('now','-30 days'\)/);
 assert.deepEqual(env.calls[0].args,[7]);
 const student=await guardianTruancyItems(env,{role:'student',id:9},{from:'2026-10-20',to:'2026-10-27'});
 assert.deepEqual(student,[]);
 assert.equal(env.calls.length,1);
});
test('guardian UI fetches the requested date for the selected child and rejects invalid backend range',()=>{
 const ui=source('web/portal-ui.js'),api=source('worker/src/portal.js');
 assert.match(ui,/\/api\/portal\/truancy\?from='/);
 assert.match(ui,/filter\(e=>Number\(e\.student_id\)===Number\(studentId\)\)/);
 assert.match(ui,/state\.truancy=\(notices\.items\|\|\[\]\)/);
 assert.match(api,/req\.method==='GET'&&path==='\/api\/portal\/truancy'/);
 assert.match(api,/Date\.parse\(to\+'T00:00:00Z'\)-Date\.parse\(from\+'T00:00:00Z'\)>89\*86400000/);
});
