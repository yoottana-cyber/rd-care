import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adjustmentSelection,previewBehaviorAdjustments,recordBehaviorAdjustmentBulk} from '../worker/src/adjustment-bulk.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';

const user={id:17,role:'teacher',student_affairs:0};
const rule={id:2,name:'ทำกิจกรรมปรับพฤติกรรม',points:5,active:1};
const req=(path,body)=>new Request('https://rd-care.test'+path,
 {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const text=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function fakeDb({allowed=[11,12],outstanding={11:9,12:7},activeRule=rule,batchError=null}={}){
 const calls=[],batches=[];
 const DB={
  prepare(sql){
   const call={sql,args:[]};calls.push(call);
   return {bind(...args){
    call.args=args;
    return {
     first:async()=>activeRule,
     all:async()=>({results:allowed.map(id=>({id,student_no:String(id),
      full_name:'นักเรียน '+id,remaining:outstanding[id]??0}))})
    };
   }};
  },
  batch:async statements=>{
   batches.push(statements);
   if(batchError)throw new Error(batchError);
   return statements.map(()=>({meta:{changes:1}}));
  }
 };
 return {DB,calls,batches};
}
test('only approved positive adjustment rules may be selected and custom points are forbidden',async()=>{
 const bad=fakeDb({activeRule:{...rule,active:0}});
 await assert.rejects(()=>previewBehaviorAdjustments({DB:bad.DB},user,
  {student_ids:[11],adjustment_rule_id:2}),{code:400});
 const env=fakeDb();
 await assert.rejects(()=>recordBehaviorAdjustmentBulk({DB:env.DB},user,
  {student_ids:[11],adjustment_rule_id:2,points:50}),{code:400});
 await assert.rejects(()=>recordBehaviorAdjustmentBulk({DB:env.DB},user,
  {student_ids:[11],adjustment_rule_id:2,reason:10}),{code:400});
 assert.equal(env.batches.length,0);
});
test('valid preview checks every classroom-scoped student and reveals insufficiency without writes',async()=>{
 const env=fakeDb({outstanding:{11:2,12:7}});
 const data=await previewBehaviorAdjustments({DB:env.DB},user,
  {student_ids:[11,12],adjustment_rule_id:2});
 assert.equal(data.all_eligible,false);
 assert.deepEqual(data.items.map(x=>x.eligible),[false,true]);
 assert.equal(data.items[0].remaining,2);
 assert.equal(env.batches.length,0);
 const sql=env.calls.find(x=>x.sql.includes('LEFT JOIN behavior_records')).sql;
 assert.match(sql,/s\.active=1/);
 assert.match(sql,/b\.deleted_at IS NULL/);
 assert.match(sql,/advisor_user_id=\?/);
 assert.match(sql,/teacher_user_id=\?/);
 assert.match(sql,/affairs_category='adjustment'/);
});
test('mixed access student group fails in its entirety, including staff restrictions',async()=>{
 const env=fakeDb({allowed:[11]});
 await assert.rejects(()=>adjustmentSelection({DB:env.DB},user,[11,12]),{code:403});
 assert.equal(env.batches.length,0);
 const path='/api/affairs/behavior/adjust/bulk';
 await assert.rejects(()=>studentAffairsRoutes(req(path,{student_ids:[11,12],
  adjustment_rule_id:2}),{DB:env.DB},user,path),{code:403});
});
test('duplicate, invalid and oversized student lists are rejected',async()=>{
 const env=fakeDb();
 for(const ids of [[],[11,11],[0,12],[11,1.3],Array.from({length:201},(_,i)=>i+1)]){
  await assert.rejects(()=>adjustmentSelection({DB:env.DB},user,ids),{code:400});
 }
 assert.equal(env.batches.length,0);
});
test('all-or-nothing adjustment rejects whole group if any member is below required points',async()=>{
 const env=fakeDb({outstanding:{11:2,12:7}});
 await assert.rejects(()=>recordBehaviorAdjustmentBulk({DB:env.DB},user,
  {student_ids:[11,12],adjustment_rule_id:2,reason:'ผ่านกิจกรรม'}),{code:409});
 assert.equal(env.batches.length,0);
});
test('bulk insert and audit are paired in one D1 batch, with revalidated balance and access',async()=>{
 const env=fakeDb();
 const response=await recordBehaviorAdjustmentBulk({DB:env.DB},user,
  {student_ids:[11,12],adjustment_rule_id:2,reason:''});
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{ok:true,count:2,points:5,
  category:'adjustment',rule_name:rule.name});
 assert.equal(env.batches.length,1);
 assert.equal(env.batches[0].length,4);
 const inserts=env.calls.filter(x=>x.sql.startsWith('INSERT INTO behavior_records'));
 const audit=env.calls.filter(x=>x.sql.startsWith('INSERT INTO audit_logs'));
 assert.equal(inserts.length,2);assert.equal(audit.length,2);
 for(const sql of inserts.map(x=>x.sql)){
  assert.match(sql,/CASE WHEN/);
  assert.match(sql,/ELSE NULL END/);
  assert.match(sql,/deleted_at IS NULL/);
  assert.match(sql,/AND ar\.active=1 AND ar\.points=\?/);
  assert.match(sql,/advisor_user_id=\?/);
  assert.match(sql,/teacher_user_id=\?/);
 }
 assert.ok(audit.every(x=>x.sql.includes('last_insert_rowid()')));
 assert.equal(inserts[0].args[0],11);
 assert.equal(inserts[0].args.at(-3),rule.name);
 assert.equal(inserts[1].args[0],12);
});
test('D1 constraint failure is surfaced as conflict, with no success claim',async()=>{
 const env=fakeDb({batchError:'NOT NULL constraint failed: behavior_records.points'});
 await assert.rejects(()=>recordBehaviorAdjustmentBulk({DB:env.DB},user,
  {student_ids:[11,12],adjustment_rule_id:2}),{code:409});
 assert.equal(env.batches.length,1);
});
test('new endpoints accept teachers while unrelated roles remain forbidden',async()=>{
 const env=fakeDb(),path='/api/affairs/behavior/adjust/bulk';
 const response=await studentAffairsRoutes(req(path,{student_ids:[11,12],adjustment_rule_id:2}),
  {DB:env.DB},user,path);
 assert.equal(response.status,201);
 await assert.rejects(()=>studentAffairsRoutes(req(path,{student_ids:[11],adjustment_rule_id:2}),
  {DB:env.DB},{id:20,role:'guardian'},path),{code:403});
});
test('all three teacher menus open responsive history popup, not inline history tables',()=>{
 const score=text('web/score-recording.js'),adjust=text('web/behavior-adjustment.js');
 const popup=text('web/score-history-popup.js'),css=text('web/score-recording.css');
 assert.match(score,/scorePopup\.open\(\{student:st,mode:key\}\)/);
 assert.match(adjust,/scorePopup\.open\(\{student:st,mode:'behavior'/);
 for(const token of ['role="dialog"','aria-modal="true"','rdScorePopupClose',
  "event.key==='Escape'","event.key!=='Tab",'data-score-delete','rdScorePopupMore',
  'scoreHistoryTables','class="rd-score-popup-overlay"'])assert.ok(popup.includes(token),token);
 assert.match(css,/rd-score-popup-overlay/);
 assert.match(css,/max-height:calc\(100dvh/);
 assert.match(text('web/app.js'),/scorePopup\.close\(\)/);
});
