'use strict';
// RD CONNECT Node migration / OFFLINE truancy Push eligibility planner.
// Does not open sockets, send Push, query personal records or modify databases.
// It accepts ONLY independently authenticated, DB-verified, post-COMMIT input.
// No public HTTP/API imports this module. The caller is responsible for
// authorization, verifying subscriptions and updating a transactional outbox.
const TYPES=Object.freeze(['advisor','guardian','student']);
const KEY_FOR=Object.freeze({advisor:'truancy_advisor',
 guardian:'truancy_guardian',student:'truancy_student'});
const MAX_ATTEMPTS=3;
const STALE_MS=2*60*1000;
const DAY_MS=86400000;
const fail=code=>{throw Error('push_plan_'+code)};
const positive=n=>Number.isSafeInteger(n)&&n>0;
function strictDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return NaN;
 const parsed=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==value)return NaN;
 return parsed;
}
function validateEvent(event,now){
 if(!event||!positive(event.id)||!positive(event.generation)||
   !positive(event.student_id)||!Number.isFinite(now)||
   !Number.isFinite(event.updated_at_ms)||!Number.isFinite(strictDate(event.school_date)))
   fail('invalid_event');
 if(event.committed!==true)fail('event_must_be_committed');
 return true;
}
function eventEligible(event,now){
 validateEvent(event,now);
 if(event.active!==true||event.period_truancy_active!==true||
    event.period_status!=='absent')return {ok:false,reason:'not_active_truancy'};
 // Worker selects edited events within 24 hours and dates no older than 14
 // Thai school days. The caller supplies a TRUSTED Bangkok date, not client time.
 const today=strictDate(event.bangkok_today);
 const on=strictDate(event.school_date);
 if(!Number.isFinite(today))fail('invalid_bangkok_today');
 if(on>today||on<today-14*DAY_MS)return {ok:false,reason:'outside_attendance_window'};
 if(event.updated_at_ms>now||event.updated_at_ms<now-24*60*60*1000)
  return {ok:false,reason:'outside_event_freshness'};
 return {ok:true,reason:'active_committed_truancy'};
}
function typeAndAudience(event,device){
 if(!TYPES.includes(device?.type)||!positive(device?.subscription_id))
  fail('invalid_recipient');
 if(device.active!==true)return false;
 if(device.type==='advisor'){
  const assigned=[event.advisor_user_id,event.advisor2_user_id];
  return positive(device.user_id)&&assigned.some(x=>x===device.user_id);
 }
 if(device.type==='guardian'){
  return positive(device.guardian_account_id)&&
   device.account_active===true&&device.must_change_password===false&&
   Array.isArray(device.verified_student_ids)&&
   device.verified_student_ids.includes(event.student_id);
 }
 return positive(device.student_account_id)&&
  device.account_active===true&&device.must_change_password===false&&
  device.student_id===event.student_id;
}
function compositeKey(event,device){
 return [event.id,event.generation,device.type,device.subscription_id].join(':');
}
function retryState(entry,now){
 if(!entry)return {eligible:true,reason:'new'};
 if(!Number.isSafeInteger(entry.attempts)||entry.attempts<0||
   entry.attempts>MAX_ATTEMPTS||!['pending','sending','delivered','failed'].includes(entry.state))
  fail('invalid_delivery_state');
 if(entry.state==='delivered')return {eligible:false,reason:'already_delivered'};
 if(entry.attempts>=MAX_ATTEMPTS)return {eligible:false,reason:'retry_exhausted'};
 if(entry.state==='pending')return {eligible:true,reason:'pending'};
 if(!Number.isFinite(entry.updated_at_ms)||entry.updated_at_ms>now)
  fail('invalid_delivery_timestamp');
 if(now-entry.updated_at_ms<STALE_MS)
  return {eligible:false,reason:'retry_cooldown'};
 return {eligible:true,reason:'retry_stale'};
}
function planTruancyPush({event,devices=[],deliveries=new Map(),preferences={},
 senderReady=false,now=Date.now()}={}){
 const status=eventEligible(event,now);
 if(!Array.isArray(devices)||!(deliveries instanceof Map)||
   !preferences||typeof preferences!=='object'||Array.isArray(preferences))
  fail('invalid_input');
 // Default-on policy matches existing D1 behavior, unless administrator
 // explicitly disables a category. Missing VAPID -> no accepted sends.
 if(!status.ok)return {ready:false,reason:status.reason,
  eligible:[],suppressed:devices.length,checked:0,not_sent:true};
 if(senderReady!==true)return {ready:false,reason:'missing_vapid',
  eligible:[],suppressed:devices.length,checked:0,not_sent:true};
 const eligible=[],seen=new Set();
 let suppressed=0,checked=0;
 for(const d of devices){
  if(!typeAndAudience(event,d)){suppressed++;continue}
  checked++;
  const pref=preferences[KEY_FOR[d.type]];
  if(pref!==undefined&&typeof pref!=='boolean')fail('invalid_preference');
  if(pref===false){suppressed++;continue}
  const key=compositeKey(event,d);
  if(seen.has(key)){suppressed++;continue}
  seen.add(key);
  const state=retryState(deliveries.get(key),now);
  if(!state.eligible){suppressed++;continue}
  // Do NOT return endpoints, VAPID material, P256DH/auth, student names,
  // phone numbers, school class or incident details.
  eligible.push({type:d.type,subscription_id:d.subscription_id,
   event_id:event.id,generation:event.generation,decision:state.reason});
 }
 return {ready:eligible.length>0,reason:eligible.length?'eligible_recipients':'no_eligible_subscribers',
  eligible,suppressed,checked,not_sent:true};
}
module.exports={KEY_FOR,TYPES,MAX_ATTEMPTS,STALE_MS,strictDate,
 validateEvent,eventEligible,typeAndAudience,compositeKey,retryState,planTruancyPush};
