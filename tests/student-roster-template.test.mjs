import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildStudentRosterExampleXlsx} from '../web/template-xlsx.js';
import {unzipXlsx} from '../web/xlsx-reader.js';
import {csvRows,prepareRows} from '../web/unified-import.js';

test('new Excel roster example uses four safe fields and preserves Thai and leading zeroes',async()=>{
 const bytes=buildStudentRosterExampleXlsx();
 assert(bytes instanceof Uint8Array);
 assert(bytes.byteLength>1000);
 const entries=await unzipXlsx(bytes.buffer);
 const xml=entries.get('xl/worksheets/sheet1.xml');
 assert.match(xml,/<t>classroom<\/t>/);
 assert.match(xml,/<t>student_no<\/t>/);
 assert.match(xml,/<t>000001<\/t>/);
 assert.match(xml,/นักเรียนตัวอย่าง หนึ่ง/);
 assert.doesNotMatch(xml,/username|password|Password/);
});
test('CSV template is UTF-8 BOM with exactly four fields and no passwords',()=>{
 const contents=readFileSync(new URL('../web/templates/student-roster-import.csv',import.meta.url),'utf8');
 assert(contents.startsWith('\ufeff'));
 const rows=csvRows(contents);
 assert.deepEqual([...rows[0]],['classroom','roll_no','student_no','full_name']);
 assert.equal(rows.length,4);
 assert.equal(rows[1][2],'000001');
 assert.doesNotMatch(contents,/username|password/);
});
test('Admin upload screen shows both templates next to file picker',()=>{
 const ui=readFileSync(new URL('../web/student-file-jobs.js',import.meta.url),'utf8');
 assert.match(ui,/downloadStudentRosterExampleXlsx/);
 assert.match(ui,/id="rdFileJobExcelExample"/);
 assert.match(ui,/templates\/student-roster-import\.csv/);
 assert.match(ui,/id="rdFileJobFile"/);
});
