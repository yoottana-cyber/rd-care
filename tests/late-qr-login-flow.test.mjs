import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readLateGateIntent,rememberLateGateIntent,clearLateGateIntent} from '../web/late-qr-intent.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function session(){
 const data=new Map();
 return {
  getItem:key=>data.get(key)??null,
  setItem:(key,value)=>data.set(key,String(value)),
  removeItem:key=>data.delete(key),
  entries:()=>[...data.entries()]
 };
}
test('permanent printed QR survives fresh login and full page reload in same tab',()=>{
 const storage=session(),start=Date.UTC(2026,9,27,2,0);
 assert.equal(readLateGateIntent('?late_qr=gate',storage,start),'gate');
 assert.equal(readLateGateIntent('',storage,start+120_000),'gate');
 assert.equal(readLateGateIntent('?late_qr=gate',storage,start+180_000),'gate');
 assert.equal(readLateGateIntent('',storage,start+181_000),'gate');
});
test('pending gate intent expires after 30 minutes without expiring the printed QR itself',()=>{
 const storage=session(),start=10_000;
 assert.equal(rememberLateGateIntent('gate',storage,start),true);
 assert.equal(readLateGateIntent('',storage,start+30*60*1000),null);
 assert.equal(readLateGateIntent('?late_qr=gate',storage,start+90*60*1000),'gate');
});
test('old one-time codes are not persisted and cannot revive a prior pending gate',()=>{
 const storage=session(),old='a'.repeat(40);
 assert.equal(readLateGateIntent('?late_qr='+old,storage,100),old);
 assert.equal(storage.entries().length,0);
 rememberLateGateIntent('gate',storage,100);
 assert.equal(readLateGateIntent('?late_qr=invalid',storage,110),null);
 assert.equal(readLateGateIntent('',storage,120),null);
});
test('successful check-in and cancellation clear pending intent',()=>{
 const storage=session();
 rememberLateGateIntent('gate',storage);
 assert.equal(readLateGateIntent('',storage),'gate');
 clearLateGateIntent(storage);
 assert.equal(readLateGateIntent('',storage),null);
});
test('portal login renders check-in and retains QR intent across authentication',()=>{
 const portal=source('web/portal-ui.js'),app=source('web/app.js');
 assert.match(app,/readLateGateIntent\(location\.search\)/);
 assert.match(app,/if\(scanned!=='gate'\)history\.replaceState/);
 assert.match(portal,/lateQrToken=readLateGateIntent\(location\.search\)/);
 assert.match(portal,/if\(lateQrToken\)role='student'/);
 assert.match(portal,/สแกน QR ลงชื่อมาสายแล้ว/);
 assert.match(portal,/id="studentLateQrForm"/);
 assert.match(portal,/endLateQrIntent\(\)/);
 assert.match(portal,/id="cancelStudentLateQr"/);
});
