import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deleteOwnBehavior,listBehavior} from '../worker/src/worker.js';
import {scoreHistoryTables,scoreDate} from '../web/score-history.js';
import {meritWhen,violationWhen,improvementWhen,scoreColumns} from '../worker/src/score-ledger.js';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const req=(query='student_id=14')=>new Request('https://rd-care.test/api/behavior?'+query);
const actor={id:9,role:'teacher',student_affairs:0};
function mockDelete({recorded_by=9,deleted=false,found=true}={}){
 const calls=[],batches=[];
 const DB={prepare(sql){
  const query={sql,args:[]};calls.push(query);
  return {bind(...args){
   query.args=args;
   return {first:async()=>found?{id:48,recorded_by,...(deleted?{deleted_at:'2026-10-27'}:{})}:null};
  }};
 },batch:async(list)=>{batches.push(list);return [{meta:{changes:1}},{meta:{changes:1}}]}};
 return {DB,calls,batches};
}
test('student scores show separate dates, named actions, details and merit recorder',()=>{
 const html=scoreHistoryTables({mode:'all',esc:s=>String(s).replaceAll('<','&lt;'),items:[
  {id:1,action_name:'ไม่ทำกิจกรรม',score_type:'behavior',points:-5,reason:'<เหตุการณ์>',created_at:'2026-10-28 00:00:00',can_delete:1},
  {id:2,action_name:'ทำความสะอาด',score_type:'good',points:5,reason:'ช่วยโรงเรียน',teacher_name:'ครู ก',created_at:'2026-10-28 00:00:00',can_delete:0},
  {id:3,action_name:'กิจกรรมปรับพฤติกรรม',score_type:'adjustment',points:3,reason:'ดำเนินการตามเกณฑ์',created_at:'2026-10-28 00:00:00',can_delete:0}
 ]});
 for(const name of ['วันที่','ความผิด / การปรับพฤติกรรม','ความดีที่ทำ','คะแนน','รายละเอียด','ผู้ให้คะแนน','ครู ก','ทำความสะอาด','กิจกรรมปรับพฤติกรรม'])
  assert.ok(html.includes(name),name);
 assert.match(html,/&lt;เหตุการณ์>/);
 assert.equal((html.match(/data-score-delete=/g)||[]).length,1);
 assert.ok(scoreDate('2026-10-28 00:00:00').includes('2569'));
});
test('only original score author may delete; all other teachers are denied with no DB write',async()=>{
 const env=mockDelete({recorded_by:42});
 await assert.rejects(()=>deleteOwnBehavior(null,{DB:env.DB},actor,48),{code:403});
 assert.equal(env.batches.length,0);
});
test('missing or previously removed score cannot be deleted again',async()=>{
 const env=mockDelete({found:false});
 await assert.rejects(()=>deleteOwnBehavior(null,{DB:env.DB},actor,48),{code:404});
 assert.equal(env.batches.length,0);
});
test('own deletion is a soft delete plus audit log in one D1 transaction',async()=>{
 const env=mockDelete(),response=await deleteOwnBehavior(null,{DB:env.DB},actor,48);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,deleted_id:48});
 assert.equal(env.batches.length,1);
 assert.equal(env.batches[0].length,2);
 assert.match(env.calls[1].sql,/SET deleted_at=CURRENT_TIMESTAMP,deleted_by=\?/);
 assert.match(env.calls[1].sql,/AND recorded_by=\? AND deleted_at IS NULL/);
 assert.deepEqual(env.calls[1].args,[9,48,9]);
 assert.match(env.calls[2].sql,/affairs_behavior_deleted/);
});
test('pagination and issuer ownership appear in active score history query',async()=>{
 const calls=[];
 const DB={prepare(sql){
  const entry={sql,args:[]};calls.push(entry);
  return {bind(...args){
   entry.args=args;
   return {first:async()=>({id:14,good_total:0,behavior_deducted:2,behavior_adjusted:0}),
    all:async()=>({results:[{id:1,can_delete:1}]})};
  }};
 }};
 const response=await listBehavior(req('student_id=14&offset=0&limit=10'),{DB},{role:'staff',id:9});
 const result=await response.json();
 assert.equal(result.has_more,false);
 assert.equal(result.next_offset,1);
 assert.equal(result.behavior_remaining,2);
 assert.match(calls[1].sql,/WHERE b.student_id=\? AND b.deleted_at IS NULL/);
 assert.match(calls[1].sql,/CASE WHEN b.recorded_by=\? THEN 1 ELSE 0 END AS can_delete/);
 assert.match(calls[1].sql,/LEFT JOIN affairs_adjustment_rules/);
 assert.deepEqual(calls[1].args,[9,14,11,0]);
});
test('deleted records no longer contribute to merit, behavior, adjustment or parent reports',()=>{
 const ddl=source('worker/migrations/0023_behavior_record_soft_delete.sql');
 assert.match(ddl,/ADD COLUMN deleted_at/);
 assert.match(ddl,/ADD COLUMN deleted_by/);
 for(const fn of [meritWhen,violationWhen,improvementWhen])
  assert.match(fn('b'),/b\.deleted_at IS NULL/);
 assert.match(scoreColumns('b'),/b\.deleted_at IS NULL/);
 assert.match(source('worker/src/portal.js'),/b\.deleted_at IS NULL/);
 assert.match(source('worker/src/student-affairs.js'),/b\.deleted_at IS NULL/);
});
test('staff monitor lists every student and supports clickable detailed case/score drilldown',()=>{
 const sourceText=source('web/student-affairs.js');
 assert.match(sourceText,/data-monitor-detail/);
 assert.match(sourceText,/scoreHistoryTables/);
 assert.match(sourceText,/loadMonitorStudentDetail/);
 assert.match(sourceText,/affairsMonitorMore/);
 assert.match(sourceText,/state\.monitorLimit/);
 assert.match(sourceText,/state\.monitorCases/);
 const worker=source('worker/src/student-affairs.js');
 assert.doesNotMatch(worker,/ORDER BY c\.grade,c\.room,s\.roll_no LIMIT 1500/);
});
test('teacher record pages open one shared popup with own-only delete confirmation',()=>{
 const ui=source('web/score-recording.js'),adjust=source('web/behavior-adjustment.js');
 const popup=source('web/score-history-popup.js');
 for(const page of [ui,adjust])assert.match(page,/scorePopup\.open/);
 assert.doesNotMatch(ui,/scoreHistoryTables\(\{/);
 assert.doesNotMatch(adjust,/scoreHistoryTables\(\{/);
 assert.match(popup,/scoreHistoryTables/);
 assert.match(popup,/data-score-delete/);
 assert.match(popup,/window\.confirm/);
 assert.match(popup,/rdScorePopupMore/);
 assert.match(popup,/aria-modal="true"/);
 assert.match(popup,/rdScorePopupClose/);
 assert.match(source('worker/src/worker.js'),/if\(req\.method==='POST'&&recordDelete\)return deleteOwnBehavior/);
});
