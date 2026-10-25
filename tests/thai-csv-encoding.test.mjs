import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCsvBytes} from '../web/csv-encoding.js';
import {csvRows,prepareRows} from '../web/unified-import.js';

const header='classroom,roll_no,student_no,full_name,username,password\n';
const sample=header+'ม.3/8,1,10458,นักเรียน ทดสอบ,10458,pass1234\n';
// Captured from the genuine Windows-874 bytes used by Thai Excel exports.
const legacyHex='636c617373726f6f6d2c726f6c6c5f6e6f2c73747564656e745f6e6f2c66756c6c5f6e616d652c757365726e616d652c70617373776f72640ac12e332f382c312c31303435382cb9d1a1e0c3d5c2b920b7b4cacdba2c31303435382c70617373313233340a';
const legacyBytes=Uint8Array.from(Buffer.from(legacyHex,'hex'));

test('Thai Excel Windows-874 CSV restores exact classroom and student name without replacement glyphs',()=>{
 const result=decodeCsvBytes(legacyBytes);
 assert.equal(result.encoding,'windows-874');
 assert.equal(result.text,sample);
 const parsed=prepareRows(csvRows(result.text),[{id:1,label:'ม.3/8'}]);
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].status,'ready');
 assert.equal(parsed[0].values.classroom,'ม.3/8');
 assert.equal(parsed[0].values.full_name,'นักเรียน ทดสอบ');
});
test('CSV UTF-8 with Thai labels and leading BOM does not require Windows-874',()=>{
 const utf8=new TextEncoder().encode('\ufeff'+sample);
 const result=decodeCsvBytes(utf8);
 assert.equal(result.encoding,'utf-8');
 assert.equal(result.text,sample);
});
test('UTF-8 forced on Windows-874 bytes refuses to silently corrupt Thai',()=>{
 assert.throws(()=>decodeCsvBytes(legacyBytes,'utf-8'),/ไม่สามารถอ่าน/);
});
test('invalid replacement glyph cannot pass into school import',()=>{
 assert.throws(()=>decodeCsvBytes(new TextEncoder().encode(header+'�.3/8,1,10458,ทดสอบ,10458,pass1234\n')),/อักขระเสียหาย/);
});
test('UTF-16 Excel CSV is refused with actionable encoding guidance',()=>{
 assert.throws(()=>decodeCsvBytes(Uint8Array.from([0xff,0xfe,0x41,0x00])),/UTF-16/);
});
test('all 41 rows of a classroom CSV can be decoded before preview',()=>{
 const first=legacyBytes.slice(0,legacyBytes.indexOf(10)+1);
 const line=legacyBytes.slice(first.length);
 const lines=[first];
 for(let i=0;i<41;i++){
  // CSV fields are pure ASCII except classroom and name.
  const parts=Buffer.from(line).toString('binary').split(',');
  parts[1]=String(i+1);
  parts[2]=String(10458+i);
  parts[4]=String(10458+i);
  lines.push(Buffer.from(parts.join(','),'binary'));
 }
 const {text}=decodeCsvBytes(new Uint8Array(Buffer.concat(lines)));
 const parsed=prepareRows(csvRows(text),[{id:1,label:'ม.3/8'}]);
 assert.equal(parsed.length,41);
 assert.equal(parsed.filter(p=>p.status==='ready').length,41);
});
