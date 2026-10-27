import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeCsvBytes} from '../web/csv-encoding.js';
import {csvRows} from '../web/unified-import.js';

const samples=[
 ['advisor-all-rooms-import.csv','classroom,full_name,username,password',4],
 ['student-all-rooms-import.csv','classroom,roll_no,student_no,full_name,username,password',4],
 ['portal-accounts-import.csv','student_no,full_name,student_username,student_password,guardian_name,guardian_username,guardian_password',3],
 ['student-login-import-template.csv','roll_no,student_no,full_name,username,password',4],
];

test('every Thai CSV download has real UTF-8 BOM, Windows line endings and readable Thai in Excel',()=>{
 for(const [file,header,expected] of samples){
  const bytes=readFileSync(new URL('../web/templates/'+file,import.meta.url));
  assert.equal(bytes.subarray(0,3).toString('hex'),'efbbbf',file);
  assert.ok(bytes.includes(Buffer.from('\r\n')),file);
  const decoded=decodeCsvBytes(new Uint8Array(bytes));
  assert.equal(decoded.encoding,'utf-8',file);
  assert.ok(decoded.text.startsWith(header+'\r\n'),file);
  assert.ok(decoded.text.includes('ตัวอย่าง'),file);
  assert.equal(decoded.text.includes('�'),false,file);
  const rows=csvRows(decoded.text);
  assert.equal(rows.length,expected,file);
  assert.equal(rows[0].length,header.split(',').length,file);
 }
});
test('leading-zero student numbers survive CSV decoding and CSV parser (use XLSX to preserve on Excel edits)',()=>{
 const sample=readFileSync(new URL('../web/templates/portal-accounts-import.csv',import.meta.url));
 const rows=csvRows(decodeCsvBytes(sample).text);
 assert.equal(rows[1][0],'000001');
 assert.equal(rows[1][2],'000001');
});
