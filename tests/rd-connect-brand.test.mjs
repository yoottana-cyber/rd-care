import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const bytes=path=>readFileSync(new URL('../'+path,import.meta.url));
const manifest=JSON.parse(read('web/manifest.webmanifest'));
test('RD CONNECT name stays consistent across staff, guardian, student and browser entrypoints',()=>{
 const html=read('web/index.html'),app=read('web/app.js'),portal=read('web/portal-ui.js');
 assert.ok(html.includes('<title>RD CONNECT — ระบบสารสนเทศเพื่อการติดตาม ดูแล และส่งเสริมนักเรียน โรงเรียนรัษฎา</title>'));
 assert.match(html,/apple-mobile-web-app-title" content="RD CONNECT"/);
 assert.match(html,/application-name" content="RD CONNECT"/);
 assert.match(html,/rd-connect\.svg/);
 for(const content of [app,portal]){
  assert.match(content,/RD CONNECT/);
  assert.ok(content.includes('ระบบสารสนเทศเพื่อการติดตาม ดูแล และส่งเสริมนักเรียน โรงเรียนรัษฎา'));
  assert.match(content,/โรงเรียนรัษฎา/);
  assert.match(content,/เชื่อมทุกความห่วงใย ดูแลทุกก้าวของนักเรียน/);
  assert.doesNotMatch(content,/RD Care|RD CARE/);
 }
 assert.match(app,/data-choice="staff"/);
 assert.match(app,/data-choice="student"/);
 assert.match(app,/data-choice="guardian"/);
 assert.match(app,/rd_token/);
 assert.match(portal,/rd_portal_token/);
 assert.match(read('web/late-gate.js'),/https:\/\/rd-care\.pages\.dev/);
});
test('installed PWA identity and shortcuts use RD CONNECT without changing app scope',()=>{
 assert.equal(manifest.short_name,'RD CONNECT');
 assert.equal(manifest.name,'RD CONNECT — ระบบสารสนเทศเพื่อการติดตาม ดูแล และส่งเสริมนักเรียน โรงเรียนรัษฎา');
 assert.ok(manifest.description.includes('RD CONNECT — ระบบสารสนเทศเพื่อการติดตาม ดูแล และส่งเสริมนักเรียน โรงเรียนรัษฎา'));
 for(const role of ['staff','student','guardian']){
  const scoped=JSON.parse(read('web/manifest-'+role+'.webmanifest'));
  assert.ok(scoped.description.includes('RD CONNECT — ระบบสารสนเทศเพื่อการติดตาม ดูแล และส่งเสริมนักเรียน โรงเรียนรัษฎา'));
  assert.match(scoped.short_name,/RD CONNECT/);
 }
 assert.ok(read('web/pwa-role.js').includes('ระบบสารสนเทศเพื่อการติดตาม ดูแล และส่งเสริมนักเรียน โรงเรียนรัษฎา'));
 assert.equal(manifest.id,'./');
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.scope,'./');
 assert.equal(manifest.theme_color,'#098a55');
 assert.equal(manifest.display,'standalone');
 assert.deepEqual(manifest.shortcuts.map(s=>s.url),[
  './?login=staff','./?login=student','./?login=guardian']);
 assert.deepEqual(manifest.icons.map(x=>x.sizes),['192x192','512x512']);
 assert.match(read('web/sw.js'),/rd-connect\.svg/);
 assert.match(read('web/index.html'),/apple-touch-icon.*icon-192\.png/);
});
test('branded PNG icons have valid PNG chunks and zlib pixels',()=>{
 for(const n of [192,512]){
  const b=bytes('web/icons/icon-'+n+'.png');
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let offset=8,idat=[];
  while(offset<b.length){
   const len=b.readUInt32BE(offset),type=b.toString('ascii',offset+4,offset+8);
   const data=b.subarray(offset+8,offset+8+len);
   if(type==='IHDR'){
    assert.equal(data.readUInt32BE(0),n);
    assert.equal(data.readUInt32BE(4),n);
    assert.equal(data[9],3); // Indexed color palette
   }
   if(type==='IDAT')idat.push(data);
   offset+=len+12;
   if(type==='IEND')break;
  }
  assert.equal(offset,b.length);
  assert.equal(inflateSync(Buffer.concat(idat)).length,n*(n+1));
 }
 const svg=read('web/icons/rd-connect.svg');
 assert.match(svg,/<svg/);
 assert.match(svg,/fill="url\(#g\)"/);
});
test('Push shows the RD CONNECT brand while keeping event-specific destinations and stable tags',()=>{
 const sw=read('web/sw.js'),worker=read('worker/src/worker.js');
 for(const topic of ['แจ้งเรื่องมาสาย','แจ้งเรื่องหนีเรียน','แจ้งขาดรายคาบรอตรวจสอบ','ทดสอบการแจ้งเตือน'])
  assert.ok(sw.includes(topic),topic);
 assert.match(sw,/RD CONNECT • แจ้งเรื่องมาสาย/);
 assert.match(sw,/RD CONNECT • แจ้งเรื่องหนีเรียน/);
 assert.match(sw,/notice_kind/);
 assert.match(sw,/portal_notice/);
 assert.match(sw,/rd-care-priority-review/); // Existing tags are internal stable keys
 assert.match(sw,/rd-care-late-arrival/);
 assert.match(worker,/service:'RD Care API',brand:'RD CONNECT',display_name:'RD CONNECT API'/);
 assert.doesNotMatch(sw,/RD Care|RD CARE/);
});
