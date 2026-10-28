import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deleteOwnBehavior} from '../worker/src/worker.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const req=(path,method='GET',body)=>new Request('https://rd-care.test'+path,{
 method,headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)})
});
test('auto conduct rule is present only for classified period truancy, never for ordinary absence',()=>{
 const ddl=read('worker/migrations/0027_truancy_auto_score.sql');
 assert.match(ddl,/INSERT INTO affairs_behavior_rules\(name,category,points,active\)/);
 assert.match(ddl,/SELECT 'หนีเรียน','moderate',-10,1/);
 assert.match(ddl,/AFTER INSERT ON period_truancy/);
 assert.match(ddl,/AFTER DELETE ON period_truancy/);
 assert.match(ddl,/INSERT INTO truancy_behavior_links/);
 assert.match(ddl,/deleted_at=CURRENT_TIMESTAMP/);
 assert.match(ddl,/deleted_at=NULL,deleted_by=NULL/);
 assert.doesNotMatch(ddl,/AFTER INSERT ON attendance_period|AFTER INSERT ON attendance_daily/);
 const api=read('worker/src/worker.js');
 assert.match(api,/e\.status==='truancy'/);
 assert.match(api,/DELETE FROM period_truancy/);
 assert.match(api,/env\.DB\.batch\(stmts\)/);
});
test('student affairs cannot edit automatic truancy scoring rule',async()=>{
 const path='/api/affairs/behavior/rules',sql=[];
 const db={prepare(query){
  sql.push(query);
  return {bind(){return {first:async()=>({protected:1})}}};
 }};
 const body={id:81,name:'หนีเรียน',category:'moderate',points:-2,active:false};
 await assert.rejects(
  ()=>studentAffairsRoutes(req(path,'POST',body),{DB:db},{id:2,role:'admin'},path),
  {code:409});
 assert.equal(sql.length,1);
 assert.match(sql[0],/FROM truancy_score_policy/);
});
test('attendance-linked auto score cannot be deleted directly through score history',async()=>{
 let wrote=false;
 const env={DB:{prepare(query){
  return {bind(){return {first:async()=>({
   id:45,recorded_by:7,auto_truancy:1
  })}}};
 },batch(){wrote=true;throw Error('Unexpected behavior deletion')}}};
 await assert.rejects(
  ()=>deleteOwnBehavior(req('/api/behavior/records/45/delete','POST',{}),env,
   {id:7,role:'teacher'},'45'),{code:409});
 assert.equal(wrote,false);
});
test('teacher UI warns about -10 and refunds on correction, and manual points screens skip managed rule',()=>{
 const app=read('web/app.js');
 assert.match(app,/หนีเรียน.*-10/);
 assert.match(app,/ไม่หักซ้ำ/);
 assert.match(app,/คืนคะแนน/);
 assert.match(read('web/score-recording.js'),/r\.automatic/);
 assert.match(read('web/student-affairs.js'),/rule\.automatic/);
 const bulk=read('worker/src/behavior-bulk.js');
 assert.match(bulk,/NOT IN \(SELECT rule_id FROM truancy_score_policy\)/);
 const personal=read('worker/src/student-affairs.js');
 assert.match(personal,/NOT IN \(SELECT rule_id FROM truancy_score_policy\)/);
});
