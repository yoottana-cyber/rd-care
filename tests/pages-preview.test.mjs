import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';

test('Pages preview announces missing service binding without disclosing secrets', async () => {
  const response = await onRequest({
    request: new Request('https://rd-care-preview.pages.dev/api/health'),
    env: {}
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'preview_api_not_configured');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('Pages preview forwards auth and body but never browser origin or cookies', async () => {
  let forwarded = false;
  const original = new Request('https://rd-care-preview.pages.dev/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer demo',
      'origin': 'https://rd-care-preview.pages.dev',
      'cookie': 'leak=secret'
    },
    body: JSON.stringify({ username: 'demo' })
  });
  const response = await onRequest({
    request: original,
    env: { RD_CARE_API: { async fetch(request) {
      forwarded = true;
      assert.equal(new URL(request.url).pathname, '/api/auth/login');
      assert.equal(request.headers.get('authorization'), 'Bearer demo');
      assert.equal(request.headers.get('content-type'), 'application/json');
      assert.equal(request.headers.get('origin'), null);
      assert.equal(request.headers.get('cookie'), null);
      assert.match(request.headers.get('x-rd-request-id'),/^[a-f0-9-]{36}$/);
      assert.deepEqual(await request.json(), { username: 'demo' });
      return Response.json({ ok: true });
    }}}
  });
  assert.equal(forwarded, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('Pages preview returns controlled error when service unavailable', async () => {
  const response = await onRequest({
    request: new Request('https://rd-care-preview.pages.dev/api/classrooms'),
    env: { RD_CARE_API: { async fetch() { throw new Error('internal secret'); } } }
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'service_binding_fetch_failed');
  assert.equal(typeof body.request_id,'string');
  assert.match(body.request_id,/^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('x-rd-request-id'),body.request_id);
  assert.doesNotMatch(JSON.stringify(body),/internal secret/);
});

test('Pages API route rejects paths outside /api/', async () => {
  const response = await onRequest({
    request: new Request('https://rd-care-preview.pages.dev/private'),
    env: {}
  });
  assert.equal(response.status, 404);
});
