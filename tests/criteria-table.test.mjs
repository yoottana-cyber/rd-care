import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RULE_GROUPS,visibleCriteria,criteriaTableMarkup} from '../web/criteria-table.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const actor={id:7,role:'teacher',student_affairs:1};
const post=(path,data)=>new Request('https://rd-care.test'+path,{method:'POST',
 headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const data=[
 {id:5,name:'ความผิดเล็กน้อย ข',category:'minor',points:-5,active:1},
 {id:6,name:'ความผิดเล็กน้อย ก',category:'minor',points:-80,active:1},
 {id:7,name:'ผิดปานกลาง',category:'moderate',points:-30,active:1},
 {id:8,name:'ร้ายแรง',category:'serious',points:-100,active:0},
 {id:9,name:'ร้ายแรงมาก',category:'very_serious',points:-900,active:1},
 {id:10,name:'หนีเรียนในแต่ละคาบเรียน',category:'moderate',points:-10,active:1,automatic:1},
 {id:11,name:'ทำความดี',category:'good',points:120,active:1}
];
function env({protectedRule=false,changes=1}={}){
 const calls=[];
 const DB={prepare(sql){
  const record={sql,args:[]};calls.push(record);
  const stmt={
   first:async()=>protectedRule?{protected:1}:null,
   run:async()=>({meta:{changes,last_row_id:99}}),
   all:async()=>({results:data})
  };
  return {...stmt,bind(...args){record.args=args;return stmt}};
 }};
 return {DB,calls};
}
test('severity groups are ordered and every group sorts points numerically ascending',()=>{
 assert.deepEqual(RULE_GROUPS.map(x=>x.key),['minor','moderate','serious','very_serious']);
 assert.deepEqual(visibleCriteria(data,{mode:'behavior'}).map(x=>x.id),[6,5,7,10,8,9]);
 assert.deepEqual(visibleCriteria(data,{mode:'behavior',category:'minor'}).map(x=>x.points),[-80,-5]);
 assert.deepEqual(visibleCriteria(data,{mode:'good'}).map(x=>x.id),[11]);
});
test('table is accessible, color-coded, paginated, searchable and safely escaped',()=>{
 const full=criteriaTableMarkup(data,{mode:'behavior',pageSize:'all'});
 for(const level of RULE_GROUPS)assert.match(full,new RegExp('rd-criteria-level-'+level.key));
 assert.match(full,/คะแนน ↑/);
 assert.match(full,/data-affairs-rule-edit="5"/);
 assert.match(full,/data-affairs-rule-delete="5"/);
 assert.match(full,/หนีเรียนในแต่ละคาบเรียน/);
 assert.doesNotMatch(full,/data-affairs-rule-delete="10"/);
 const quick=criteriaTableMarkup(data,{mode:'behavior',category:'minor',query:' ก'});
 assert.match(quick,/ความผิดเล็กน้อย ก/);
 assert.doesNotMatch(quick,/ความผิดเล็กน้อย ข/);
 const long=Array.from({length:59},(_,i)=>({id:i+50,name:'เกณฑ์ '+i,category:'minor',points:i-59,active:1}));
 assert.equal(visibleCriteria(long,{mode:'behavior'}).length,59);
 assert.match(criteriaTableMarkup(long,{mode:'behavior',pageSize:25,page:2}),/26–50 จาก 59/);
 const html=criteriaTableMarkup([{id:15,name:'<img src=x onerror=alert(1)>',category:'minor',points:-4,active:1}],{mode:'behavior'});
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/&lt;img/);
});
test('authorized school affairs staff can archive misconduct rule with audit history',async()=>{
 const path='/api/affairs/behavior/rules/delete';
 const x=env();
 const response=await studentAffairsRoutes(post(path,{id:15}),x,actor,path);
 assert.deepEqual(await response.json(),{ok:true,id:15,archived:true});
 assert.match(x.calls.find(y=>y.sql.includes('UPDATE affairs_behavior_rules')).sql,/deleted_at=CURRENT_TIMESTAMP/);
 assert.deepEqual(x.calls.find(y=>y.sql.includes('UPDATE affairs_behavior_rules')).args,[7,15]);
 assert.ok(x.calls.find(y=>y.sql.includes('INSERT INTO audit_logs')));
 assert.equal(x.calls.some(y=>/DELETE FROM affairs_behavior_rules/.test(y.sql)),false);
});
test('protected automatic truancy criterion cannot be removed',async()=>{
 const path='/api/affairs/behavior/rules/delete';
 const x=env({protectedRule:true});
 await assert.rejects(studentAffairsRoutes(post(path,{id:15}),x,actor,path),{code:409});
 assert.equal(x.calls.some(y=>y.sql.includes('UPDATE affairs_behavior_rules')),false);
});
test('adjustment criteria use the same safe archiving, not permanent deletion',async()=>{
 const path='/api/affairs/behavior/adjustment-rules/delete',x=env();
 const response=await studentAffairsRoutes(post(path,{id:18}),x,actor,path);
 assert.deepEqual(await response.json(),{ok:true,id:18,archived:true});
 assert.match(x.calls.find(y=>y.sql.includes('UPDATE affairs_adjustment_rules')).sql,/active=0,deleted_at=CURRENT_TIMESTAMP/);
 assert.ok(x.calls.some(y=>y.sql.includes('INSERT INTO audit_logs')&&y.args.includes('affairs_adjustment_rule_archived')));
});
test('unauthorized teachers cannot delete school rules',async()=>{
 for(const path of ['/api/affairs/behavior/rules/delete','/api/affairs/behavior/adjustment-rules/delete']){
  const x=env();
  await assert.rejects(studentAffairsRoutes(post(path,{id:1}),x,
   {id:7,role:'teacher',student_affairs:0},path),{code:403});
  assert.equal(x.calls.length,0);
 }
});
test('deleted criteria never show in management, updates or Excel template catalog',()=>{
 const ui=read('web/student-affairs.js');
 const backend=read('worker/src/student-affairs.js');
 const importer=read('worker/src/criteria-excel-import.js');
 const migr=read('worker/migrations/0042_criteria_soft_delete.sql');
 const sw=read('web/sw.js');
 assert.match(ui,/id="affairsRuleTableArea"/);
 assert.match(ui,/id="affairsRuleSearch"/);
 assert.match(ui,/id="affairsRuleCategory"/);
 assert.match(ui,/id="affairsRulePageSize"/);
 assert.match(ui,/data-affairs-rule-delete/);
 assert.match(ui,/\/api\/affairs\/behavior\/rules\/delete/);
 assert.match(backend,/WHERE deleted_at IS NULL/);
 assert.match(importer,/WHERE r.deleted_at IS NULL/);
 assert.match(migr,/ALTER TABLE affairs_behavior_rules ADD COLUMN deleted_at/);
 assert.match(migr,/ALTER TABLE affairs_adjustment_rules ADD COLUMN deleted_at/);
 assert.match(sw,/\.\/criteria-table\.js/);
});
