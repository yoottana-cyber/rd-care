import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedPortalPeriod,portalPeriodMode,validPortalDate} from '../web/portal-date-range.js';

const now='2026-10-27',read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('student and guardian portal defaults to current Bangkok day, not last 30 days',()=>{
 const ui=read('web/portal-ui.js');
 assert.match(ui,/from:today\(\),to:today\(\),filterMode:'today'/);
 assert.match(ui,/state\.from=today\(\);state\.to=state\.from;state\.filterMode='today'/);
 assert.doesNotMatch(ui,/from:minusDays\(today\(\),29\),to:today\(\)/);
 assert.match(ui,/\?student_id='\+studentId/);
 assert.match(ui,/&from='\+encodeURIComponent\(from\)/);
 assert.match(ui,/&to='\+encodeURIComponent\(to\)/);
});
test('today and arbitrary individual school dates resolve to inclusive query bounds',()=>{
 assert.deepEqual(checkedPortalPeriod('today',{},now),{from:now,to:now,mode:'today'});
 assert.deepEqual(checkedPortalPeriod('date',{date:'2026-10-15'},now),
  {from:'2026-10-15',to:'2026-10-15',mode:'date'});
 assert.equal(portalPeriodMode(now,now,now),'today');
 assert.equal(portalPeriodMode('2026-10-15','2026-10-15',now),'date');
});
test('custom range supports 90 inclusive days and rejects reversed or future dates',()=>{
 assert.deepEqual(checkedPortalPeriod('range',{from:'2026-07-30',to:now},now),
  {from:'2026-07-30',to:now,mode:'range'});
 for(const invalid of [
  ['range',{from:'2026-07-29',to:now}],
  ['range',{from:'2026-10-22',to:'2026-10-21'}],
  ['range',{from:'2026-10-26',to:'2026-10-28'}],
  ['range',{from:'',to:now}],
  ['date',{date:'2026-02-30'}],
  ['date',{date:'2026-10-28'}]
 ]){
  assert.throws(()=>checkedPortalPeriod(invalid[0],invalid[1],now),Error);
 }
 assert.equal(validPortalDate('2026-02-30'),false);
 assert.equal(validPortalDate('2024-02-29'),true);
});
test('date selector exists on home and attendance and is shared between guardian/student',()=>{
 const ui=read('web/portal-ui.js');
 assert.match(ui,/dateFilterMarkup\('home'\)/);
 assert.match(ui,/dateFilterMarkup\('history'\)/);
 assert.match(ui,/data-portal-date-selector/);
 assert.match(ui,/bindDateFilters\(\);/);
 assert.match(ui,/checkedPortalPeriod\(state\.filterMode,values,today\(\)\)/);
 assert.match(ui,/if\(changed\)loadRecords\(\);else renderDashboard\(\)/);
 const css=read('web/portal-mobile.css');
 assert.match(css,/rd-portal-date-modes/);
 assert.match(read('web/sw.js'),/portal-date-range\.js/);
});
