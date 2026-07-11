import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');
const GATEWAY_SECRET = 'gateway-test-secret-000000000000000000000000000000000';
const SESSION_SECRET = 'admin-session-secret-000000000000000000000000000000000';
const GUESTBOOK_PEPPER = 'guestbook-test-pepper-00000000000000000000000000000000';

const COLUMNS = {
  posts: [
    'id', 'slug', 'title', 'excerpt', 'body', 'tags', 'status',
    'createdAt', 'updatedAt', 'publishedAt', 'source', 'storagePath',
    'bodyUrl', 'syncStatus'
  ],
  postDeletions: ['id', 'storagePath', 'nonce', 'deletedAt', 'finalizedAt'],
  guestbook: [
    'id', 'name', 'message', 'status', 'createdAt', 'passwordSalt',
    'passwordHash', 'passwordHashAlgorithm', 'passwordHashIterations', 'hiddenReason'
  ],
  assetOverrides: [
    'assetId', 'displayName', 'description', 'tags', 'sourceUrl',
    'status', 'sortOrder', 'updatedAt'
  ]
};

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    this.sheet.record('read');
    const output = [];
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      const outputRow = [];
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
        outputRow.push(this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset));
      }
      output.push(outputRow);
    }
    return output;
  }

  setValue(value) {
    return this.setValues([[value]]);
  }

  setValues(values) {
    this.sheet.record('write');
    assert.equal(values.length, this.rowCount);
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      assert.equal(values[rowOffset].length, this.columnCount);
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
        this.sheet.setValueAt(this.row + rowOffset, this.column + columnOffset, values[rowOffset][columnOffset]);
      }
    }
    return this;
  }
}

class FakeSheet {
  constructor(rows = [], name = '', lockState = null) {
    this.rows = rows.map((row) => row.slice());
    this.name = name;
    this.lockState = lockState;
  }

  record(operation) {
    if (!this.lockState) return;
    this.lockState.events.push({ sheet: this.name, operation, locked: this.lockState.depth > 0 });
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }

  setValueAt(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.rows.length), Math.max(1, this.getLastColumn()));
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getLastColumn() {
    return this.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  }

  appendRow(row) {
    this.record('write');
    this.rows.push(row.slice());
  }

  deleteRow(rowNumber) {
    this.record('write');
    assert.ok(rowNumber > 1 && rowNumber <= this.rows.length, `invalid delete row ${rowNumber}`);
    this.rows.splice(rowNumber - 1, 1);
  }

  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(initial = {}, lockState = null) {
    this.lockState = lockState;
    this.sheets = new Map(Object.entries(initial).map(([name, rows]) => [name, new FakeSheet(rows, name, lockState)]));
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new FakeSheet([], name, this.lockState);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

function tableRows(columns, records) {
  return [columns, ...records.map((record) => columns.map((column) => record[column] ?? ''))];
}

function sheetObjects(spreadsheet, sheetName) {
  const rows = spreadsheet.getSheetByName(sheetName)?.rows || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).filter((row) => row.some((value) => value !== '')).map((row) => {
    const object = {};
    headers.forEach((header, index) => { object[header] = row[index] ?? ''; });
    return object;
  });
}

function bufferFrom(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Buffer.from(value);
  return Buffer.from(String(value));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function adminToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, nonce: 'test-session' })).toString('base64url');
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function loadAppsScript(initial = {}) {
  const lockState = { depth: 0, events: [] };
  const spreadsheet = new FakeSpreadsheet(initial, lockState);
  const cacheValues = new Map();
  let uuid = 0;
  const properties = new Map([
    ['SPREADSHEET_ID', 'spreadsheet-test-id-000000000000'],
    ['GATEWAY_SHARED_SECRET', GATEWAY_SECRET],
    ['ADMIN_SESSION_SECRET', SESSION_SECRET],
    ['GUESTBOOK_SERVER_PEPPER', GUESTBOOK_PEPPER]
  ]);
  const cache = {
    get: (key) => cacheValues.get(key) ?? null,
    put: (key, value) => cacheValues.set(key, value),
    remove: (key) => cacheValues.delete(key)
  };
  const context = vm.createContext({
    console,
    SpreadsheetApp: { openById: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || null })
    },
    CacheService: { getScriptCache: () => cache },
    LockService: {
      getScriptLock: () => ({
        waitLock() { lockState.depth += 1; },
        releaseLock() {
          assert.ok(lockState.depth > 0, 'released an unlocked script lock');
          lockState.depth -= 1;
        }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => `test-uuid-${++uuid}`,
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(bufferFrom(value)).digest()),
      computeHmacSha256Signature: (value, secret) => Array.from(createHmac('sha256', bufferFrom(secret)).update(bufferFrom(value)).digest()),
      base64DecodeWebSafe: (value) => Array.from(Buffer.from(String(value), 'base64url')),
      base64EncodeWebSafe: (value) => bufferFrom(value).toString('base64url'),
      newBlob: (value) => ({
        getBytes: () => Array.from(bufferFrom(value)),
        getDataAsString: () => bufferFrom(value).toString()
      })
    }
  });
  vm.runInContext(source, context);
  const route = vm.runInContext('route_', context);
  return {
    spreadsheet,
    drainSheetEvents(sheetName) {
      const events = lockState.events.splice(0);
      return events.filter((event) => event.sheet === sheetName);
    },
    call(action, payload = {}) {
      return plain(route(action, { gatewaySecret: GATEWAY_SECRET, token: adminToken(), ...payload }));
    },
    publicCall(action) {
      return plain(route(action, {}));
    },
    rawCall(action, payload = {}) {
      return plain(route(action, payload));
    }
  };
}

function post(id, status = 'published', overrides = {}) {
  return {
    id,
    title: `title-${id}`,
    excerpt: `excerpt-${id}`,
    body: `private-body-${id}`,
    tags: ['private-tag'],
    status,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T01:00:00.000Z',
    publishedAt: status === 'published' ? '2026-07-10T00:30:00.000Z' : '',
    source: 'storage',
    storagePath: `posts/${id}.md`,
    ...overrides
  };
}

function guestbook(id, status = 'visible') {
  return {
    id,
    name: `name-${id}`,
    message: `message-${id}`,
    status,
    createdAt: '2026-07-10T00:00:00.000Z',
    passwordSalt: `salt-${id}`,
    passwordHash: `hash-${id}`,
    passwordHashAlgorithm: 'SHA-256+salt+pepper',
    passwordHashIterations: 1,
    hiddenReason: status === 'hidden' ? 'old reason' : ''
  };
}

function guestbookPasswordHash(password, salt) {
  return createHash('sha256').update(`${salt}:${password}:${GUESTBOOK_PEPPER}`).digest('hex');
}

function assertSheetMutationLocked(app, sheetName, callback) {
  app.drainSheetEvents(sheetName);
  const result = callback();
  const events = app.drainSheetEvents(sheetName);
  assert.ok(events.some((event) => event.operation === 'read'), `${sheetName} was not read`);
  assert.ok(events.some((event) => event.operation === 'write'), `${sheetName} was not written`);
  assert.ok(events.every((event) => event.locked), `${sheetName} was accessed outside ScriptLock`);
  return result;
}

test('public post suppression uses the version 2 cache namespace', () => {
  assert.match(source, /posts:\s*'public:posts:v2'/);
  assert.doesNotMatch(source, /posts:\s*'public:posts:v1'/);
});

test('bulk routes require gateway and admin authentication and reject unbounded or duplicate ids', () => {
  const app = loadAppsScript({ posts: tableRows(COLUMNS.posts, [post('p1')]) });

  assert.throws(
    () => app.rawCall('admin.post.bulkStatus', { token: adminToken(), ids: ['p1'], status: 'hidden' }),
    /gateway authentication failed/i
  );
  assert.throws(
    () => app.rawCall('admin.post.bulkStatus', { gatewaySecret: GATEWAY_SECRET, token: 'invalid.token', ids: ['p1'], status: 'hidden' }),
    /invalid|json|session/i
  );
  assert.throws(() => app.call('admin.post.bulkStatus', { ids: ['p1', ' p1 '], status: 'hidden' }), /unique ids/i);
  assert.throws(
    () => app.call('admin.post.bulkStatus', { ids: Array.from({ length: 101 }, (_, index) => `p${index}`), status: 'hidden' }),
    /1 to 100/
  );
  assert.equal(sheetObjects(app.spreadsheet, 'posts')[0].status, 'published');
});

test('post bulk status patches only status fields and public results suppress private nonpublished data', () => {
  const app = loadAppsScript({
    posts: tableRows(COLUMNS.posts, [post('public'), post('draft', 'draft'), post('hidden', 'hidden')])
  });

  const before = app.publicCall('post.listPublic');
  const draftSuppression = before.find((entry) => entry.id === 'draft');
  assert.deepEqual(Object.keys(draftSuppression).sort(), ['id', 'status', 'updatedAt']);
  assert.equal(JSON.stringify(before).includes('private-body-draft'), false);
  assert.equal(JSON.stringify(before).includes('private-body-hidden'), false);

  const result = app.call('admin.post.bulkStatus', { ids: ['public', 'draft', 'missing'], status: 'hidden' });
  assert.deepEqual(result, { updatedIds: ['public', 'draft'], missingIds: ['missing'] });
  const rows = sheetObjects(app.spreadsheet, 'posts');
  assert.equal(rows.find((entry) => entry.id === 'public').body, 'private-body-public');
  assert.equal(rows.find((entry) => entry.id === 'public').title, 'title-public');
  assert.equal(rows.find((entry) => entry.id === 'public').status, 'hidden');

  app.call('admin.post.bulkStatus', { ids: ['draft'], status: 'published' });
  const publishedDraft = sheetObjects(app.spreadsheet, 'posts').find((entry) => entry.id === 'draft');
  assert.ok(publishedDraft.publishedAt);
  assert.equal(publishedDraft.body, 'private-body-draft');
});

test('post save and storage sync cannot revive an id while its deletion tombstone remains', () => {
  const app = loadAppsScript({
    posts: tableRows(COLUMNS.posts, [post('existing')]),
    postDeletions: tableRows(COLUMNS.postDeletions, [{
      id: 'deleted',
      storagePath: 'posts/deleted.md',
      nonce: 'deletion-nonce',
      deletedAt: '2026-07-10T02:00:00.000Z'
    }])
  });

  assert.throws(
    () => app.call('admin.post.save', { post: post('deleted', 'draft', { body: 'stale editor body' }) }),
    /permanently deleted/i
  );
  assert.throws(
    () => app.call('admin.post.syncFromStorage', { post: post('deleted', 'published', { body: 'stale storage body' }) }),
    /permanently deleted/i
  );
  assert.deepEqual(sheetObjects(app.spreadsheet, 'posts').map((entry) => entry.id), ['existing']);
  assert.deepEqual(app.call('admin.postDeletion.list').map((entry) => entry.id), ['deleted']);

  const saved = app.call('admin.post.save', {
    post: post('existing', 'draft', { body: 'updated editor body' })
  });
  assert.equal(saved.id, 'existing');
  assert.equal(sheetObjects(app.spreadsheet, 'posts')[0].body, 'updated editor body');

  const created = app.call('admin.post.save', {
    post: { title: 'new post', body: 'new body', status: 'draft' }
  });
  assert.ok(created.id);
  assert.equal(sheetObjects(app.spreadsheet, 'posts').some((entry) => entry.id === created.id), true);

  const synced = app.call('admin.post.syncFromStorage', { post: post('storage-new') });
  assert.equal(synced.id, 'storage-new');
  assert.equal(sheetObjects(app.spreadsheet, 'posts').some((entry) => entry.id === 'storage-new'), true);
});

test('deleting a missing post creates an idempotent tombstone and blocks storage resurrection', () => {
  const app = loadAppsScript({
    posts: tableRows(COLUMNS.posts, [post('existing')]),
    postDeletions: tableRows(COLUMNS.postDeletions, [])
  });

  assert.equal(app.publicCall('post.listPublic').some((entry) => entry.id === 'missing'), false);
  assert.deepEqual(
    app.call('admin.post.bulkDelete', { ids: ['missing'] }),
    { deletedIds: [], alreadyMissingIds: ['missing'] }
  );

  const tombstones = app.call('admin.postDeletion.list');
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'missing');
  assert.equal(tombstones[0].storagePath, '');
  assert.ok(tombstones[0].nonce);
  assert.ok(tombstones[0].deletedAt);
  assert.deepEqual(
    app.publicCall('post.listPublic').find((entry) => entry.id === 'missing'),
    { id: 'missing', status: 'deleted', updatedAt: tombstones[0].deletedAt }
  );
  assert.throws(
    () => app.call('admin.post.syncFromStorage', { post: post('missing') }),
    /permanently deleted/i
  );
  assert.deepEqual(
    app.call('admin.post.bulkDelete', { ids: ['missing'] }),
    { deletedIds: [], alreadyMissingIds: ['missing'] }
  );
  assert.deepEqual(app.call('admin.postDeletion.list'), tombstones);
});

test('post bulk delete removes nonadjacent rows bottom-up, preserves tombstone nonce on retry, and finalizes by id plus nonce', () => {
  const app = loadAppsScript({
    posts: tableRows(COLUMNS.posts, [post('p1'), post('p2'), post('p3'), post('p4')]),
    postDeletions: tableRows(COLUMNS.postDeletions, [{
      id: 'p4',
      storagePath: '',
      nonce: 'existing-nonce',
      deletedAt: '2026-07-09T00:00:00.000Z'
    }])
  });

  const deleted = app.call('admin.post.bulkDelete', { ids: ['p2', 'p4'] });
  assert.deepEqual(deleted, { deletedIds: ['p2', 'p4'], alreadyMissingIds: [] });
  assert.deepEqual(sheetObjects(app.spreadsheet, 'posts').map((entry) => entry.id), ['p1', 'p3']);

  const tombstones = app.call('admin.postDeletion.list');
  assert.deepEqual(tombstones.map((entry) => entry.id), ['p4', 'p2']);
  assert.deepEqual(tombstones.map((entry) => entry.storagePath), ['posts/p4.md', 'posts/p2.md']);
  assert.equal(tombstones[0].nonce, 'existing-nonce');
  assert.equal(tombstones[0].deletedAt, '2026-07-09T00:00:00.000Z');
  const p2Deletion = tombstones.find((entry) => entry.id === 'p2');
  const publicRecords = app.publicCall('post.listPublic').filter((entry) => entry.status === 'deleted');
  assert.deepEqual(publicRecords.map((entry) => entry.id), ['p4', 'p2']);
  assert.ok(publicRecords.every((entry) => Object.keys(entry).sort().join(',') === 'id,status,updatedAt'));
  assert.equal(JSON.stringify(publicRecords).includes('nonce'), false);
  assert.equal(JSON.stringify(publicRecords).includes('storagePath'), false);

  const retried = app.call('admin.post.bulkDelete', { ids: ['p2', 'p4'] });
  assert.deepEqual(retried, { deletedIds: [], alreadyMissingIds: ['p2', 'p4'] });
  assert.deepEqual(app.call('admin.postDeletion.list'), tombstones);

  assert.throws(
    () => app.call('admin.postDeletion.finalize', {
      deletions: [
        { id: 'p2', nonce: p2Deletion.nonce },
        { id: 'p4', nonce: 'wrong-nonce' }
      ]
    }),
    /nonce is invalid/i
  );
  assert.equal(app.call('admin.postDeletion.list').length, 2);

  const finalized = app.call('admin.postDeletion.finalize', {
    deletions: tombstones.map((entry) => ({ id: entry.id, nonce: entry.nonce }))
  });
  assert.deepEqual(finalized, { finalizedIds: ['p4', 'p2'], alreadyMissingIds: [] });
  assert.deepEqual(app.call('admin.postDeletion.list'), []);
  const ledger = sheetObjects(app.spreadsheet, 'postDeletions');
  assert.deepEqual(ledger.map((entry) => entry.id), ['p4', 'p2']);
  assert.ok(ledger.every((entry) => entry.finalizedAt));
  assert.deepEqual(
    app.publicCall('post.listPublic').filter((entry) => entry.status === 'deleted').map((entry) => entry.id),
    ['p4', 'p2']
  );
  assert.throws(
    () => app.call('admin.post.save', { post: post('p2', 'draft', { body: 'stale editor after finalize' }) }),
    /permanently deleted/i
  );
  assert.throws(
    () => app.call('admin.post.syncFromStorage', { post: post('p4', 'published', { body: 'storage reappeared after finalize' }) }),
    /permanently deleted/i
  );
  assert.deepEqual(sheetObjects(app.spreadsheet, 'posts').map((entry) => entry.id), ['p1', 'p3']);
  assert.deepEqual(
    app.call('admin.postDeletion.finalize', { deletions: tombstones.map((entry) => ({ id: entry.id, nonce: entry.nonce })) }),
    { finalizedIds: [], alreadyMissingIds: ['p4', 'p2'] }
  );
});

test('single-row mutations read and write their sheets only while ScriptLock is held', () => {
  const password = 'delete-password';
  const salt = 'password-salt';
  const app = loadAppsScript({
    posts: tableRows(COLUMNS.posts, [post('p1'), post('storage-p1')]),
    postDeletions: tableRows(COLUMNS.postDeletions, []),
    guestbook: tableRows(COLUMNS.guestbook, [{
      ...guestbook('g1'),
      passwordSalt: salt,
      passwordHash: guestbookPasswordHash(password, salt)
    }]),
    assetOverrides: tableRows(COLUMNS.assetOverrides, [
      { assetId: 'a1', displayName: 'before', status: 'visible' }
    ])
  });

  assertSheetMutationLocked(app, 'guestbook', () => app.call('guestbook.hideByPassword', {
    id: 'g1',
    deletePassword: password,
    clientId: 'lock-test-client-0001'
  }));
  assertSheetMutationLocked(app, 'guestbook', () => app.call('admin.guestbook.restore', { id: 'g1' }));
  assertSheetMutationLocked(app, 'guestbook', () => app.call('admin.guestbook.hide', { id: 'g1', hiddenReason: 'manual' }));
  assertSheetMutationLocked(app, 'assetOverrides', () => app.call('admin.assetOverride.save', {
    override: { assetId: 'a1', displayName: 'after', status: 'hidden' }
  }));
  assertSheetMutationLocked(app, 'posts', () => app.call('admin.post.save', {
    post: post('p1', 'draft', { body: 'locked editor update' })
  }));
  assertSheetMutationLocked(app, 'posts', () => app.call('admin.post.syncFromStorage', {
    post: post('storage-p1', 'published', { body: 'locked storage update' })
  }));

  const guestbookRow = sheetObjects(app.spreadsheet, 'guestbook')[0];
  assert.equal(guestbookRow.status, 'hidden');
  assert.equal(guestbookRow.hiddenReason, 'manual');
  assert.equal(sheetObjects(app.spreadsheet, 'assetOverrides')[0].displayName, 'after');
});

test('guestbook bulk status preserves content and hashes while bulk delete is bottom-up and idempotent', () => {
  const app = loadAppsScript({
    guestbook: tableRows(COLUMNS.guestbook, [guestbook('g1'), guestbook('g2'), guestbook('g3')])
  });

  const hidden = app.call('admin.guestbook.bulkStatus', {
    ids: ['g1', 'g3', 'missing'],
    status: 'hidden',
    hiddenReason: '  repeated spam  '
  });
  assert.deepEqual(hidden, { updatedIds: ['g1', 'g3'], missingIds: ['missing'] });
  let rows = sheetObjects(app.spreadsheet, 'guestbook');
  assert.equal(rows.find((entry) => entry.id === 'g1').hiddenReason, 'repeated spam');
  assert.equal(rows.find((entry) => entry.id === 'g1').message, 'message-g1');
  assert.equal(rows.find((entry) => entry.id === 'g1').passwordHash, 'hash-g1');

  app.call('admin.guestbook.bulkStatus', { ids: ['g1'], status: 'visible' });
  rows = sheetObjects(app.spreadsheet, 'guestbook');
  assert.equal(rows.find((entry) => entry.id === 'g1').hiddenReason, '');
  assert.throws(() => app.call('admin.guestbook.bulkStatus', { ids: ['g1'], status: 'deleted' }), /invalid guestbook status/i);

  const deleted = app.call('admin.guestbook.bulkDelete', { ids: ['g1', 'g3', 'missing'] });
  assert.deepEqual(deleted, { deletedIds: ['g1', 'g3'], alreadyMissingIds: ['missing'] });
  assert.deepEqual(sheetObjects(app.spreadsheet, 'guestbook').map((entry) => entry.id), ['g2']);
  assert.equal(JSON.stringify(sheetObjects(app.spreadsheet, 'guestbook')).includes('hash-g1'), false);
  assert.deepEqual(
    app.call('admin.guestbook.bulkDelete', { ids: ['g1', 'g3'] }),
    { deletedIds: [], alreadyMissingIds: ['g1', 'g3'] }
  );
});

test('asset override bulk status patches existing metadata, creates minimal overrides, and reset deletion is idempotent', () => {
  const app = loadAppsScript({
    assetOverrides: tableRows(COLUMNS.assetOverrides, [
      { assetId: 'a1', displayName: 'keep me', description: 'private note', tags: ['tag'], status: 'visible', sortOrder: 3 },
      { assetId: 'a2', displayName: 'second', status: 'hidden' },
      { assetId: 'a3', displayName: 'third', status: 'visible' }
    ])
  });

  const updated = app.call('admin.assetOverride.bulkStatus', { ids: ['a1', 'new-asset'], status: 'deleted' });
  assert.deepEqual(updated, { updatedIds: ['a1', 'new-asset'], missingIds: [] });
  let rows = sheetObjects(app.spreadsheet, 'assetOverrides');
  assert.equal(rows.find((entry) => entry.assetId === 'a1').displayName, 'keep me');
  assert.equal(rows.find((entry) => entry.assetId === 'a1').description, 'private note');
  assert.equal(rows.find((entry) => entry.assetId === 'new-asset').status, 'deleted');
  assert.throws(() => app.call('admin.assetOverride.bulkStatus', { ids: ['a1'], status: 'draft' }), /invalid asset override status/i);

  const deleted = app.call('admin.assetOverride.delete', { ids: ['a1', 'a3', 'new-asset', 'missing'] });
  assert.deepEqual(deleted, { deletedIds: ['a1', 'a3', 'new-asset'], alreadyMissingIds: ['missing'] });
  rows = sheetObjects(app.spreadsheet, 'assetOverrides');
  assert.deepEqual(rows.map((entry) => entry.assetId), ['a2']);
  assert.deepEqual(
    app.call('admin.assetOverride.delete', { ids: ['a1', 'a3'] }),
    { deletedIds: [], alreadyMissingIds: ['a1', 'a3'] }
  );
});
