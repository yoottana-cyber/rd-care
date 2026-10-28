import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import {
 PBKDF2_ITERATIONS,LEGACY_PBKDF2_ITERATIONS,
 passwordHash,newPasswordSalt,passwordIterations
} from '../worker/src/password.js';

// Compatibility: existing DB accounts contain unprefixed salts and hashes.
test('new school trial password hashes are five times less CPU-intensive',()=>{
 assert.equal(PBKDF2_ITERATIONS,20_000);
 assert.equal(LEGACY_PBKDF2_ITERATIONS,100_000);
 assert.equal(LEGACY_PBKDF2_ITERATIONS/PBKDF2_ITERATIONS,5);
});
test('existing password salts keep the legacy 100k hash and authenticate unchanged',async()=>{
 const salt='c7a3adf2921f26b682f844c930473712';
 const pass='a-very-strong-demo-password-2026';
 assert.equal(passwordIterations(salt),100_000);
 const expected=pbkdf2Sync(pass,salt,100_000,32,'sha256').toString('hex');
 assert.equal(await passwordHash(pass,salt),expected);
 assert.notEqual(await passwordHash('wrong-password',salt),expected);
});
test('new salt stores algorithm generation and 20k rounds securely and verifiably',async()=>{
 const salt1=newPasswordSalt(),salt2=newPasswordSalt();
 assert.match(salt1,/^rd2\$[0-9a-f]{32}$/);
 assert.notEqual(salt1,salt2);
 assert.equal(passwordIterations(salt1),20_000);
 const pass='example-user-password';
 const expected=pbkdf2Sync(pass,salt1,20_000,32,'sha256').toString('hex');
 assert.equal(await passwordHash(pass,salt1),expected);
 assert.notEqual(await passwordHash('not-the-password',salt1),expected);
 assert.notEqual(await passwordHash(pass,salt2),expected);
});
test('password hash remains 64 hexadecimal chars and salt alone cannot unlock account',async()=>{
 const salt=newPasswordSalt(),hash=await passwordHash('new-student-password',salt);
 assert.match(hash,/^[0-9a-f]{64}$/);
 assert.equal(hash.includes('new-student-password'),false);
});
