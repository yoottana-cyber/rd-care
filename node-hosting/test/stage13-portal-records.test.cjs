'use strict';
// ALL-SYNTHETIC role/response-shape/unit contract tests. No DB / D1 access.
const test=require('node:test');
const assert=require('node:assert/strict');
const {portalRecords,portalScoreSummary}=require('../src/school-read-service.cjs');
const {ROUTES}=require('../src/staging-school-http.cjs');
const {report,privateRouteFor}=require('../src/api-contract-gap-audit.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
function mockDb({linked=true,student=true}={}){
 const seen=[];
 const conn={async execute(sql,params){
  seen.push({sql,params});
  if(sql.includes('guardian_student_links g'))
   return [linked?[{allowed:1}]:[]];
  if(sql.includes('SELECT id FROM students WHERE id='))
   return [student?[{id:41}]:[]];
  if(sql.includes('SELECT s.id,s.full_name,s.student_no,c.label'))
   return [student?[{id:41,full_name:'Synthetic Student',student_no:'TEST-41',
    classroom_label:'LAB-1'}]:[]];
  if(sql.includes('FROM attendance_daily'))return [[{school_date:'2026-10-30',status:'late'}]];
  if(sql.includes('FROM attendance_period p'))return [[
   {school_date:'2026-10-30',status:'truancy',period:3,subject:'Synthetic Math'},
   {school_date:'2026-10-30',status:'present',period:4,subject:'Synthetic English'}
  ]];
  if(sql.includes('FROM late_records'))return [[{
   school_date:'2026-10-30',arrived_at:'08:10:00',state:'approved'}]];
  if(sql.includes('FROM behavior_incidents i'))return [[
   {record_date:'2026-10-30',points:-10,reason:'Synthetic negative',affairs_category:'moderate',score_type:'behavior',warning_no:0},
   {record_date:'2026-10-30',points:0,reason:'Synthetic warning',affairs_category:'minor',score_type:'behavior',warning_no:1},
   {record_date:'2026-10-30',points:12,reason:'Synthetic merit',affairs_category:'good',score_type:'good',warning_no:0},
   {record_date:'2026-10-30',points:3,reason:'Synthetic adjustment',affairs_category:'adjustment',score_type:'adjustment',warning_no:0}
  ]];
  if(sql.includes('AS good_total'))return [[{
   good_total:'12',behavior_deducted:'10',behavior_adjusted:'3'}]];
  throw Error('unexpected SQL in synthetic mock');
 }};
 return {conn,seen};
}
const guardian={kind:'portal',role:'guardian',id:77};
const qs=['41','2026-10-29','2026-10-30'];
test('Worker /records exact response shape keeps merit and behavior separate',async()=>{
 const {conn,seen}=mockDb();
 const r=await portalRecords(conn,guardian,...qs);
 assert.deepEqual(Object.keys(r).sort(),[
  'student','from','to','daily','period','late','truancy','behavior',
  'good','behavior_total','good_total','behavior_deducted',
  'behavior_adjusted','behavior_remaining','note'].sort());
 assert.equal(r.student.id,41);
 assert.equal(r.daily[0].status,'late');
 assert.equal(r.truancy.length,1);
 assert.equal(r.truancy[0].subject,'Synthetic Math');
 assert.equal(r.behavior.length,3);
 assert.ok(r.behavior.some(x=>x.warning_no===1&&x.points===0));
 assert.equal(r.good.length,1);
 assert.equal(r.behavior_total,-7);
 assert.equal(r.good_total,12);
 assert.equal(r.behavior_adjusted,3);
 assert.equal(r.behavior_remaining,7);
 assert.equal(seen.length,8);
 assert.ok(seen.every(x=>x.sql.includes('?')));
 assert.ok(seen.every(x=>!x.sql.includes('TEST-41')&&!x.sql.includes('Synthetic merit')));
 assert.ok(seen[0].sql.includes('guardian_student_links'));
 assert.ok(seen.slice(2).every(x=>x.params[0]===41));
});
test('unrelated guardian is forbidden before ANY student history or score read',async()=>{
 const {conn,seen}=mockDb({linked:false});
 await assert.rejects(()=>portalRecords(conn,guardian,...qs),{status:403});
 assert.equal(seen.length,1);
 assert.match(seen[0].sql,/guardian_student_links/);
});
test('inactive or missing student is never readable',async()=>{
 const {conn,seen}=mockDb({student:false});
 await assert.rejects(()=>portalRecords(conn,guardian,...qs),{status:404});
 assert.equal(seen.length,2);
});
test('staff sessions cannot use guardian API; invalid ranges fail without SQL',async()=>{
 const a=mockDb();
 await assert.rejects(()=>portalRecords(a.conn,{kind:'staff',role:'admin',id:7},...qs),{status:403});
 assert.equal(a.seen.length,0);
 const b=mockDb();
 await assert.rejects(()=>portalRecords(b.conn,guardian,'41','2026-10-30','2027-02-01'),{status:400});
 assert.equal(b.seen.length,0);
 const c=mockDb();
 await assert.rejects(()=>portalRecords(c.conn,guardian,'41','2026-02-30','2026-03-01'),{status:400});
 assert.equal(c.seen.length,0);
});
test('student account must be self-bound and active',async()=>{
 const seen=[];
 const conn={async execute(sql,values){
  seen.push({sql,values});
  if(sql.includes('portal_accounts WHERE id='))return [[{student_id:22}]];
  throw Error('unexpected access');}};
 await assert.rejects(()=>portalRecords(conn,{kind:'portal',role:'student',id:9},'41','2026-10-30','2026-10-30'),{status:403});
 assert.equal(seen.length,1);
});
test('scoring deliberately does NOT cancel good deeds against conduct debt',()=>{
 assert.deepEqual(portalScoreSummary({good_total:'50',
  behavior_deducted:'23',behavior_adjusted:'5'}),{
  good_total:50,behavior_deducted:23,behavior_adjusted:5,behavior_remaining:18});
 assert.equal(portalScoreSummary(null).behavior_remaining,0);
});
test('private route is now an exact GET contract; Passenger stays 501',()=>{
 assert.ok(ROUTES['/api/portal/records']);
 assert.equal(ROUTES['/api/portal/records'].kind,'portal');
 assert.equal(privateRouteFor('GET','/api/portal/records'),true);
 assert.equal(privateRouteFor('POST','/api/portal/records'),false);
 const r=report();
 assert.equal(r.private_route_present,13);
 assert.equal(r.private_route_missing,28);
 const res={status:0,writeHead(n){this.status=n},end(body){this.body=JSON.parse(body)}};
 requestHandler({method:'GET',url:'/api/portal/records'},res);
 assert.equal(res.status,501);
 assert.equal(res.body.error,'endpoint_not_migrated');
});
