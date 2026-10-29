import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unifiedRosterReadiness} from '../worker/src/unified-roster.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('roster readiness verifies schema without returning student or account records',async()=>{
 const queries=[];
 const env={DB:{prepare(sql){queries.push(sql);return {
  all:async()=>({results:[]}),
  first:async()=>({table_sql:null,has_live_roll_index:0})
 }}}};
 const response=await unifiedRosterReadiness(env,{id:5,role:'admin'});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.ok,true);
 assert.deepEqual(result.issues,[]);
 assert.equal(result.commit_limit,1);
 assert.equal(result.preview_limit,25);
 assert.equal(queries.length,6);
 assert(queries.slice(0,5).every(sql=>/LIMIT 0$/.test(sql)));
 assert.match(queries[5],/sqlite_master/);
 assert.match(queries[5],/name='students'/);
 assert.equal(result.archived_roll_reuse_ready,false);
 assert.equal('students' in result,false);
});
test('roster readiness rejects teachers and gives admins only schema category names',async()=>{
 const DB={prepare(sql){return {
  all:async()=>{
   if(sql.includes('student_enrollments'))throw Error('confidential database error');
   return {results:[]};
  },
  first:async()=>({table_sql:null,has_live_roll_index:0})
 }}};
 await assert.rejects(()=>unifiedRosterReadiness({DB},{id:12,role:'teacher'}),{code:403});
 const response=await unifiedRosterReadiness({DB},{id:5,role:'admin'});
 const result=await response.json();
 assert.equal(response.status,503);
 assert.deepEqual(result.issues,['enrollments']);
 assert.equal(result.error,'import_database_not_ready');
 assert.doesNotMatch(JSON.stringify(result),/confidential/);
});
test('import form uses external CSS classes, not CSP-blocked inline style attributes',()=>{
 const ui=read('web/unified-import.js');
 const css=read('web/app.css');
 assert.doesNotMatch(ui,/style\s*=/i);
 assert.match(ui,/class="row rd-import-controls"/);
 assert.match(ui,/class="table-wrap rd-import-table-scroll"/);
 assert.match(css,/\.rd-import-controls\s*\{/);
 assert.match(css,/\.rd-import-table-scroll\s*\{/);
 assert.match(read('web/index.html'),/style-src 'self'/);
});
test('502 gateway response is distinguishable and does not echo PII',()=>{
 const gateway=read('functions/api/[[path]].js');
 assert.match(gateway,/service_binding_fetch_failed/);
 assert.match(gateway,/x-rd-request-id/);
 assert.match(gateway,/crypto.randomUUID\(\)/);
 assert.doesNotMatch(gateway,/console.error\([^)]*request\.body/);
});
test('client calls admin health before commit and pauses on first 502',()=>{
 const browser=read('web/unified-import.js');
 assert.match(browser,/\/api\/admin\/unified-import\/health/);
 assert.match(browser,/unifiedCheckApi/);
 assert.match(browser,/500,502,503,504/);
 assert.match(browser,/pausedDueToServer=true/);
 assert.match(browser,/status='uncertain'/);
 assert.match(read('web/app.js'),/failure.httpStatus=response.status/);
 assert.match(read('worker/src/worker.js'),/path==='\/api\/admin\/unified-import\/health'/);
});
