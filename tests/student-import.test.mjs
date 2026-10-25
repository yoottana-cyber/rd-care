import test from 'node:test';
import assert from 'node:assert/strict';
import { planStudentImport } from '../worker/src/student-import.js';
import { unzipXlsx } from '../web/xlsx-reader.js';

const rows=[
 {source_row:2,roll_no:1,student_no:'DEMO6001',full_name:'นักเรียนทดสอบ ก'},
 {source_row:3,roll_no:2,student_no:'DEMO6002',full_name:'นักเรียนทดสอบ ข'}
];

test('valid import plans retain source rows and do not change records',()=>{
 const result=planStudentImport(rows,1,[]);
 assert.equal(result.ready,true);
 assert.equal(result.valid,2);
 assert.equal(result.errors,0);
 assert.deepEqual(result.items.map(x=>x.source_row),[2,3]);
 assert.deepEqual(result.items.map(x=>x.status),['ready','ready']);
});
test('checks duplicate IDs across school and rolls within room',()=>{
 const result=planStudentImport(rows,1,[
  {student_no:'demo6001',classroom_id:2,roll_no:21},
  {student_no:'OLD',classroom_id:1,roll_no:2}
 ]);
 assert.equal(result.ready,false);
 assert.equal(result.errors,2);
 assert.match(result.items[0].message,/รหัสนักเรียน/);
 assert.match(result.items[1].message,/เลขที่/);
});
test('duplicate rows in same file and bad values show per-row errors',()=>{
 const result=planStudentImport([
  rows[0],
  {...rows[0],source_row:8,student_no:'demo6001',roll_no:8},
  {...rows[0],source_row:9,student_no:'DEMO6003',roll_no:1},
  {...rows[0],source_row:10,student_no:'',roll_no:99}
 ],1,[]);
 assert.deepEqual(result.items.map(x=>x.status),['ready','error','error','error']);
 assert.equal(result.errors,3);
 assert.deepEqual(result.items.map(x=>x.source_row),[2,8,9,10]);
});
test('rejects imports larger than the per-room 60 student limit',()=>{
 assert.throws(()=>planStudentImport(Array.from({length:61},(_,i)=>({...rows[0],roll_no:i+1})),1,[]),/1–60/);
 assert.throws(()=>planStudentImport([],1,[]));
});

// Create a small, standards-compliant ZIP with two STORED entries.
function zip(entries) {
 const locals=[],centrals=[];let offset=0;
 for(const [name,body] of Object.entries(entries)){
  const filename=Buffer.from(name,'utf8'),data=Buffer.from(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  locals.push(local,filename,data);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);
  central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  centrals.push(central,filename);
  offset+=local.length+filename.length+data.length;
 }
 const dir=Buffer.concat(centrals),eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);
 eocd.writeUInt16LE(Object.keys(entries).length,8);eocd.writeUInt16LE(Object.keys(entries).length,10);
 eocd.writeUInt32LE(dir.length,12);eocd.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,dir,eocd]);
}
test('parses local ZIP workbook entries without fetching external services',async()=>{
 const buffer=zip({'xl/sharedStrings.xml':'<sst><si><t>ชื่อนักเรียน</t></si></sst>',
   'xl/worksheets/sheet1.xml':'<worksheet><sheetData/></worksheet>'});
 const found=await unzipXlsx(buffer);
 assert.match(found.get('xl/sharedStrings.xml'),/ชื่อนักเรียน/);
 assert.match(found.get('xl/worksheets/sheet1.xml'),/worksheet/);
});
test('rejects malformed zip files',async()=>{
 await assert.rejects(unzipXlsx(new Uint8Array([1,2,3,4])),/ไม่ใช่ .xlsx/);
});
