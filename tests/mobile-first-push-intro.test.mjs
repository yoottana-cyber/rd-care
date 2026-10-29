import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldOfferPushIntro} from '../web/push-intro.js';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function memory(){
 const records=new Map();
 return {getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,String(v))};
}
test('first mobile visit offers staff and guardian Push consent only once per account',()=>{
 const storage=memory(),options={id:71,storage,isMobile:()=>true};
 assert.equal(shouldOfferPushIntro({...options,role:'staff'}),true);
 storage.setItem('rd-push-intro-v1:staff:71:web','seen');
 assert.equal(shouldOfferPushIntro({...options,role:'staff'}),false);
 assert.equal(shouldOfferPushIntro({...options,role:'guardian'}),true);
 assert.equal(shouldOfferPushIntro({...options,role:'student'}),false);
 assert.equal(shouldOfferPushIntro({...options,role:'guardian',isMobile:()=>false}),false);
});
test('permission request happens only in the direct click activation, not on app boot',()=>{
 const prompt=source('web/push-intro.js');
 const staff=source('web/pwa-client.js');
 const guardian=source('web/guardian-push.js');
 assert.match(prompt,/addEventListener\('click',\(\)=>\{/);
 assert.match(prompt,/operation=enable\(\)/);
 assert.match(staff,/const permission=await Notification\.requestPermission\(\)/);
 assert.match(guardian,/const permitted=await Notification\.requestPermission\(\)/);
 assert.doesNotMatch(prompt,/await Notification\.requestPermission/);
 assert.match(prompt,/needsInstall=ios\(\)&&!standalone\(\)/);
});
test('student and guardian entrances remain visible even with persistent staff login',()=>{
 const staff=source('web/app.js'),mobile=source('web/mobile-nav.js');
 const portal=source('web/portal-ui.js');
 const sw=source('web/sw.js');
 assert.match(staff,/welcomeStaffPush\(\)/);
 assert.match(staff,/href="\.\/\?login=student"/);
 assert.match(staff,/href="\.\/\?login=guardian"/);
 assert.match(portal,/offerPushIntro\(\{role:'guardian'/);
 assert.match(portal,/guardianPush\.introStatus/);
 assert.match(portal,/guardianPush\.bind\(\)/);
 assert.match(portal,/data-portal-panel="account"/);
 assert.match(mobile,/href="\.\/\?login=student"/);
 assert.match(mobile,/href="\.\/\?login=guardian"/);
 assert.match(sw,/push-intro\.js/);
 assert.match(source('web/guardian-push.js'),/return \{bind,disable,enable,introStatus\}/);
});
