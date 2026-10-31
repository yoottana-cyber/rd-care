// The reduced PBKDF2 cost is for RD Care's temporary Workers Free trial only.
// Existing unprefixed salts remain at 100,000 rounds so previous credentials
// continue to work. Never silently reinterpret the legacy password hashes.
// Review and upgrade password hashing before storing real school records.
export const LEGACY_PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_ITERATIONS = 20_000; // legacy rd2$ hashes only
export const SCHOOL_PBKDF2_ITERATIONS = 100_000; // fresh rd3$ school accounts
const SALT_V2_PREFIX='rd2
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
export function newPasswordSalt(){
 return SALT_V3_PREFIX+hex(crypto.getRandomValues(new Uint8Array(16)));
}
export function passwordIterations(salt){
 if(typeof salt==='string'&&salt.startsWith(SALT_V3_PREFIX))
  return SCHOOL_PBKDF2_ITERATIONS;
 return typeof salt==='string'&&salt.startsWith(SALT_V2_PREFIX)
  ? PBKDF2_ITERATIONS:LEGACY_PBKDF2_ITERATIONS;
}
export async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey(
  'raw',encoder.encode(password),'PBKDF2',false,['deriveBits']
 );
 const bits=await crypto.subtle.deriveBits({
  name:'PBKDF2',salt:encoder.encode(salt),
  iterations:passwordIterations(salt),hash:'SHA-256'
 },key,256);
 return hex(bits);
}
;
const SALT_V3_PREFIX='rd3
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
export function newPasswordSalt(){
 return SALT_V2_PREFIX+hex(crypto.getRandomValues(new Uint8Array(16)));
}
export function passwordIterations(salt){
 return typeof salt==='string'&&salt.startsWith(SALT_V2_PREFIX)
  ? PBKDF2_ITERATIONS:LEGACY_PBKDF2_ITERATIONS;
}
export async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey(
  'raw',encoder.encode(password),'PBKDF2',false,['deriveBits']
 );
 const bits=await crypto.subtle.deriveBits({
  name:'PBKDF2',salt:encoder.encode(salt),
  iterations:passwordIterations(salt),hash:'SHA-256'
 },key,256);
 return hex(bits);
}
;
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
export function newPasswordSalt(){
 return SALT_V2_PREFIX+hex(crypto.getRandomValues(new Uint8Array(16)));
}
export function passwordIterations(salt){
 return typeof salt==='string'&&salt.startsWith(SALT_V2_PREFIX)
  ? PBKDF2_ITERATIONS:LEGACY_PBKDF2_ITERATIONS;
}
export async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey(
  'raw',encoder.encode(password),'PBKDF2',false,['deriveBits']
 );
 const bits=await crypto.subtle.deriveBits({
  name:'PBKDF2',salt:encoder.encode(salt),
  iterations:passwordIterations(salt),hash:'SHA-256'
 },key,256);
 return hex(bits);
}
