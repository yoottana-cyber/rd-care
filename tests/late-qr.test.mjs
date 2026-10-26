
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lateGateOpen,schoolTime,schoolDay,submitStudentLateQr,lateGateStaffRoutes} from '../worker/src/late-qr.js';
const at=t=>new Date(t);
test('QR gate is closed before and at 08:00 Bangkok, open from 08:01',()=>{
 assert.equal(schoolDay(at('2026-10-26T01:01:00Z')),'2026-10-26');
 assert.equal(schoolTime(at('2026-10-26T00:59:00Z')),'07:59');
 assert.equal(lateGateOpen(at('2026-10-26T00:59:00Z')),false);
 assert.equal(lateGateOpen(at('2026-10-26T01:00:00Z')),false);
 assert.equal(lateGateOpen(at('2026-10-26T01:01:00Z')),true);
});
test('scan submission requires a real authenticated student account',async()=>{
 const req=new Request('https://rd-care.local/api/portal/late/qr',{method:'POST',body:JSON.stringify({token:'a'.repeat(40)})});
 await assert.rejects(()=>submitStudentLateQr(req,{},{
  role:'guardian',id:4,active:1,student_id:null,must_change_password:0
 }),{code:403});
});
test('student must change temporary password before QR checkin',async()=>{
 const req=new Request('https://rd-care.local/api/portal/late/qr',{method:'POST',body:'{}'});
 await assert.rejects(()=>submitStudentLateQr(req,{},{
  role:'student',id:2,student_id:5,active:1,must_change_password:1
 }),{code:403});
});
test('unprivileged accounts cannot open school duty QR screen',async()=>{
 const req=new Request('https://rd-care.local/api/late/qr/queue',{method:'GET'});
 await assert.rejects(()=>lateGateStaffRoutes(req,{}, {role:'student',id:3},'/api/late/qr/queue'),{code:403});
});
test('QR token must be 160-bit lowercase hex with no user-chosen student ID',()=>{
 const backend=readFileSync(new URL('../worker/src/late-qr.js',import.meta.url),'utf8');
 assert.match(backend,/secureCode\(b\.token\)/);
 assert.match(backend,/account\.student_id/);
 assert.match(backend,/expired|expires_at/);
 assert.match(backend,/crypto\.subtle\.digest\('SHA-256'/);
 assert.doesNotMatch(backend,/b\.student_id/);
});
test('permanent QR is printable and the duty teacher list refreshes',()=>{
 const ui=readFileSync(new URL('../web/late-gate.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/late-gate.css',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../web/portal-ui.js',import.meta.url),'utf8');
 assert.match(ui,/\/api\/late\/qr\/print/);
 assert.match(ui,/window\.print\(\)/);
 assert.match(ui,/\/api\/late\/qr\/queue/);
 assert.match(ui,/setInterval/);
 assert.match(ui,/\/api\/late\/qr\/.*review/);
 assert.doesNotMatch(ui,/\/api\/late\/qr\/rotate/);
 assert.match(css,/@media print/);
 assert.match(portal,/value==='gate'/);
});
test('permanent QR route uses fixed public URL, and keeps manual approval',()=>{
 const backend=readFileSync(new URL('../worker/src/late-qr.js',import.meta.url),'utf8');
 assert.match(backend,/late_qr=gate/);
 assert.match(backend,/b\.token==='gate'/);
 assert.match(backend,/late_static_qr_submissions/);
 assert.match(backend,/openGate\(\)/);
 assert.match(backend,/state='pending'/);
 assert.match(backend,/source=isPermanent/);
});
