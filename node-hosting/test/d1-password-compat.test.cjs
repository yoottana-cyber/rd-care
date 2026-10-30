'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {d1PasswordHash,verifyD1Password,roundsForSalt,LEGACY_ITERATIONS,PREFIXED_ITERATIONS}=require('../src/d1-password-compat.cjs');
const {run,TESTS}=require('../scripts/check-password-compat.cjs');

test('synthetic vectors match D1 PBKDF2 20k/100k and UTF-8 text',async()=>{
 for(const [salt,password,expected,rounds] of TESTS){
  assert.equal(roundsForSalt(salt),rounds);
  assert.equal(await d1PasswordHash(password,salt),expected);
  assert.equal(await verifyD1Password(password,salt,expected),true);
  assert.equal(await verifyD1Password('wrong-secret-that-must-fail',salt,expected),false);
 }
 assert.equal(PREFIXED_ITERATIONS,20000);
 assert.equal(LEGACY_ITERATIONS,100000);
});
test('invalid hash, salt and excess password length fail closed',async()=>{
 assert.equal(await verifyD1Password('hello','not-salt','not-hex'),false);
 assert.equal(await verifyD1Password('hello','','a'.repeat(64)),false);
 assert.equal(await verifyD1Password('x'.repeat(513),'salt','a'.repeat(64)),false);
 await assert.rejects(()=>d1PasswordHash('hello',''),/invalid_password_salt/);
});
test('DirectAdmin verifier prints no actual secret, returns 0',async()=>{
 const output=[],warnings=[];
 assert.equal(await run({log:x=>output.push(x),warn:x=>warnings.push(x)}),0);
 assert.deepEqual(warnings,[]);
 assert.match(output.join(' '),/AUTH API STILL DISABLED/);
 for(const [,password,hash] of TESTS){
  assert.ok(!output.join(' ').includes(password));
  assert.ok(!output.join(' ').includes(hash));
 }
});
