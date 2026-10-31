'use strict';
// Safe offline audit only. Exit code 2 is the expected NO_GO for unported APIs.
// No MariaDB pool, D1 query, HTTP socket, PUSH or school records.
const {report,publicIsClosed,REQUIRED_PATH_DIFF}=require('../src/api-contract-gap-audit.cjs');
function run({log=console.log,warn=console.error}={}){
 try{
  const out=report();
  publicIsClosed();
  log('STAGE 13 API ROUTE AUDIT OK: '+out.total+
   ' representative Worker route+method contracts inventoried.');
  log('PRIVATE ROUTE NAME+METHOD FOUND: '+out.private_route_present+
   ' (response shape, SQL and permissions NOT verified).');
  log('NO MATCHING PRIVATE ROUTE: '+out.private_route_missing+'.');
  if(!out.rows.some(x=>x.path===REQUIRED_PATH_DIFF.cloudflare&&
   x.coverage==='PRIVATE_ROUTE_PRESENT_SHAPE_UNVERIFIED'))
   throw Error('stage13_portal_records_route_missing');
  log('PORTAL RECORDS PRIVATE ROUTE FOUND: Worker '+REQUIRED_PATH_DIFF.cloudflare+
   ' now has a matching internal GET route; full behavior/schema parity remains unverified.');
  log('PUBLIC PASSENGER API CLOSED: login, guardian records and attendance are still 501; health is 503.');
  warn('STAGE 13 NO_GO: complete API parity, privacy, score/history semantics and Push remain pending.');
  return 2;
 }catch(e){
  const category=String(e?.message||'');
  warn('STAGE 13 API AUDIT FAILED ('+
   (/^stage13_[a-z_]+$/.test(category)?category:'unknown')+').');
  return 1;
 }
}
if(require.main===module)process.exitCode=run();
module.exports={run};
