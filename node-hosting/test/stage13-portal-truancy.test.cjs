'use strict';
// All tests here are offline, synthetic and do NOT connect to D1/MariaDB.
const test=require('node:test');
const assert=require('node:assert/strict');
const {portalTruancy}=require('../src/school-read-service.cjs');
const {ROUTES}=require('../src/staging-school-http.cjs');
const {privateRouteFor,report}=require('../src/api-contract-gap-audit.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const guardian={kind:'portal',role:'guardian',id:71};
const pupil={kind:'portal',role:'student',id:88};
function fakeDb(entries=[]){
 const statements=[];
 const conn={async execute(sql,values){
  statements.push({sql,values});
  return [entries];
 }};
 return {conn,statements};
}
test('active linked guardian feed uses bounded parameterized SQL and exact Worker fields',async()=>{
 const item={id:9,student_id:41,school_date:'2026-10-30',
  period:3,subject:'Synthetic lesson',full_name:'Fictional Student',
  created_at:'2026-10-30 10:00:00'};
 const {conn,statements}=fakeDb([item]);
 const res=await portalTruancy(conn,guardian,'2026-10-29','2026-10-30');
 assert.deepEqual(res,{items:[item]});
 assert.equal(statements.length,1);
 assert.deepEqual(statements[0].values,[71,'2026-10-29','2026-10-30']);
 const sql=statements[0].sql;
 for(const token of ['guardian_student_links','guardian_account_id=?',
  "a.role='guardian'","a.active=1","s.active=1","p.status='absent'",
  "e.active=1","period_truancy","school_date BETWEEN ? AND ?","LIMIT 40"])
  assert.ok(sql.includes(token),token);
 assert.ok(!sql.includes('Fictional Student'));
 assert.equal((sql.match(/\?/g)||[]).length,3);
});
test('default feed mirrors UTC last-30-day range without unbounded history',async()=>{
 const {conn,statements}=fakeDb();
 assert.deepEqual(await portalTruancy(conn,guardian),{items:[]});
 assert.deepEqual(statements[0].values,[71]);
 assert.match(statements[0].sql,/DATE_SUB\(UTC_DATE\(\),INTERVAL 30 DAY\)/);
 assert.match(statements[0].sql,/LIMIT 40/);
});
test('student feed empty; staff and invalid guardian range denied without SQL',async()=>{
 const s=fakeDb();
 assert.deepEqual(await portalTruancy(s.conn,pupil),{items:[]});
 assert.equal(s.statements.length,0);
 const staff=fakeDb();
 await assert.rejects(()=>portalTruancy(staff.conn,{kind:'staff',role:'admin',id:2}),{status:403});
 assert.equal(staff.statements.length,0);
 const invalid=fakeDb();
 await assert.rejects(()=>portalTruancy(invalid.conn,guardian,'2026-10-01',null),{status:400});
 await assert.rejects(()=>portalTruancy(invalid.conn,guardian,'2026-01-01','2026-10-30'),{status:400});
 await assert.rejects(()=>portalTruancy(invalid.conn,pupil,'2026-02-30','2026-03-01'),{status:400});
 assert.equal(invalid.statements.length,0);
});
test('portal truancy is only a private GET and Passenger remains 501',()=>{
 assert.equal(ROUTES['/api/portal/truancy'].kind,'portal');
 assert.equal(privateRouteFor('GET','/api/portal/truancy'),true);
 assert.equal(privateRouteFor('POST','/api/portal/truancy'),false);
 const audit=report();
 assert.equal(audit.total,41);
 assert.equal(audit.private_route_present,13);
 assert.equal(audit.private_route_missing,28);
 const res={status:null,writeHead(status){this.status=status},
  end(data){this.body=JSON.parse(data)}};
 requestHandler({url:'/api/portal/truancy',method:'GET'},res);
 assert.equal(res.status,501);
 assert.equal(res.body.error,'endpoint_not_migrated');
});
