'use strict';
// Isolated RD CONNECT MariaDB 10.4 LAB transaction coordinator.
// No driver import, pool, credentials, environment reading or live app routing.
// Caller supplies ONE mysql2/promise-style connection; do NOT use on production.
// Fail closed against the school migration target and any non-lab database.
const LAB_SCHEMA='ratsadaa_connect_lab';
const LAB_CONFIRM='RD_CONNECT_SYNTHETIC_LAB_ONLY';
const isObj=o=>o!==null&&typeof o==='object';
const rowsOf=result=>{
 if(!Array.isArray(result)||!Array.isArray(result[0]))
  throw Error('lab_mysql2_query_result_required');
 return result[0];
};
const first=result=>rowsOf(result)[0]||null;
function verifySession(row){
 if(!isObj(row)||row.active_schema!==LAB_SCHEMA)
  throw Error('lab_schema_must_be_isolated');
 if(Number(row.fk_enabled)!==1||Number(row.unique_enabled)!==1)
  throw Error('lab_database_integrity_checks_must_be_on');
}
async function checkedSession(connection){
 const row=first(await connection.execute(
  'SELECT DATABASE() AS active_schema, @@session.foreign_key_checks AS fk_enabled, @@session.unique_checks AS unique_enabled'
 ));
 verifySession(row);
}
async function runLabTransaction(connection,work,{confirm}={}){
 if(confirm!==LAB_CONFIRM)throw Error('explicit_lab_confirmation_required');
 if(!connection||typeof connection.execute!=='function'||
   typeof connection.beginTransaction!=='function'||
   typeof connection.commit!=='function'||
   typeof connection.rollback!=='function'||typeof work!=='function')
  throw Error('lab_connection_or_work_invalid');
 // Do not start a write transaction without verifying the selected database.
 await checkedSession(connection);
 let begun=false;
 try{
  await connection.beginTransaction();
  begun=true;
  // A separate session check inside the same transaction prevents schema drift.
  await checkedSession(connection);
  const value=await work(connection,{first,rowsOf});
  await checkedSession(connection);
  await connection.commit();
  begun=false;
  return Object.freeze({committed:true,value});
 }catch(error){
  if(begun){
   try{await connection.rollback();}
   catch(rollbackError){
    const e=Error('lab_rollback_failed_manual_inspection_required');
    e.cause=error;
    throw e;
   }
  }
  // After a failed COMMIT the caller must inspect state, not blindly retry.
  throw error;
 }
}
module.exports={LAB_SCHEMA,LAB_CONFIRM,first,rowsOf,checkedSession,
 runLabTransaction};
