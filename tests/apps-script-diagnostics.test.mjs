import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PRIVATE = 'private-content-and-secret-canary';

function fixture(route, logger) {
  const entries = [];
  const context = vm.createContext({
    console: { log: logger || ((text) => entries.push(JSON.parse(text))) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) })
    }
  });
  vm.runInContext(source, context, { filename: 'Code.js' });
  context.route_ = route;
  return { entries, context, invoke(body) { return context.doPost({ postData: { contents: JSON.stringify(body) } }); } };
}

test('Apps Script pairs receipt and completion with the Worker ID without logging content', () => {
  const f = fixture(() => [{ id: 'post-1', body: PRIVATE }]);
  const result = f.invoke({ action: 'storage.sync.post.list', _syncRequestId: REQUEST_ID, gatewaySecret: PRIVATE });
  assert.deepEqual(result.data, [{ id: 'post-1', body: PRIVATE }]);
  assert.equal(result._syncDiagnostic.requestId, REQUEST_ID);
  assert.equal(result._syncDiagnostic.outcome, 'ok');
  assert.equal(result._syncDiagnostic.dataType, 'array');
  assert.deepEqual(f.entries.map(e => e.stage), ['received', 'completed']);
  assert.ok(f.entries.every(e => e.requestId === REQUEST_ID && e.method === 'POST'));
  assert.equal(JSON.stringify(f.entries).includes(PRIVATE), false);
});

test('caught errors preserve the existing response and report a safe category and source location', () => {
  const error = new Error(`Service invoked too many times: ${PRIVATE}`);
  error.stack = `Error: ${PRIVATE}\n    at getSheet_ (Code:800:12)`;
  const f = fixture(() => { throw error; });
  const result = f.invoke({ action: 'storage.sync.post.list', _syncRequestId: REQUEST_ID });
  assert.equal(result.ok, false);
  assert.equal(result.error, error.message);
  assert.equal(result._syncDiagnostic.errorCategory, 'quota');
  assert.equal(result._syncDiagnostic.errorLocation, 'Code:800:12');
  assert.equal(f.entries.at(-1).outcome, 'error');
  assert.equal(JSON.stringify(f.entries).includes(PRIVATE), false);
});

test('ordinary API responses and invalid diagnostic IDs have no added response fields', () => {
  const f = fixture(() => []);
  for (const body of [
    { action: 'post.listPublic', _syncRequestId: REQUEST_ID },
    { action: 'storage.sync.post.list', _syncRequestId: PRIVATE },
    { action: 'storage.sync.post.list' }
  ]) assert.deepEqual(f.invoke(body), { ok: true, data: [] });
  assert.deepEqual(f.entries, []);
  assert.deepEqual(f.context.doGet({ parameter: {} }), { ok: true, data: { name: 'cha-amu-api' } });
  assert.equal(f.entries.at(-1).method, 'GET');
});

test('logging failure does not change a successful data operation', () => {
  let calls = 0;
  const f = fixture(() => { calls++; return []; }, () => { throw new Error('logging failed'); });
  const result = f.invoke({ action: 'storage.sync.post.list', _syncRequestId: REQUEST_ID });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});
