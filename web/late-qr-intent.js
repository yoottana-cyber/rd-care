// Keep only a PUBLIC permanent-gate intent across student login/reloads.
// This is not a session credential or student record. Expire a pending visit
// after 30 minutes; the actual printed QR URL itself never expires.
const KEY='rd_late_gate_intent_v1';
const WINDOW_MS=30*60*1000;
const validLegacy=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export function rememberLateGateIntent(token,storage=globalThis.sessionStorage,now=Date.now()){
 if(token!=='gate')return false; // never persist legacy rotating code
 try{storage?.setItem(KEY,JSON.stringify({token:'gate',until:now+WINDOW_MS}));return true}
 catch{return false}
}
export function clearLateGateIntent(storage=globalThis.sessionStorage){
 try{storage?.removeItem(KEY)}catch{}
}
export function readLateGateIntent(search='',storage=globalThis.sessionStorage,now=Date.now()){
 const qs=new URLSearchParams(search),provided=qs.get('late_qr');
 if(provided!==null){
  if(provided==='gate'){rememberLateGateIntent('gate',storage,now);return 'gate'}
  if(validLegacy(provided))return provided; // never store time-limited secrets
  clearLateGateIntent(storage);return null;
 }
 try{
  const value=JSON.parse(storage?.getItem(KEY)||'null');
  if(value?.token==='gate'&&Number.isFinite(value.until)&&value.until>now)return 'gate';
 }catch{}
 clearLateGateIntent(storage);return null;
}
