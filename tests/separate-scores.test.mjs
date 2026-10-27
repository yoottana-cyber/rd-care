import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreSummary,scoreType,scoreColumns,meritWhen,violationWhen,improvementWhen} from '../worker/src/score-ledger.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
import worker from '../worker/src/worker.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const post=(path,body)=>new Request('https://rd-care.test'+path,
 {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('independent score categories never net merits against misconduct',()=>{
 assert.deepEqual(scoreSummary({good_total:20,behavior_deducted:10,behavior_adjusted:0}),
  {good_total:20,behavior_deducted:10,behavior_adjusted:0,behavior_remaining:10});
 assert.deepEqual(scoreSummary({good_total:20,behavior_deducted:10,behavior_adjusted:5}),
  {good_total:20,behavior_deducted:10,behavior_adjusted:5,behavior_remaining:5});
 assert.equal(scoreSummary({good_total:20,behavior_deducted:10,behavior_adjusted:20}).behavior_remaining,0);
 assert.equal(scoreType({points:20,affairs_category:'good'}),'good');
 assert.equal(scoreType({points:15,affairs_category:null}),'good');
 assert.equal(scoreType({points:-5,affairs_category:'minor'}),'behavior');
 assert.equal(scoreType({points:5,affairs_category:'adjustment'}),'adjustment');
 const sql=scoreColumns('b');
 assert.ok(sql.includes(meritWhen('b')));
 assert.ok(sql.includes(violationWhen('b')));
 assert.ok(sql.includes(improvementWhen('b')));
});
test('unassigned teacher cannot create or edit improvement credit policies',async()=>{
 const env={DB:{prepare(){throw Error('Unauthorized DB read')}}};
 for(const path of ['/api/affairs/behavior/adjustment-rules']){
  await assert.rejects(()=>studentAffairsRoutes(new Request('https://rd-care.test'+path),
   env,{role:'teacher',id:1,student_affairs:0},path),{code:403});
  await assert.rejects(()=>studentAffairsRoutes(post(path,{name:'test',points:5}),
   env,{role:'teacher',id:1,student_affairs:0},path),{code:403});
 }
});
test('only active improvement rule points are applied; raw points are forbidden',async()=>{
 const queries=[],actor={id:9,role:'staff',student_affairs:1};
 const env={DB:{prepare(sql){
  const item={sql,args:[]};queries.push(item);
  return {bind(...args){item.args=args;
   return {first:async()=>{
    if(sql.includes('SELECT id FROM students'))return {id:15};
    if(sql.includes('FROM affairs_adjustment_rules'))return {id:7,name:'ปรับพฤติกรรม 5 คะแนน',points:5,active:1};
    return null;
   },run:async()=>({meta:{last_row_id:88,changes:1}})};
  }};
 }}};
 const path='/api/affairs/behavior/adjust';
 await assert.rejects(()=>studentAffairsRoutes(post(path,{student_id:15,points:50,
  adjustment_rule_id:7,reason:'ทดสอบ'}),env,actor,path),{code:400});
 const result=await studentAffairsRoutes(post(path,{student_id:15,
  adjustment_rule_id:7,reason:'กิจกรรมปรับพฤติกรรมที่ผ่านการตรวจสอบ'}),env,actor,path);
 assert.equal(result.status,201);
 const body=await result.json();
 assert.equal(body.points,5);
 assert.equal(body.category,'adjustment');
 const insert=queries.find(x=>x.sql.includes('INSERT INTO behavior_records'));
 assert.ok(insert.sql.includes('WHERE ?>0 AND ?<='));
 assert.ok(insert.sql.includes("WHEN affairs_category='adjustment'"));
 assert.deepEqual(insert.args,[15,5,'กิจกรรมปรับพฤติกรรมที่ผ่านการตรวจสอบ',9,7,5,5,15]);
});
test('improvement transaction rejects adjustment if there is no misconduct outstanding',async()=>{
 const actor={id:2,role:'admin'},path='/api/affairs/behavior/adjust';
 const db={prepare(sql){return {bind(){return {
  first:async()=>sql.includes('SELECT id FROM students')?{id:5}:{id:2,name:'ปรับ 10',points:10,active:1},
  run:async()=>({meta:{changes:0}})
 }}}}};
 await assert.rejects(()=>studentAffairsRoutes(post(path,{student_id:5,
  adjustment_rule_id:2,reason:'ปฏิบัติตามข้อตกลง'}),{DB:db},actor,path),{code:409});
});
test('old unrestricted point endpoint is disabled and approved rules remain in effect',async()=>{
 const result=await worker.fetch(post('/api/behavior',{student_id:1,points:50,reason:'no approval'}),{});
 assert.equal(result.status,401); // unauthenticated first
 const source=read('worker/src/worker.js');
 assert.match(source,/if\(req\.method==='POST'&&path==='\/api\/behavior'\)/);
 assert.match(source,/กรุณาบันทึกผ่านเกณฑ์ความดี/);
 assert.doesNotMatch(source,/return addBehavior\(req,env,user\)/);
});
test('student/guardian and staff all display distinct merit, misconduct, and improvement totals',()=>{
 const portal=read('worker/src/portal.js');
 const portalUi=read('web/portal-ui.js');
 const staffUi=read('web/app.js');
 const affairs=read('web/student-affairs.js');
 for(const term of ['good_total','behavior_remaining','behavior_adjusted']){
  assert.ok(portal.includes(term)||portal.includes('...scores'));
  assert.ok(portalUi.includes(term),term);
  assert.ok(affairs.includes(term),term);
 }
 assert.match(staffUi,/\['good','คะแนนความดี'/);
 assert.match(staffUi,/\['behavior','คะแนนพฤติกรรม'/);
 assert.match(affairs,/affairsAdjustment/);
 assert.match(affairs,/adjustment_rule_id/);
 assert.doesNotMatch(affairs,/name="points" min="-50" max="50"/);
});
