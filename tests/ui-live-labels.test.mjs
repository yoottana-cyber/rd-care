import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const visibleFiles=[
 'web/app.js','web/admin-settings.js','web/portal-ui.js','web/portal-admin.js',
 'web/unified-import.js','web/advisor-import.js','web/template-xlsx.js',
 'web/templates/advisor-all-rooms-import.csv','web/templates/student-all-rooms-import.csv',
 'web/templates/student-login-import-template.csv'
];

test('public screens and downloadable templates have no simulation/trial labels',()=>{
 const stale=/(ข้อมูลจำลอง|นักเรียนจำลอง|บัญชีทดลอง|ระบบทดลอง|รุ่นทดลอง|รุ่นทดสอบ|ข้อมูลทดลอง|ฐานทดลอง|นักเรียนทดสอบ|ข้อมูลจริง.*ไฟล์ทดสอบ)/;
 for(const path of visibleFiles){
  const code=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.doesNotMatch(code,stale,path);
  assert.doesNotMatch(code,/\bDEMO\d+\b|teacher_demo\d+|\bdemo-stu\d+\b/i,path);
 }
});
test('guardian Push requires an explicit opt-in',()=>{
 const portal=readFileSync(new URL('../web/portal-ui.js',import.meta.url),'utf8');
 const guardian=readFileSync(new URL('../web/guardian-push.js',import.meta.url),'utf8');
 assert.match(portal,/id="guardianPushEnable"/);
 assert.match(portal,/โรงเรียนยืนยันความสัมพันธ์แล้ว/);
 assert.match(guardian,/Notification.requestPermission\(\)/);
 assert.match(guardian,/\/api\/portal\/push\/subscribe/);
});
test('import screens continue to warn about data permissions and PDPA',()=>{
 const importer=readFileSync(new URL('../web/unified-import.js',import.meta.url),'utf8');
 const settings=readFileSync(new URL('../web/admin-settings.js',import.meta.url),'utf8');
 assert.match(importer,/ข้อกำหนด PDPA/);
 assert.match(settings,/การคุ้มครองข้อมูลส่วนบุคคล/);
});
