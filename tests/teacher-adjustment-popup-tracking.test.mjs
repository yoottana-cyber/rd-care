import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const teacher={id:37,role:'teacher',student_affairs:0};
const root='https://rd-care.test';
const req=(path,method='GET',body)=>new Request(root+path,{
 method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)
});
function db({hasAccess=true,points=5,balance=10}={}){
 const queries=[];
 const DB={prepare(sql){
  const statement={sql,args:[]};queries.push(statement);
  return {
   bind(...args){
    statement.args=args;
    return {
     first:async()=>{
      if(sql.includes('SELECT s.id FROM students s'))return hasAccess?{id:51}:null;
      if(sql.includes('FROM affairs_adjustment_rules'))return {id:2,name:'กิจกรรมดูแลสภาพแวดล้อม',points,active:1};
      return null;
     },
     all:async()=>({results:[{id:2,name:'กิจกรรมดูแลสภาพแวดล้อม',points}]}),
     run:async()=>({meta:{changes:balance>=points?1:0,last_row_id:123}})
    };
   },
   all:async()=>({results:[{id:2,name:'กิจกรรมดูแลสภาพแวดล้อม',points}]})
  };
 }};
 return {DB,queries};
}
test('all teachers can read only approved active adjustment choices, not staff rule configuration',async()=>{
 const path='/api/affairs/behavior/approved-adjustments',ctx=db();
 const result=await studentAffairsRoutes(req(path),{DB:ctx.DB},teacher,path);
 assert.equal(result.status,200);
 assert.equal((await result.json()).items.length,1);
 assert.match(ctx.queries[0].sql,/WHERE active=1/);
 await assert.rejects(()=>studentAffairsRoutes(req('/api/affairs/behavior/adjustment-rules'),
  {DB:ctx.DB},teacher,'/api/affairs/behavior/adjustment-rules'),{code:403});
 await assert.rejects(()=>studentAffairsRoutes(req('/api/affairs/behavior/adjustment-rules','POST',{points:50}),
  {DB:ctx.DB},teacher,'/api/affairs/behavior/adjustment-rules'),{code:403});
});
test('teacher can apply approved adjustment to an eligible pupil; blank details use rule name',async()=>{
 const ctx=db(),path='/api/affairs/behavior/adjust';
 const result=await studentAffairsRoutes(req(path,'POST',{student_id:51,adjustment_rule_id:2,reason:''}),
  {DB:ctx.DB},teacher,path);
 assert.equal(result.status,201);
 const b=await result.json();
 assert.equal(b.points,5);assert.equal(b.category,'adjustment');
 const insert=ctx.queries.find(x=>x.sql.includes('INSERT INTO behavior_records'));
 assert.equal(insert.args[0],51);
 assert.equal(insert.args[1],5);
 assert.equal(insert.args[2],'กิจกรรมดูแลสภาพแวดล้อม');
 assert.match(insert.sql,/deleted_at IS NULL/);
});
test('teacher cannot adjust student outside authorized classes',async()=>{
 const ctx=db({hasAccess:false}),path='/api/affairs/behavior/adjust';
 await assert.rejects(()=>studentAffairsRoutes(req(path,'POST',
  {student_id:52,adjustment_rule_id:2,reason:'ร่วมกิจกรรม'}),{DB:ctx.DB},teacher,path),{code:403});
 assert.equal(ctx.queries.filter(x=>x.sql.includes('INSERT INTO behavior_records')).length,0);
});
test('teacher cannot submit raw points, unauthorized or out-of-balance adjustment',async()=>{
 const path='/api/affairs/behavior/adjust',ctx=db({balance:0});
 await assert.rejects(()=>studentAffairsRoutes(req(path,'POST',{student_id:51,
  adjustment_rule_id:2,points:50}),{DB:ctx.DB},teacher,path),{code:400});
 await assert.rejects(()=>studentAffairsRoutes(req(path,'POST',{student_id:51,
  adjustment_rule_id:2}),{DB:ctx.DB},teacher,path),{code:409});
});
test('affairs details use modal dialog with X, keyboard escape, focus trap and backdrop dismiss',()=>{
 const ui=source('web/student-affairs.js'),css=source('web/student-affairs.css');
 for(const token of ['id="affairsStudentOverlay"','role="dialog"','aria-modal="true"',
  'id="affairsMonitorClose"','rd-affairs-modal-x',"event.key==='Escape'","event.key!=='Tab'",
  "event.target===el","document.getElementById('affairsMonitorClose')?.focus()"])
  assert.ok(ui.includes(token),token);
 assert.match(css,/position:fixed;inset:0/);
 assert.match(css,/max-height:calc\(100dvh/);
 assert.match(css,/overflow:auto/);
});
test('Student Affairs has a distinct adjustment follow-up tab with filters, statuses and score detail popup',()=>{
 const ui=source('web/student-affairs.js');
 for(const token of ["['adjustments','📈','ติดตามการปรับพฤติกรรม']",
  "if(tab==='adjustments')return trackAdjustments()", 'async function trackAdjustments',
  'behavior_deducted','behavior_adjusted','behavior_remaining','affairsAdjustmentStatus',
  'affairsAdjustmentGrade','affairsAdjustmentQuery','data-monitor-detail','monitorDetailModal()'])
  assert.ok(ui.includes(token),token);
 const teacherUi=source('web/behavior-adjustment.js');
 for(const token of ['adjustmentRecordForm','adjustmentRoom','adjustmentRule',
  '/api/affairs/behavior/approved-adjustments','/api/affairs/behavior/adjust/bulk',
  'adjustmentReason','adjustmentToggleRoom'])
  assert.ok(teacherUi.includes(token),token);
 assert.doesNotMatch(source('web/score-recording.js'),/scoreAdjustmentForm/);
});
