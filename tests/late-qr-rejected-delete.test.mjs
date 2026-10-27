import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lateGateStaffRoutes} from '../worker/src/late-qr.js';

const request=(id='static-5')=>new Request('https://rd-care.local/api/late/qr/'+id+'/delete-rejected',{method:'POST',body:'{}'});
const fakeDb=(item)=>{
 let batchCalls=0;
 return {
  get batchCalls(){return batchCalls},
  prepare(){return {bind(){return {first:async()=>item}}}},
  async batch(stmts){batchCalls++;assert.equal(stmts.length,2);return [{meta:{changes:1}},{meta:{changes:1}}]}
 };
};
test('staff can remove a rejected static QR request without touching attendance',async()=>{
 const db=fakeDb({request_id:18,state:'rejected',school_date:'2026-10-27',auto_id:null,advisor_user_id:4,issued_by:null});
 const response=await lateGateStaffRoutes(request(),{DB:db},{role:'staff',id:9},'/api/late/qr/static-5/delete-rejected');
 assert.equal((await response.json()).deleted,true);
 assert.equal(db.batchCalls,1);
});
test('a teacher who is not the advisor cannot delete someone else’s rejected static QR request',async()=>{
 const db=fakeDb({request_id:18,state:'rejected',school_date:'2026-10-27',auto_id:null,advisor_user_id:4,issued_by:null});
 await assert.rejects(()=>lateGateStaffRoutes(request(),{DB:db},{role:'teacher',id:5},'/api/late/qr/static-5/delete-rejected'),{code:403});
 assert.equal(db.batchCalls,0);
});
test('the delete route cannot erase auto-approved or verified QR requests',async()=>{
 for(const item of [
  {request_id:18,state:'verified',auto_id:null,advisor_user_id:4,issued_by:null},
  {request_id:18,state:'rejected',auto_id:99,advisor_user_id:4,issued_by:null}
 ]){
  const db=fakeDb(item);
  await assert.rejects(()=>lateGateStaffRoutes(request(),{DB:db},{role:'admin',id:2},'/api/late/qr/static-5/delete-rejected'),{code:409});
  assert.equal(db.batchCalls,0);
 }
});
test('the QR screen offers a delete control only for authorized rejected entries',()=>{
 const ui=readFileSync(new URL('../web/late-gate.js',import.meta.url),'utf8');
 assert.match(ui,/item\.state==='rejected'&&item\.can_delete_rejected/);
 assert.match(ui,/data-qr-delete-rejected/);
 assert.match(ui,/\/delete-rejected/);
});
