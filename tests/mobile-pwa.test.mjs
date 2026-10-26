import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mobileMarkup} from '../web/mobile-nav.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('mobile dock has five user-visible actions and a reachable full navigation sheet',()=>{
 const html=mobileMarkup({navs:[['dashboard','หน้าหลัก','🏠'],['attendance','เช็กชื่อรายวัน','📅'],
  ['periodAttendance','เช็กชื่อรายคาบ','✅'],['alerts','ตรวจสอบขาด','🔎']],
  user:{role:'teacher',display_name:'ครูตัวอย่าง'},active:id=>id==='dashboard',pending:8});
 const nav=html.split('</nav>')[0];
 assert.equal((nav.match(/<button/g)||[]).length,5);
 assert.match(nav,/rd-mobile-primary/);
 assert.match(nav,/aria-label="รายการรอตรวจสอบ 8 รายการ"/);
 assert.match(html,/rdMobileSheet/);
 assert.match(html,/เช็กชื่อรายวัน/);
 assert.match(html,/เช็กชื่อรายคาบ/);
 assert.match(html,/rdMenuInstall/);
});
test('rendered user label is escaped before insertion into mobile menu',()=>{
 const html=mobileMarkup({navs:[],user:{role:'teacher',display_name:'<img src=x onerror=1>'},
  active:()=>false,pending:0});
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/&lt;img src=x/);
});
test('PWA manifest supports home-screen install and SW notification clicks use a safe route',()=>{
 const manifest=JSON.parse(read('web/manifest.webmanifest'));
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.icons.some(icon=>icon.sizes==='512x512'),true);
 const shell=read('web/index.html'),worker=read('web/sw.js'),app=read('web/app.js');
 assert.match(shell,/apple-mobile-web-app-capable/);
 assert.match(shell,/mobile-app\.css/);
 assert.match(worker,/addEventListener\('push'/);
 assert.match(worker,/addEventListener\('notificationclick'/);
 assert.match(worker,/\?tab=notifications/);
 assert.match(worker,/staff-tasks/);
 assert.match(app,/notificationSettings\.load/);
 assert.match(app,/bindMobileMenu/);
 assert.match(app,/pwaTools\.disable/);
});
