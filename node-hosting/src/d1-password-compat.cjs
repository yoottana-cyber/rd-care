'use strict';
// Exact compatibility with worker/src/password.js on the Cloudflare D1 branch.
// This is for migration verification; 20k/100k PBKDF2 iterations must be upgraded
// to a stronger password KDF when real accounts are migrated.
// Existing D1 salts are encoded as UTF-8 *text*, not decoded from hex.
const {pbkdf2:pbkdf2Callback,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const pbkdf2=promisify(pbkdf2Callback);
const LEGACY_ITERATIONS=100000;
const PREFIXED_ITERATIONS=20000;
const PREFIX='rd2$';

function roundsForSalt(salt){
 if(typeof salt!=='string'||!salt||salt.length>256)throw new TypeError('invalid_password_salt');
 return salt.startsWith(PREFIX)?PREFIXED_ITERATIONS:LEGACY_ITERATIONS;
}
async function d1PasswordHash(password,salt){
 if(typeof password!=='string'||password.length>512)throw new TypeError('invalid_password_input');
 const rounds=roundsForSalt(salt);
 return (await pbkdf2(Buffer.from(password,'utf8'),Buffer.from(salt,'utf8'),rounds,32,'sha256')).toString('hex');
}
async function verifyD1Password(password,salt,expectedHex){
 if(typeof expectedHex!=='string'||!/^[a-f0-9]{64}$/i.test(expectedHex))return false;
 if(typeof password!=='string'||password.length>512)return false;
 if(typeof salt!=='string'||!salt||salt.length>256)return false;
 const derived=await d1PasswordHash(password,salt);
 return timingSafeEqual(Buffer.from(derived,'hex'),Buffer.from(expectedHex,'hex'));
}
module.exports={roundsForSalt,d1PasswordHash,verifyD1Password,LEGACY_ITERATIONS,PREFIXED_ITERATIONS};
