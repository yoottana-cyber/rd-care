import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {requestHandler}=require('../node-hosting/src/http-handler.cjs');
const {mysqlConfig,openPool}=require('../node-hosting/src/database.cjs');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function response(method,path){
 let code=null,headers={},output='';
 const req={method,url:path};
 const res={writeHead(status,head){code=status;headers=head},end(str=''){output=str}};
 requestHandler(req,res);
 return {code,headers,body:JSON.parse(output)};
}
test('DirectAdmin Passenger entrypoint is CommonJS, no Cloudflare Dev link',()=>{
 const pkg=JSON.parse(read('node-hosting/package.json'));
 assert.equal(pkg.type,'commonjs');
 assert.equal(pkg.main,'app.js');
 assert.match(pkg.dependencies.mysql2,/^\^3\./);
 const start=read('node-hosting/app.js');
 assert.match(start,/createServer\(requestHandler\)/);
 assert.match(start,/process\.env\.PORT/);
 assert.doesNotMatch(start,/rd-care-api-dev|rd-care-dev|wrangler/);
 assert.match(read('node-hosting/src/http-handler.cjs'),/module\.exports/);
});
test('unported endpoints fail closed; health is explicitly not ready',()=>{
 const ready=response('GET','/api/health');
 assert.equal(ready.code,503);
 assert.equal(ready.body.ok,false);
 assert.equal(ready.body.error,'migration_not_ready');
 assert.equal(ready.headers['Cache-Control'],'no-store');
 for(const p of ['/api/auth/login','/api/attendance','/api/affairs/behavior/record','/api/portal/children']){
  const r=response('POST',p);
  assert.equal(r.code,501);
  assert.equal(r.body.error,'endpoint_not_migrated');
  assert.equal(r.body.ok,false);
 }
 assert.deepEqual(response('GET','/web/rd-connect-node-test/api/health').body,ready.body);
 assert.equal(response('GET','/web/rd-connect-node-test/api/health?check=1').code,503);
 assert.equal(response('POST','/web/rd-connect-node-test/api/auth/login').code,501);
 assert.equal(response('POST','/web/rd-connect-node-test/api/health').code,405);
 assert.equal(response('GET','/a/web/rd-connect-node-test/api/health').code,404);
 assert.equal(response('GET','/web/rd-connect-node-testing/api/health').code,404);
 assert.equal(response('GET','/web/rd-connect-node-test/').code,404);
 assert.equal(response('GET','/admin').code,404);
 assert.equal(response('POST','/api/health').code,405);
});
test('MariaDB pool configuration uses limited connections, UTF8, prepared query driver and isolated env',()=>{
 const env={
  RD_DB_HOST:'localhost',RD_DB_PORT:'3306',
  RD_DB_NAME:'ratsada_rd_connect_test',RD_DB_USER:'dbuser',RD_DB_PASSWORD:'private'
 };
 const config=mysqlConfig(env);
 assert.equal(config.host,'localhost');
 assert.equal(config.database,'ratsada_rd_connect_test');
 assert.equal(config.connectionLimit,4);
 assert.equal(config.multipleStatements,false);
 assert.equal(config.charset,'utf8mb4');
 assert.equal(config.timezone,'Z');
 let received=null;
 const fake={createPool(options){received=options;return {type:'pool'}}};
 assert.deepEqual(openPool(env,fake),{type:'pool'});
 assert.equal(received.password,'private');
 assert.throws(()=>mysqlConfig({...env,RD_DB_NAME:'rd-care-dev;DROP TABLE users'}),/Invalid/);
 assert.throws(()=>mysqlConfig({...env,RD_DB_PASSWORD:''}),/Missing/);
 assert.throws(()=>mysqlConfig({...env,RD_DB_PORT:'0'}),/Invalid/);
});
test('migration-only SQL cannot create real student data or modify Dev',()=>{
 const sql=read('node-hosting/mysql/0000_migration_ledger.sql');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS rd_schema_migrations/);
 assert.match(sql,/ENGINE=InnoDB/);
 assert.match(sql,/utf8mb4/);
 assert.doesNotMatch(sql,/CREATE TABLE (students|users|attendance_daily)/i);
 const checklist=read('docs/NODE-MARIADB-MIGRATION-PLAN.md');
 assert.match(checklist,/46/);
 assert.match(checklist,/Cloudflare Dev/);
 assert.match(checklist,/24\.20\.0/);
 assert.match(checklist,/Passenger/);
 assert.match(checklist,/10\.4\.34/);
 assert.match(checklist,/Push/);
});
