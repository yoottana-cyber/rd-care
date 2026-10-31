'use strict';
// DirectAdmin / CloudLinux Passenger application startup.
const {start}=require('./school-hosting/server.cjs');
start().catch(e=>{
 const message=String(e?.message||'');
 const safe=/^school_[a-z0-9_]+$/.test(message)?message:'school_startup_failed';
 console.error('RD CONNECT SCHOOL STARTUP BLOCKED ('+safe+').');
 process.exitCode=1;
});
