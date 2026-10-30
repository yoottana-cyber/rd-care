'use strict';
// Step 6.3: verify D1 20k/100k PBKDF2 hashes in Node.js using
// independently precomputed test vectors. NO MariaDB/Cloudflare requests,
// no real credentials and no filesystem writes.
const {d1PasswordHash,verifyD1Password,roundsForSalt}=require('../src/d1-password-compat.cjs');
const TESTS=[
 ['rd2$0123456789abcdef0123456789abcdef','RDCONNECT_Compatibility_Test_2026!','6801645adebbf9ebfaba249b521d4580aa0ade2d356b0c0d0dcdfe38cabc4dce',20000],
 ['0123456789abcdef0123456789abcdef','RDCONNECT_Compatibility_Test_2026!','27d056e2cb829a584179374b4f232b6d7b8a9cf64257492a849f3e92170f9da6',100000],
 ['rd2$0123456789abcdef0123456789abcdef','รัษฎาทดสอบ@2569','5e896126c5865c4a7167bff6a873151afad32bf7ca42660953cdc7f29617ffff',20000],
 ['0123456789abcdef0123456789abcdef','รัษฎาทดสอบ@2569','048383fb58d2f92cc1cb27350e9705d8d91efa616a606ed4b7ff1eb8c0185d41',100000]
];
async function run({log=console.log,warn=console.error,hash=d1PasswordHash,verify=verifyD1Password}={}){
 try{
  for(const [salt,password,expected,rounds] of TESTS){
   if(roundsForSalt(salt)!==rounds)throw new Error('iterations_mismatch');
   if(await hash(password,salt)!==expected)throw new Error('pbkdf2_vector_mismatch');
   if(!await verify(password,salt,expected))throw new Error('correct_password_rejected');
   if(await verify('WRONG-compatibility-password',salt,expected))throw new Error('incorrect_password_accepted');
  }
  log('STEP 6.3 OK: D1 password hash compatibility verified (20k/100k PBKDF2-SHA256, UTF-8 and Thai text).');
  log('NO DATABASE ACCESS: tested with synthetic passwords and fixed published-independent vectors only.');
  log('AUTH API STILL DISABLED: this does not enable user login or migrate school records.');
  return 0;
 }catch{
  warn('STEP 6.3 FAILED (password_compatibility_check).');
  return 1;
 }
}
if(require.main===module)run().then(code=>{process.exitCode=code},()=>{console.error('STEP 6.3 FAILED (unknown).');process.exitCode=1});
module.exports={run,TESTS};
