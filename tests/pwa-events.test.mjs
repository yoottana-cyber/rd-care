import test from 'node:test';
import assert from 'node:assert/strict';
import { runSafely } from '../web/run-safely.js';

test('form submit handlers execute synchronously during dispatch', async () => {
  const form = new EventTarget();
  const failures = [];
  let currentTargetIsForm = false;
  form.addEventListener('submit', event => {
    runSafely(async () => {
      event.preventDefault();
      currentTargetIsForm = event.currentTarget === form;
      await Promise.resolve();
    }, e => failures.push(e));
  });
  const event = new Event('submit', { cancelable: true });
  assert.equal(form.dispatchEvent(event), false);
  assert.equal(event.defaultPrevented, true);
  assert.equal(currentTargetIsForm, true);
  assert.deepEqual(failures, []);
});

test('runSafely reports asynchronous failures', async () => {
  const errors = [];
  const failure = new Error('network failure');
  await runSafely(async () => { throw failure; }, e => errors.push(e));
  assert.deepEqual(errors, [failure]);
});

test('runSafely reports synchronous failures', async () => {
  const errors = [];
  const failure = new Error('invalid form');
  await runSafely(() => { throw failure; }, e => errors.push(e));
  assert.deepEqual(errors, [failure]);
});
