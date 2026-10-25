import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExampleXlsx} from '../web/template-xlsx.js';

function contents(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const decoder=new TextDecoder();
 const result=new Map();
 let i=0;
 while(i+30<bytes.length && view.getUint32(i,true)===0x04034b50){
  const len=view.getUint16(i+26,true),extra=view.getUint16(i+28,true),compressed=view.getUint32(i+18,true);
  const name=decoder.decode(bytes.slice(i+30,i+30+len));
  const offset=i+30+len+extra;
  result.set(name,decoder.decode(bytes.slice(offset,offset+compressed)));
  i=offset+compressed;
 }
 return result;
}
test('browser-generated Excel example has all three sheets and correct Thai classroom labels',()=>{
 const bytes=buildExampleXlsx();
 assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
 const entries=contents(bytes);
 const workbook=entries.get('xl/workbook.xml');
 assert.match(workbook,/name="Students"/);
 assert.match(workbook,/name="Instructions"/);
 assert.match(workbook,/name="Rooms"/);
 const students=entries.get('xl/worksheets/sheet1.xml');
 assert.match(students,/<c r="A2"[^>]*><is><t>ม\.1\/1<\/t><\/is><\/c>/);
 assert.match(students,/<c r="A3"[^>]*><is><t>ม\.2\/3<\/t><\/is><\/c>/);
 assert.match(students,/<c r="A4"[^>]*><is><t>ม\.3\/2<\/t><\/is><\/c>/);
 assert.match(students,/<c r="C2" s="2" t="inlineStr">/);
 assert.match(entries.get('xl/worksheets/sheet3.xml'),/ม\.6\/7/);
 assert.match(entries.get('xl/styles.xml'),/name val="Tahoma"/);
});
