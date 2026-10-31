'use strict';
// Isolated transaction smoke-test only; these hashes are NOT the existing D1 password format.
const {randomBytes,scrypt:rawScrypt,timingSafeEqual,createHash}=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(rawScrypt);
const PARAMS=Object.freeze({N:16384,r:8,p:1,maxmem:32*1024*1024});
async function hashTemporaryPassword(password,saltHex){
 if(typeof password!=='string'||password.length<20)throw new Error('invalid_temporary_password');
 if(!/^[a-f0-9]{32}$/.test(saltHex))throw new Error('invalid_salt');
 return (await scrypt(password,Buffer.from(saltHex,'hex'),32,PARAMS)).toString('hex');
}
async function matchesTemporaryPassword(password,saltHex,storedHex){
 if(typeof storedHex!=='string'||!/^[a-f0-9]{64}$/.test(storedHex))return false;
 if(typeof password!=='string'||password.length<20)return false;
 if(typeof saltHex!=='string'||!/^[a-f0-9]{32}$/.test(saltHex))return false;
 const computed=await hashTemporaryPassword(password,saltHex);
 return timingSafeEqual(Buffer.from(computed,'hex'),Buffer.from(storedHex,'hex'));
}
function createTemporaryCredentials(){
 return {
  username:'rdst_'+randomBytes(12).toString('hex'),
  password:randomBytes(32).toString('hex'),
  salt:randomBytes(16).toString('hex'),
  tokenHash:createHash('sha256').update(randomBytes(32)).digest('hex')
 };
}
module.exports={hashTemporaryPassword,matchesTemporaryPassword,createTemporaryCredentials};
