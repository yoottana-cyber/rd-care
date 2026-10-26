import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNotificationSettings} from '../web/notification-settings.js';

test('mobile notification settings receives authenticated api dependency and loads pending work',async()=>{
 const previousDocument=globalThis.document;
 const calls=[],rendered=[];
 globalThis.document={querySelector:()=>null};
 try{
  const fakeApi=async path=>{calls.push(path);return {alerts:6};};
  const settings=createNotificationSettings({
   api:fakeApi,
   pwaTools:{check:async()=>({
    installed:true,canPush:true,enabled:false,permission:'default',subscribed:false
   })},
   mount:html=>rendered.push(html),
   toast:()=>{},
   safeRun:fn=>fn(),
   showTab:()=>{},
   getAlerts:()=>0
  });
  await settings.load();
  assert.equal(calls.length,1);
  assert.match(calls[0],/^\/api\/dashboard\?date=\d{4}-\d{2}-\d{2}$/);
  assert.match(rendered[0],/6 รายการ/);
  assert.match(rendered[0],/เซิร์ฟเวอร์ยังไม่ได้ตั้งค่ากุญแจ VAPID/);
 } finally{
  if(previousDocument===undefined)delete globalThis.document;
  else globalThis.document=previousDocument;
 }
});
test('app wires its authenticated api into notification-settings factory',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 assert.match(app,/createNotificationSettings\(\{api,pwaTools,mount,toast,safeRun,showTab/);
});
