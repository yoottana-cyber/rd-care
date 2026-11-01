import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatThaiDate,formatThaiDateTime} from '../web/thai-date.js';

const file=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');

test('date-only ISO is shown in Thai Buddhist Era without shifting the calendar day',()=>{
 assert.equal(formatThaiDate('2026-11-01'),'1 พ.ย. 2569');
 assert.equal(formatThaiDate('2026-01-01'),'1 ม.ค. 2569');
 assert.equal(formatThaiDate('2026-12-31'),'31 ธ.ค. 2569');
 assert.equal(formatThaiDate('2026-02-29'),'2026-02-29','invalid dates must not be misrepresented');
 assert.equal(formatThaiDate(''), '—');
});

test('SQLite UTC timestamp is displayed using Asia/Bangkok day, Thai month and Buddhist Era',()=>{
 const displayed=formatThaiDateTime('2026-10-31 17:00:00');
 assert.match(displayed,/1 พ\.ย\. 2569/);
 assert.match(displayed,/00:00/);
 assert.match(formatThaiDateTime('2026-11-01T09:21:00Z'),/1 พ\.ย\. 2569/);
 assert.match(formatThaiDateTime('2026-11-01T09:21:00+07:00'),/1 พ\.ย\. 2569/);
});

test('ISO values for date controls, API contracts, filters and stored data remain intact',()=>{
 const apiDate='2026-11-01';
 assert.equal(apiDate,'2026-11-01');
 assert.notEqual(formatThaiDate(apiDate),apiDate);
 const app=file('app.js'),late=file('late-gate.js'),affairs=file('student-affairs.js');
 assert.match(app,/input id="day" type="date"/);
 assert.match(late,/encodeURIComponent\(state\.focus\.school_date\)/);
 assert.match(affairs,/encodeURIComponent\(state\.date\)/);
});

test('date views use the shared formatter, and the PWA caches it for offline operation',()=>{
 const files=['app.js','late-gate.js','teacher-daily-work.js','period-center.js',
  'student-affairs.js','student-message-ui.js','term-snapshots.js','portal-ui.js'];
 for(const name of files){
  assert.match(file(name),/from '\.\/thai-date\.js'/,name);
 }
 assert.match(file('app.js'),/formatThaiDate\(a\.school_date\)/);
 assert.match(file('period-center.js'),/formatThaiDateTime\(log\.updated_at\)/);
 assert.match(file('student-affairs.js'),/formatThaiDateTime\(x\.created_at\)/);
 const sw=file('sw.js');
 assert.match(sw,/\.\/thai-date\.js/);
 assert.match(sw,/rd-care-shell-v130/);
});
