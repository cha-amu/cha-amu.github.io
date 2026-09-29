import assert from 'node:assert/strict';
import test from 'node:test';

import { createGateway } from '../worker/src/index.js';

const PRIVATE_TEXT = 'private-post-content-canary';
const REDIRECT_TOKEN = 'private-redirect-token-canary';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const env = {
  ALLOWED_ORIGIN: 'https://cha-amu.github.io',
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/private-script-id-canary/exec',
  GATEWAY_SHARED_SECRET: 'gateway-shared-secret-canary-000000000000',
  STORAGE_SYNC_SECRET: 'storage-sync-secret-canary-00000000000000'
};

function upstreamResponse(body, options = {}) {
  const response = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'Content-Type': options.contentType ?? 'application/json' }
  });
  Object.defineProperties(response, {
    url: { value: options.url ?? `https://script.googleusercontent.com/macros/echo?token=${REDIRECT_TOKEN}` },
    redirected: { value: options.redirected ?? true }
  });
  return response;
}

async function invoke(fetch, action = 'storage.sync.post.list', payload = {}, authorized = true) {
  const request = new Request('https://cha-amu-gateway.test/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      'X-Sync-Request-Id': REQUEST_ID,
      ...(authorized ? { Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}` } : {})
    },
    body: JSON.stringify({ action, ...payload })
  });
  return createGateway({ fetch }).fetch(request, env);
}

function captureLogs(t) {
  const entries = [];
  t.mock.method(console, 'warn', (message) => entries.push(JSON.parse(message)));
  t.mock.method(console, 'info', (message) => entries.push(JSON.parse(message)));
  return entries;
}

function assertNoPrivateValues(entries) {
  const serialized = JSON.stringify(entries);
  for (const value of [PRIVATE_TEXT, REDIRECT_TOKEN, env.GATEWAY_SHARED_SECRET,
    env.STORAGE_SYNC_SECRET, 'private-script-id-canary', 'private-host-canary']) {
    assert.equal(serialized.includes(value), false, value);
  }
}

test('HTTP failures preserve the gateway error and record only safe response metadata', async (t) => {
  const entries = captureLogs(t);
  const response = await invoke(async () => upstreamResponse(PRIVATE_TEXT, {
    status: 503, contentType: `text/html; private=${PRIVATE_TEXT}`
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: '원본 API가 요청을 처리하지 못했습니다.' });
  assert.equal(entries.length, 1);
  const { duration_ms, ...entry } = entries[0];
  assert.ok(Number.isFinite(duration_ms) && duration_ms >= 0);
  assert.deepEqual(entry, {
    event: 'storage_sync_upstream', request_id: REQUEST_ID, action: 'storage.sync.post.list', reason: 'http_error',
    status: 503, redirected: true, response_host: 'script.googleusercontent.com',
    content_type: 'html', upstream_ok: null, data_type: 'undefined', health_response: false,
    apps_script_confirmed: false, apps_script_outcome: null, apps_script_error: null, apps_script_location: null
  });
  assertNoPrivateValues(entries);
});

test('network, JSON, and envelope errors are distinguished without logging their contents', async (t) => {
  const entries = captureLogs(t);
  const cases = [
    [async () => { throw new Error(`${PRIVATE_TEXT} ${env.GATEWAY_SHARED_SECRET}`); }, 'request_failed', null],
    [async () => upstreamResponse(PRIVATE_TEXT), 'invalid_json', 200],
    [async () => upstreamResponse({ error: PRIVATE_TEXT }), 'invalid_envelope', 200]
  ];
  for (const [fetch, reason, status] of cases) {
    const response = await invoke(fetch);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
    assert.equal(entries.at(-1).reason, reason);
    assert.equal(entries.at(-1).status, status);
  }
  assert.equal(entries.length, cases.length);
  assertNoPrivateValues(entries);
});

test('health responses are detected for reads and writes without changing the API result', async (t) => {
  const entries = captureLogs(t);
  const envelope = { ok: true, data: { name: 'cha-amu-api' } };
  const post = {
    id: 'post-1', title: 'Post', excerpt: '', body: PRIVATE_TEXT, tags: [], status: 'published',
    createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T01:00:00.000Z',
    publishedAt: '2026-07-12T00:00:00.000Z', storagePath: 'posts/2026/post-1.md',
    bodyUrl: 'https://example.test/post-1.md'
  };
  for (const [action, payload] of [
    ['storage.sync.post.list', {}],
    ['storage.sync.post.save', { post }]
  ]) {
    const response = await invoke(async () => upstreamResponse(envelope), action, payload);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), envelope);
    assert.equal(entries.at(-1).reason, 'unexpected_health_response');
    assert.equal(entries.at(-1).action, action);
    assert.equal(entries.at(-1).health_response, true);
    assert.equal(entries.at(-1).data_type, 'object');
  }
  assert.equal(entries.length, 2);
  assertNoPrivateValues(entries);
});

test('unexpected list shapes and application rejections are recorded without raw payloads', async (t) => {
  const entries = captureLogs(t);
  for (const data of [{ private: PRIVATE_TEXT }, null, PRIVATE_TEXT]) {
    const envelope = { ok: true, data };
    const response = await invoke(async () => upstreamResponse(envelope, {
      url: `https://private-host-canary.test/${REDIRECT_TOKEN}`,
      contentType: PRIVATE_TEXT
    }), 'storage.sync.assetOverride.list');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), envelope);
    assert.equal(entries.at(-1).reason, 'unexpected_list_shape');
    assert.equal(entries.at(-1).response_host, 'other');
    assert.equal(entries.at(-1).content_type, 'other');
  }
  const rejection = { ok: false, error: PRIVATE_TEXT };
  const response = await invoke(async () => upstreamResponse(rejection));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), rejection);
  assert.equal(entries.at(-1).reason, 'upstream_rejected');
  assert.equal(entries.at(-1).upstream_ok, false);
  assert.equal(entries.length, 4);
  assertNoPrivateValues(entries);
});

test('normal lists record metadata while public and unauthorized requests emit no storage diagnostic', async (t) => {
  const entries = captureLogs(t);
  for (const action of ['storage.sync.post.list', 'storage.sync.assetOverride.list', 'storage.sync.postDeletion.list']) {
    const envelope = { ok: true, data: [{ id: 'record-1' }] };
    const response = await invoke(async () => upstreamResponse(envelope), action);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), envelope);
    assert.equal(entries.at(-1).reason, 'ok');
  }
  assert.equal(entries.length, 3);
  entries.length = 0;
  const publicResponse = await invoke(async () => upstreamResponse(PRIVATE_TEXT, { status: 503 }), 'post.listPublic');
  assert.equal(publicResponse.status, 502);
  const unauthorizedResponse = await invoke(async () => {
    assert.fail('An unauthorized request must never reach Apps Script');
  }, 'storage.sync.post.list', {}, false);
  assert.equal(unauthorizedResponse.status, 403);
  assert.deepEqual(entries, []);
});

test('correlates Apps Script processing and removes internal diagnostics from the client response', async (t) => {
  const entries = captureLogs(t);
  const response = await invoke(async (url, init) => {
    assert.equal(url, env.APPS_SCRIPT_URL);
    const body = JSON.parse(init.body);
    assert.equal(body._syncRequestId, REQUEST_ID);
    assert.equal(body.gatewaySecret, env.GATEWAY_SHARED_SECRET);
    return upstreamResponse({ ok: true, data: [], _syncDiagnostic: {
      requestId: body._syncRequestId, method: 'POST', outcome: 'ok'
    } });
  });
  assert.deepEqual(await response.json(), { ok: true, data: [] });
  assert.equal(entries[0].request_id, REQUEST_ID);
  assert.equal(entries[0].apps_script_confirmed, true);
  assert.equal(entries[0].apps_script_outcome, 'ok');
  assertNoPrivateValues(entries);
});

test('a failure in the logging service cannot fail a valid request', async (t) => {
  t.mock.method(console, 'info', () => { throw new Error('log unavailable'); });
  t.mock.method(console, 'warn', () => { throw new Error('log unavailable'); });
  const response = await invoke(async () => upstreamResponse({ ok: true, data: [] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: [] });
  const failed = await invoke(async () => upstreamResponse('', { status: 503 }));
  assert.equal(failed.status, 502);
});
