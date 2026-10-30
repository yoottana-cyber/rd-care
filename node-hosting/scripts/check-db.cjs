'use strict';
// Explicit, read-only MariaDB connectivity diagnostic for an isolated staging database.
// It is never called by the HTTP listener, and never logs configuration or SQL errors.
const {openPool}=require('../src/database.cjs');
function category(error){
  if (/^Missing RD_DB_|^Invalid RD_DB_|^Invalid MariaDB/.test(String(error?.message||'')))
    return 'invalid_configuration';
  switch (error?.code){
    case 'ER_ACCESS_DENIED_ERROR': return 'authentication_rejected';
    case 'ER_BAD_DB_ERROR': return 'database_not_found';
    case 'ECONNREFUSED': case 'ENOTFOUND': case 'EAI_AGAIN': case 'ETIMEDOUT':
    case 'PROTOCOL_CONNECTION_LOST': return 'database_unreachable';
    default: return 'connection_or_query_failed';
  }
}
async function checkDatabase({env=process.env, makePool=openPool, log=console.log, warn=console.error}={}){
  let pool;
  try{
    pool=makePool(env);
    const [rows]=await pool.query('SELECT 1 AS ok');
    if(Number(rows?.[0]?.ok)!==1)throw new Error('Unexpected connectivity check result');
    log('RD CONNECT MariaDB staging: connection OK (read-only SELECT 1).');
    return 0;
  }catch(error){
    warn('RD CONNECT MariaDB staging: FAILED ('+category(error)+').');
    return 1;
  }finally{
    if(pool){try{await pool.end()}catch{}}
  }
}
if(require.main===module){
 checkDatabase().then(code=>{process.exitCode=code;},()=>{console.error('RD CONNECT MariaDB staging: FAILED (unknown).');process.exitCode=1;});
}
module.exports={checkDatabase,category};
