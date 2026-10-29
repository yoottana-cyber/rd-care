import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isSchoolLateQr,lateCameraError,createStudentLateQrScanner} from '../web/student-late-qr-scanner.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const gate='https://rd-care.pages.dev/?late_qr=gate';

test('only the school permanent late gate QR can unlock student check-in',()=>{
 assert.equal(isSchoolLateQr(gate),true);
 assert.equal(isSchoolLateQr('https://rd-care.pages.dev/index.html?late_qr=gate'),true);
 assert.equal(isSchoolLateQr('https://school.example/?late_qr=gate','https://school.example'),true);
 for(const invalid of [
  'gate','', 'https://rd-care.pages.dev/?late_qr=no',
  'https://rd-care.pages.dev/staff?late_qr=gate',
  'https://rd-care.pages.dev.evil.example/?late_qr=gate',
  'javascript:alert(1)', 'https://evil.example/?late_qr=gate'
 ])assert.equal(isSchoolLateQr(invalid),false,invalid);
});

test('camera scanner reads QR locally and releases the camera after detection and navigation',async()=>{
 const instances=[],confirmed=[];
 class FakeScanner{
  constructor(video,onScan,options){this.video=video;this.onScan=onScan;this.options=options;this.destroyed=false;instances.push(this)}
  async start(){this.started=true}
  destroy(){this.destroyed=true}
 }
 const scanner=createStudentLateQrScanner({
  loadScanner:async()=>FakeScanner,origin:()=> 'https://rd-care.pages.dev',
  onDetected:()=>confirmed.push('gate'),onInvalid:()=>confirmed.push('invalid')
 });
 const video={};
 await scanner.start(video);
 assert.equal(instances[0].video,video);
 assert.equal(instances[0].options.preferredCamera,'environment');
 instances[0].onScan({data:'https://elsewhere.example/?late_qr=gate'});
 assert.deepEqual(confirmed,['invalid']);
 assert.equal(instances[0].destroyed,false);
 instances[0].onScan({data:gate});
 assert.deepEqual(confirmed,['invalid','gate']);
 assert.equal(instances[0].destroyed,true);
 await scanner.start(video);
 scanner.stop();
 assert.equal(instances[1].destroyed,true);
 instances[1].onScan({data:gate});
 assert.equal(confirmed.length,2,'an old camera callback must not check the student in');
});

test('QR image import is validated with the same school QR rules',async()=>{
 const captured=[];
 class FakeScanner{
  static async scanImage(file){return {data:file.code}}
 }
 const scanner=createStudentLateQrScanner({
  loadScanner:async()=>FakeScanner,origin:()=> 'https://rd-care.pages.dev',
  onDetected:()=>captured.push('gate')
 });
 await assert.rejects(scanner.scanFile({code:'https://wrong.example/?late_qr=gate'}),/ไม่ใช่ QR/);
 assert.deepEqual(captured,[]);
 await scanner.scanFile({code:gate});
 assert.deepEqual(captured,['gate']);
});

test('student late page offers camera and file scanning without changing guardian controls',()=>{
 const portal=source('web/portal-ui.js');
 const css=source('web/portal-mobile.css'),sw=source('web/sw.js');
 for(const selector of ['studentLateScanStart','studentLateCameraPanel','studentLateCameraVideo',
  'studentLateScanStop','studentLateQrUpload','studentLateQrForm'])
  assert.match(portal,new RegExp('id="'+selector+'"'));
 assert.match(portal,/lateScanner\.start\(video\)/);
 assert.match(portal,/lateScanner\.stop\(\)/);
 assert.match(portal,/lateScanner\.scanFile\(file\)/);
 assert.match(portal,/if\(state\.view!=='late'\)lateScanner\.stop\(\)/);
 assert.match(portal,/if\(lateQrToken\)state\.view='late'/);
 assert.match(portal,/token:lateQrToken/);
 assert.match(css,/\.rd-portal-camera\[hidden\]/);
 for(const asset of ['student-late-qr-scanner.js','qr-scanner.min.js','qr-scanner-worker.min.js'])
  assert.ok(sw.includes(asset),asset);
 assert.equal(lateCameraError({name:'NotAllowedError'}).includes('อนุญาต'),true);
});
