'use strict';
// RD CONNECT stage 7.14 — bounded retries for cooperating timetable writers.
// NOT connected to public API. Pass only a writer that fully ROLLBACKs and
// releases named locks BEFORE rejecting (coordinatedInsert/Update/Delete).
// A new POOL CHECKOUT is used per attempt (physical session may be reused).
// Never retry unknown COMMIT state, stale record, or TIMETABLE_OVERLAP.
// Any connection with uncertain lock/transaction state is DESTROYED.
const {classifyTimetableDbError}=require('./timetable-write-coordination.cjs');
const sleepDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const UNSAFE=new Set([
 'lab_timetable_lock_release_failed','lab_named_lock_release_failed',
 'lab_timetable_rollback_failed','lab_named_lock_error',
 'lab_connection_release_failed','lab_connection_unsafe'
]);
function invalid(message){throw Error('lab_'+message)}
function validateOptions({maxAttempts=3,retryDelayMs=60,sleep=sleepDefault,onRetry}={}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)invalid('retry_attempts_invalid');
 if(!Number.isInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>200)
  invalid('retry_delay_invalid');
 if(typeof sleep!=='function')invalid('retry_sleep_invalid');
 if(onRetry!==undefined&&typeof onRetry!=='function')invalid('retry_hook_invalid');
 return {maxAttempts,retryDelayMs,sleep,onRetry};
}
function isUnsafe(error){
 const msg=String(error?.message||'');
 return UNSAFE.has(msg)||error?.fatal===true||
  ['PROTOCOL_CONNECTION_LOST','ECONNRESET','ER_SERVER_SHUTDOWN'].includes(error?.code);
}
function destroyConnection(conn){
 if(typeof conn?.destroy!=='function')invalid('connection_destroy_unavailable');
 conn.destroy();
}
function settleConnection(conn,unsafe){
 if(!conn)return;
 if(unsafe){destroyConnection(conn);return}
 try{
  if(typeof conn.release!=='function')invalid('connection_release_unavailable');
  conn.release();
 }catch(error){
  try{destroyConnection(conn)}catch{}
  throw Error('lab_connection_release_failed',{cause:error});
 }
}
function exhaustedError(lastError){
 const error=Error('lab_timetable_retry_exhausted',{cause:lastError});
 error.retryable=true;
 return error;
}
async function withTimetableRetry(pool,perform,options={}){
 if(!pool||typeof pool.getConnection!=='function')invalid('pool_required');
 if(typeof perform!=='function')invalid('writer_required');
 const {maxAttempts,retryDelayMs,sleep,onRetry}=validateOptions(options);
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  let conn=null,success=false,value,error=null;
  try{
   conn=await pool.getConnection();
   // perform MUST end its transaction and release all its own named locks.
   value=await perform(conn,attempt);
   success=true;
  }catch(e){error=e}
  const unsafe=!success&&isUnsafe(error);
  if(conn){
   // If cleanup/release state is uncertain, do not put the connection back.
   settleConnection(conn,unsafe);
  }
  if(success)return {value,attempts:attempt,retries:attempt-1};
  if(unsafe)throw Error('lab_connection_unsafe',{cause:error});
  const classification=classifyTimetableDbError(error);
  const temporary=classification==='busy_retry_new_transaction'||
   classification==='deadlock_retry_new_transaction';
  if(!temporary)throw error; // overlap, stale, missing, unexpected
  if(attempt>=maxAttempts)throw exhaustedError(error);
  // No transaction and no named locks may remain on returned connection.
  // onRetry is an optional TEST instrumentation hook, not a live API.
  if(onRetry)await onRetry({attempt,classification});
  if(retryDelayMs)await sleep(retryDelayMs*attempt);
 }
 invalid('retry_unreachable');
}
module.exports={validateOptions,isUnsafe,exhaustedError,withTimetableRetry};
