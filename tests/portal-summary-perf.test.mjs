import test from 'node:test';
import assert from 'node:assert/strict';
import {portalAdminRoutes} from '../worker/src/portal.js';

test('administrator summary keeps original response and avoids per-pupil correlated scans',async()=>{
 const sql=[];
 const results=[
  [{n:1750}],[{n:1740}],[{n:1760}],[{n:23}]
 ];
 const env={DB:{batch:async statements=>{
  assert.equal(statements.length,4,'one atomic read for each summary counter');
  return statements.map((_,i)=>({results:results[i]}));
 },prepare(query){sql.push(query);return {query}}}};
 const url='https://school.example/api/admin/portal/summary';
 const response=await portalAdminRoutes(new Request(url),env,{id:1,role:'admin'},'/api/admin/portal/summary');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{
  student_accounts:1750,guardian_accounts:1740,links:1760,students_without_guardian:23
 });
 assert.equal(sql.length,4);
 const anti=sql.at(-1);
 assert.match(anti,/s\.id NOT IN \(/);
 assert.match(anti,/FROM guardian_student_links l/);
 assert.match(anti,/JOIN portal_accounts a/);
 assert.match(anti,/a\.role='guardian'/);
 assert.match(anti,/a\.active=1/);
 assert.match(anti,/s\.active=1/);
 assert.doesNotMatch(anti,/NOT EXISTS/);
});
test('non-admin users cannot read sensitive guardian-link counts',async()=>{
 for(const role of ['staff','teacher','student','guardian']){
  await assert.rejects(
   portalAdminRoutes(
    new Request('https://school.example/api/admin/portal/summary'),
    {DB:{prepare(){throw Error('Unauthorized SQL query')},batch(){throw Error('Unauthorized SQL batch')}}},
    {id:2,role},'/api/admin/portal/summary'),{code:403});
 }
});
