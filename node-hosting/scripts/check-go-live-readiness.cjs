'use strict';
// RD CONNECT release package — ONE-COMMAND, read-only, fail-closed audit.
// Always NO_GO at this migration stage. Does not enable HTTP APIs, alter DB,
// touch D1, import actual accounts or modify any filesystem/cloud settings.
// No credentials or school data are printed.
const {openPool}=require('../src/database.cjs');
const {requestHandler}=require('../src/http-handler.cjs');
const {category}=require('./check-db.cjs');
const {STAGING_DATABASE,assertStagingEnvironment,assessReadiness}
 =require('../src/release-readiness.cjs');

function need(ok,code){if(!ok)throw Error('release_'+code)}
function simulate(method,url){
 const req={method,url,headers:{}};
 const res={status:0,headers:{},body:null,
  writeHead(code,headers){this.status=code;this.headers=headers},
  end(value){this.body=JSON.parse(String(value))}
 };
 requestHandler(req,res);
 need(res.status!==0&&res.body!=null,'http_probe_incomplete');
 need(res.headers['Cache-Control']==='no-store','http_cache_policy');
 return res;
}
function testPublicGate(){
 return {
  health:simulate('GET','/web/rd-connect-node-test/api/health'),
  auth:simulate('POST','/web/rd-connect-node-test/api/auth/login'),
  timetable:simulate('POST','/web/rd-connect-node-test/api/timetable'),
  transport:simulate('GET','/web/rd-connect-node-test/api/migration/transport')
 };
}
async function inspectStaging(conn){
 const [[db]]=await conn.execute('SELECT DATABASE() AS db');
 need(db?.db===STAGING_DATABASE,'wrong_staging_database');
 const [[tables]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
 const [[fks]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY'");
 const [[triggers]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()");
 const [[views]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()");
 const [all]=await conn.execute(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
 const expected=Number(tables?.n);
 need(expected===63&&all.length===63,'staging_tables_changed');
 need(all.every(t=>String(t.ENGINE).toUpperCase()==='INNODB'),
  'staging_non_innodb');
 let empty=0;
 for(const row of all){
  const name=row.TABLE_NAME;
  need(typeof name==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name),
   'unexpected_table_identifier');
  // Identifier comes only from database metadata, never user input.
  const [exists]=await conn.execute('SELECT 1 AS present FROM `'+name+'` LIMIT 1');
  if(exists.length)throw Error('release_staging_not_empty');
  empty++;
 }
 return {db:db.db,tables:expected,fks:Number(fks?.n),
  triggers:Number(triggers?.n),views:Number(views?.n),
  verified_empty_tables:empty};
}
function safeError(e){
 const msg=String(e?.message||'');
 if(/^release_[a-z_]+$/.test(msg))return msg;
 return category(e);
}
async function run({env=process.env,makePool=openPool,log=console.log,warn=console.error}={}){
 let pool,conn;
 try{
  assertStagingEnvironment(env);
  const http=testPublicGate();
  pool=makePool(env);
  conn=await pool.getConnection();
  const snapshot=await inspectStaging(conn);
  const result=assessReadiness({env,snapshot,http});
  log('RELEASE READINESS NO_GO: current Node migration is NOT approved for production.');
  log('STAGING SCHEMA OK: '+JSON.stringify(result.staging_inventory));
  log('PUBLIC ENDPOINTS CLOSED: auth/timetable return 501; health returns 503; transport is not readiness.');
  log('FUNCTIONAL BLOCKERS: '+result.pending_capabilities.length+' capability groups lack end-to-end production evidence.');
  log('RELEASE SUMMARY: '+JSON.stringify({status:result.status,
   required_capabilities:result.required_capabilities,
   verified_production_capabilities:result.verified_production_capabilities,
   blockers:result.reasons,live_system_unchanged:true}));
  log('NO DB WRITES: all checks used metadata and SELECT 1 only; no records or secrets exported.');
  warn('GO LIVE BLOCKED: finish API migration, data reconciliation, Push, backup restoration and approved cutover plan first.');
  return 2; // intentional NO_GO exit code, not a failed database test
 }catch(e){
  warn('RELEASE PREFLIGHT FAILED ('+safeError(e)+').');
  warn('GO LIVE BLOCKED: no changes made by this read-only check.');
  return 1;
 }finally{
  if(conn){try{conn.release()}catch{}}
  if(pool){try{await pool.end()}catch{}}
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{
 console.error('RELEASE PREFLIGHT FAILED (unknown).');process.exitCode=1;
});
module.exports={simulate,testPublicGate,inspectStaging,safeError,run};
