'use strict';
// Invoke with a real school hosting Cron scheduler every five minutes.
// Reuses the ORIGINAL Worker scheduled jobs (Web Push, reminders, cleanup).
// Never run in a second persistent loop inside Passenger. No data printed.
const {createHandler}=require('./server.cjs');
async function run(env=process.env,log=console.log){
 const instance=await createHandler(env);
 try{
  const jobs=[];
  const ctx={waitUntil(p){jobs.push(Promise.resolve(p))}};
  await instance.worker.scheduled({cron:'*/5 * * * *',scheduledTime:Date.now()},
   {...env,DB:instance.db,ALLOWED_ORIGINS:instance.config.origin},ctx);
  const results=await Promise.allSettled(jobs);
  if(results.some(r=>r.status==='rejected'))throw Error('school_cron_job_failed');
  log('SCHOOL CRON COMPLETED: '+jobs.length+' scheduled task group(s).');
 }finally{instance.db.close()}
}
if(require.main===module)run().catch(e=>{
 const msg=String(e?.message||'');
 console.error('SCHOOL CRON ERROR ('+
  (/^school_[a-z0-9_]+$/.test(msg)?msg:'scheduled_task_failed')+').');
 process.exitCode=1;
});
module.exports={run};
