// RD CONNECT school-local hosting: retain existing salts for account migration,
// use 100,000 PBKDF2-SHA256 iterations for NEW local school accounts.
// Prefixes are versioned; previously-issued hashes must not be reinterpreted.
export const LEGACY_PBKDF2_ITERATIONS=100_000;
export const PBKDF2_ITERATIONS=20_000; // existing rd2$ salts
export const SCHOOL_PBKDF2_ITERATIONS=100_000; // new rd3$ salts
const SALT_V2_PREFIX='rd2$';
const SALT_V3_PREFIX='rd3$';
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
export function newPasswordSalt(){
 return SALT_V3_PREFIX+hex(crypto.getRandomValues(new Uint8Array(16)));
}
export function passwordIterations(salt){
 if(typeof salt==='string'&&salt.startsWith(SALT_V3_PREFIX))
  return SCHOOL_PBKDF2_ITERATIONS;
 return typeof salt==='string'&&salt.startsWith(SALT_V2_PREFIX)
  ?PBKDF2_ITERATIONS:LEGACY_PBKDF2_ITERATIONS;
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
