import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, webcrypto } from 'node:crypto';
import { PBKDF2_ITERATIONS, passwordHash } from '../worker/src/password.js';

// Node.js implements the same Web Crypto PBKDF2 API as workerd for a
// deterministic algorithm-level test. Actual Workers runtime cap must
// additionally be verified during deployment.
test('demo PBKDF2 stays within workerd 100k invocation limit', () => {
  assert.equal(PBKDF2_ITERATIONS, 100_000);
});

test('PBKDF2 produces the same hash as PowerShell/.NET SHA-256 method', async () => {
  const salt = 'c7a3adf2921f26b682f844c930473712';
  const pass = 'a-very-strong-demo-password-2026';
  const expected = pbkdf2Sync(pass, salt, 100_000, 32, 'sha256').toString('hex');
  assert.equal(await passwordHash(pass, salt), expected);
  assert.notEqual(await passwordHash('wrong-password', salt), expected);
});
