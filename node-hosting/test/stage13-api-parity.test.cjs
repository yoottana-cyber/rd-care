'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CONTRACTS,REQUIRED_PATH_DIFF,privateRouteFor,report,publicIsClosed}
 =require('../src/api-contract-gap-audit.cjs');
const {run}=require('../scripts/check-stage13-api-parity.cjs');
test('representative Worker API contracts are unique, safe and audit private adapter by method',()=>{
 const result=report();
 assert.equal(result.total,CONTRACTS.length);
 assert.ok(result.total>=35);
 assert.ok(result.private_route_present>5);
 assert.ok(result.private_route_missing>10);
 assert.equal(result.release_ready,false);
 assert.equal(result.private_route_present+result.private_route_missing,result.total);
 assert.ok(result.rows.every(r=>r.coverage.includes('PRIVATE_ROUTE')));
});
test('Node portal attendance and behavior helpers are NOT substitutes for Worker /records',()=>{
 assert.equal(REQUIRED_PATH_DIFF.cloudflare,'/api/portal/records');
 assert.equal(privateRouteFor('GET','/api/portal/records'),false);
 assert.equal(privateRouteFor('GET','/api/portal/attendance'),true);
 assert.equal(privateRouteFor('GET','/api/portal/behavior'),true);
 const matrix=report();
 assert.ok(matrix.rows.some(r=>r.path==='/api/portal/records'&&
  r.coverage==='NO_MATCHING_PRIVATE_ROUTE'));
});
test('read-only Node routes never imply that attendance/timetable writes were ported',()=>{
 assert.equal(privateRouteFor('GET','/api/attendance'),true);
 assert.equal(privateRouteFor('POST','/api/attendance'),false);
 assert.equal(privateRouteFor('GET','/api/my-timetable'),true);
 assert.equal(privateRouteFor('POST','/api/my-timetable'),false);
 assert.equal(privateRouteFor('POST','/api/portal/late/qr'),false);
 assert.equal(privateRouteFor('POST','/api/auth/login'),true);
});
test('public Passenger remains deliberately closed despite private handlers',()=>{
 assert.equal(publicIsClosed(),true);
});
test('offline stage 13 audit always returns NO_GO and logs no credentials',()=>{
 const logs=[],warnings=[];
 const code=run({log:x=>logs.push(x),warn:x=>warnings.push(x)});
 assert.equal(code,2);
 assert.ok(logs.some(x=>x.includes('PORTAL PATH MISMATCH')));
 assert.ok(logs.some(x=>x.includes('PUBLIC PASSENGER API CLOSED')));
 assert.ok(warnings.some(x=>x.includes('NO_GO')));
 assert.ok(!logs.concat(warnings).join('\n').includes('password'));
});
test('duplicate contracts and unknown paths fail closed',()=>{
 const [one]=CONTRACTS;
 assert.throws(()=>report([one,one]),/stage13_invalid_route_contract/);
 assert.throws(()=>report([{method:'DELETE',path:'/api/bad',group:'test'}]),
  /stage13_invalid_route_contract/);
 assert.throws(()=>report([{method:'GET',path:'/evil',group:'test'}]),
  /stage13_invalid_route_contract/);
});
