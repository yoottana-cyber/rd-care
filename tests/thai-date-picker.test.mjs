import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {thaiMonthGrid,thaiDateLabel} from '../web/thai-date-picker.js';
const source=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');

test('Thai date input displays Buddhist Era and keeps the selected ISO day',()=>{
 assert.equal(thaiDateLabel('2026-10-19'),'19 ต.ค. 2569');
 assert.equal(thaiDateLabel('2026-11-01'),'1 พ.ย. 2569');
 assert.equal(thaiDateLabel(''),'เลือกวันที่');
});
test('Thai calendar grid starts on Sunday and handles February leap days',()=>{
 const feb=thaiMonthGrid(2024,2);
 assert.equal(feb.filter(Boolean).length,29);
 assert.equal(feb.find(x=>x?.day===29).value,'2024-02-29');
 assert.equal(thaiMonthGrid(2026,11).filter(Boolean)[0].value,'2026-11-01');
 assert.equal(thaiMonthGrid(2026,11)[0].day,1);
});
test('Thai calendar honors min/max and disables out-of-range days',()=>{
 const grid=thaiMonthGrid(2026,11,{min:'2026-11-05',max:'2026-11-19'}).filter(Boolean);
 assert.equal(grid.find(x=>x.day===4).disabled,true);
 assert.equal(grid.find(x=>x.day===5).disabled,false);
 assert.equal(grid.find(x=>x.day===19).disabled,false);
 assert.equal(grid.find(x=>x.day===20).disabled,true);
});
test('Date picker keeps the original named ISO input, required constraints and change listeners',()=>{
 const picker=source('thai-date-picker.js'),app=source('app.js'),html=source('index.html'),sw=source('sw.js');
 assert.match(picker,/wrap\.append\(input\)/);
 assert.match(picker,/input\.value=value/);
 assert.match(picker,/input\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
 assert.match(picker,/input\.disabled\|\|input\.readOnly/);
 assert.match(picker,/valid\(active\.min\)/);
 assert.match(picker,/valid\(active\.max\)/);
 assert.match(app,/installThaiDatePickers\(\)/);
 assert.match(html,/thai-date-picker\.css/);
 for(const asset of ['thai-date-picker.js','thai-date-picker.css'])assert.ok(sw.includes(asset));
});
