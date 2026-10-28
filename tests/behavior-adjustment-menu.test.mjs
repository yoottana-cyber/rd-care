import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBehaviorAdjustment} from '../web/behavior-adjustment.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('teacher adjustment is a standalone app menu, route and dashboard shortcut',()=>{
 const app=read('web/app.js'),nav=read('web/navigation-ui.js');
 assert.match(app,/import \{createBehaviorAdjustment\} from '\.\/behavior-adjustment\.js'/);
 assert.match(app,/const behaviorAdjustment=createBehaviorAdjustment\(/);
 assert.match(app,/\['adjustment','บันทึกการปรับพฤติกรรม','🌱'\]/);
 assert.match(app,/if\(tab==='adjustment'\)return behaviorAdjustment\.load\(\)/);
 assert.match(app,/\['adjustment','🌱','บันทึกการปรับพฤติกรรม'/);
 assert.match(nav,/pages:\['behavior','scoreMonitor','adjustment','good','studentAffairs'\]/);
 assert.match(nav,/adjustment:'บันทึกการปรับพฤติกรรม/);
});

test('conduct and merit have independent forms without duplicate adjustment section',()=>{
 const recording=read('web/score-recording.js');
 assert.doesNotMatch(recording,/scoreAdjustmentForm|scoreAdjustmentStudent|scoreAdjustmentReason/);
 assert.doesNotMatch(recording,/\/api\/affairs\/behavior\/adjust'/);
 assert.match(recording,/\/api\/affairs\/behavior\/record\/bulk/);
});

test('standalone adjustment selects multiple pupils by room or search with balance preview',()=>{
 const page=read('web/behavior-adjustment.js');
 for(const token of ['adjustmentSearchForm','adjustmentRoom','data-adjustment-student','adjustmentRecordForm',
  'adjustmentRule','adjustmentReason','adjustmentToggleRoom','adjustmentClearSelected',
  '/api/affairs/behavior/approved-adjustments','/api/affairs/behavior/students',
  '/api/affairs/behavior/adjust/preview','/api/affairs/behavior/adjust/bulk',
  'scorePopup.open','getTab','adjustment-history','200'])
  assert.ok(page.includes(token),token);
 assert.match(page,/!preview\.all_eligible/);
 assert.match(page,/state\.picked\.clear\(\)/);
 assert.doesNotMatch(page,/\?\.student\.id/);
});

test('adjustment module can initialize with no unauthorized calls or side effects',()=>{
 const adjustment=createBehaviorAdjustment({api:()=>{throw Error('should not call API during initialization')},
  mount:()=>{},safeRun:x=>x(),toast:()=>{},rooms:()=>[],getRoomId:()=>0,
  setRoomId:()=>{},getTab:()=> 'adjustment',escapeHtml:x=>String(x)});
 assert.equal(typeof adjustment.load,'function');
});

test('teacher adjustment page remains a standalone mobile-friendly area with shared styling',()=>{
 const css=read('web/score-recording.css');
 for(const cls of ['.score-adjust-page','.score-adjust-check','.score-adjust-preview',
  '.score-selected-chip','.score-adjust-student-name'])
  assert.ok(css.includes(cls),cls);
});
