import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, ORIGIN, RAW_IP, ipHash, ADMIN_PASSWORD } from './helpers/worker-fixture.mjs';

const guestInput = { name: '', message: 'hello', deletePassword: 'password', turnstileToken: 'guest-turnstile' };
const storageHeaders = (f) => ({ Origin: '', Authorization: `Bearer ${f.env.STORAGE_SYNC_SECRET}` });
const validThing = { title: 'Valid thing', description: 'description', url: 'https://example.test/app', imageUrl: '', status: 'visible', sortOrder: 10 };

test('health is non-sensitive, exact CORS is returned, preflight allows bearer headers and routes stay bounded', async (t) => {
  const f = await fixture(t);
  const health = await f.gateway.fetch(new Request('https://gateway.test/health', { headers: { Origin: ORIGIN } }), f.env);
  assert.deepEqual(await health.json(), { ok: true, data: { name: 'cha-amu-gateway' } });
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(health.headers.get('Vary'), 'Origin');
  assert.equal(health.headers.get('Cache-Control'), 'no-store');
  const preflight = await f.gateway.fetch(new Request('https://gateway.test/api', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), f.env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  for (const [method, path] of [['GET', '/api'], ['PUT', '/api'], ['POST', '/other']]) {
    assert.equal((await f.gateway.fetch(new Request(`https://gateway.test${path}`, { method }), f.env)).status, 404);
  }
});

test('a different browser origin is rejected before database or external calls', async (t) => {
  const f = await fixture(t);
  delete f.env.SECURITY_DB;
  const result = await f.request('guestbook.listPublic', {}, { Origin: `${ORIGIN}.attacker.test` });
  assert.equal(result.status, 403);
  assert.equal(result.error, '허용되지 않은 요청 출처입니다.');
  assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(f.fetchCalls.length, 0);
});

test('JSON parsing, byte limits, media types, missing and unknown actions retain gateway errors', async (t) => {
  const f = await fixture(t);
  for (const [body, contentType, length, status] of [
    ['{', 'application/json', '', 400], ['[]', 'application/json', '', 400],
    ['null', 'text/plain', '', 400], ['{}', 'text/html', '', 415],
    ['{}', 'application/json', '65537', 413],
    [JSON.stringify({ message: '한'.repeat(23000) }), 'application/json', '', 413]
  ]) {
    const response = await f.gateway.fetch(new Request('https://gateway.test/api', {
      method: 'POST', headers: { 'Content-Type': contentType, 'Content-Length': length }, body
    }), f.env);
    assert.equal(response.status, status);
    assert.equal((await response.json()).ok, false);
  }
  assert.equal((await f.request('')).error, 'action이 필요합니다.');
  assert.equal((await f.request('unsupported')).error, '지원하지 않는 action입니다.');
  assert.deepEqual(await f.call(' guestbook.listPublic ', {}, { 'Content-Type': 'application/json' }), []);
});

test('guestbook create validates Turnstile and atomically stores only a server-chosen id and HMAC IP mapping', async (t) => {
  const f = await fixture(t);
  const result = await f.create({ gatewayEntryId: 'client-id', gatewaySecret: 'untrusted', token: 'ignored', clientId: 'browser-client-000001' });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(result.id, 'client-id');
  const entries = await f.rows('guestbook_entries');
  const mappings = await f.rows('guestbook_entry_ips');
  assert.equal(entries.length, 1);
  assert.equal(mappings.length, 1);
  assert.equal(entries[0].id, result.id);
  assert.deepEqual(mappings[0], { entry_id: result.id, ip_hash: ipHash(f.env), hash_version: 'v1', state: 'active', created_at: result.createdAt, updated_at: result.createdAt });
  assert.equal(JSON.stringify(entries).includes('clientId'), false);
  assert.equal(JSON.stringify(entries).includes('turnstile'), false);
  assert.equal(JSON.stringify(mappings).includes(RAW_IP), false);
  assert.equal(f.fetchCalls.length, 1);
  assert.equal(f.fetchCalls[0].form.get('remoteip'), RAW_IP);
  assert.equal(f.fetchCalls[0].form.get('secret'), f.env.TURNSTILE_SECRET_KEY);
  assert.equal(f.env.GUESTBOOK_CREATE_RATE_LIMITER.calls[0].key, mappings[0].ip_hash);
});

test('Turnstile token, success, hostname and action are checked exactly and outages fail closed', async (t) => {
  for (const result of [
    { success: false, hostname: 'cha-amu.github.io', action: 'guestbook_create' },
    { success: true, hostname: 'other.test', action: 'guestbook_create' },
    { success: true, hostname: 'cha-amu.github.io', action: 'admin_login' }
  ]) {
    const f = await fixture(t, { turnstile: () => result });
    assert.equal((await f.request('guestbook.create', guestInput)).status, 403);
    assert.deepEqual(await f.rows('guestbook_entries'), []);
  }
  const f = await fixture(t);
  for (const token of ['', 'x'.repeat(2049), null]) {
    assert.equal((await f.request('guestbook.create', { ...guestInput, turnstileToken: token })).status, 400);
  }
  for (const turnstile of [() => { throw new Error('network'); }, () => new Response('bad', { status: 503 }), () => new Response('not-json')]) {
    const broken = await fixture(t, { turnstile });
    assert.equal((await broken.request('guestbook.create', guestInput)).status, 503);
  }
});

test('an active manual IP ban blocks create before Turnstile and content writes', async (t) => {
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO ip_bans VALUES ('guestbook.create', ?, 'spam', 'old', ?, NULL)").bind(ipHash(f.env), f.deps.nowIso()).run();
  const result = await f.request('guestbook.create', guestInput);
  assert.equal(result.status, 403);
  assert.equal(result.error, '이 주소에서는 방명록을 작성할 수 없습니다.');
  assert.equal(f.fetchCalls.length, 0);
  assert.deepEqual(await f.rows('guestbook_entries'), []);
  assert.deepEqual(await f.rows('rate_limit_windows'), []);
});

test('interactive admin login needs admin_login Turnstile even with a storage bearer', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('admin.login', { password: ADMIN_PASSWORD }, storageHeaders(f))).status, 400);
  assert.equal((await f.request('admin.login', { password: ADMIN_PASSWORD, turnstileToken: 'guest-turnstile' }, storageHeaders(f))).status, 403);
  const session = await f.call('admin.login', { password: ADMIN_PASSWORD, turnstileToken: 'admin-turnstile' });
  assert.ok(session.token);
  assert.equal(f.env.ADMIN_LOGIN_RATE_LIMITER.calls[0].key, ipHash(f.env));
});

test('protected actions fail closed when Cloudflare rate limits are missing or exhausted', async (t) => {
  const f = await fixture(t);
  for (const [action, binding, payload] of [
    ['guestbook.create', 'GUESTBOOK_CREATE_RATE_LIMITER', guestInput],
    ['guestbook.hideByPassword', 'GUESTBOOK_DELETE_RATE_LIMITER', { id: 'g', deletePassword: 'x' }],
    ['admin.login', 'ADMIN_LOGIN_RATE_LIMITER', { password: ADMIN_PASSWORD, turnstileToken: 'admin-turnstile' }]
  ]) {
    delete f.env[binding];
    assert.equal((await f.request(action, payload)).status, 503);
    f.env[binding] = { limit: async () => ({ success: false }) };
    const result = await f.request(action, payload);
    assert.equal(result.status, 429);
    assert.equal(result.error, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
  }
  assert.equal(f.fetchCalls.length, 0);
});

test('IP normalization rejects malformed addresses and hashes canonical IPv4/IPv6', async (t) => {
  const f = await fixture(t);
  for (const raw of ['', 'not-an-ip', '1.2.3.4, 5.6.7.8', 'fe80::1%en0', '256.1.2.3']) {
    assert.equal((await f.request('guestbook.create', guestInput, { 'CF-Connecting-IP': raw })).status, 403);
  }
  for (const [raw, canonical] of [['001.002.003.004', '1.2.3.4'], ['2001:DB8:0:0::1', '2001:db8::1']]) {
    const entry = await f.call('guestbook.create', { ...guestInput, clientId: `ip-test-client-${canonical.replace(/[^a-z0-9]/g, '_')}` }, { 'CF-Connecting-IP': raw });
    assert.equal((await f.db.prepare('SELECT ip_hash FROM guestbook_entry_ips WHERE entry_id = ?').bind(entry.id).first()).ip_hash, ipHash(f.env, canonical));
  }
  f.env.IP_HASH_SECRET = 'short';
  assert.equal((await f.request('guestbook.create', guestInput)).status, 503);
});

test('admin list enriches active and legacy pending mappings, ignores orphans and never exposes hashes', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', ['active', 'pending', 'legacy'].map((id) => ({ id, status: 'visible', passwordHash: 'private-hash', passwordSalt: 'private-salt' })));
  await f.mapping('active'); await f.mapping('pending', ipHash(f.env), 'pending');
  await f.mapping('orphan'); await f.mapping('pending-orphan', ipHash(f.env), 'pending');
  await f.admin('admin.guestbook.ip.ban', { entryId: 'pending' });
  const entries = await f.admin('admin.guestbook.list');
  for (const entry of entries.slice(0, 2)) {
    assert.equal(entry.ipBanAvailable, true); assert.equal(entry.ipBlocked, true); assert.equal(entry.relatedEntryCount, 2);
  }
  assert.equal(entries[2].ipBanAvailable, false); assert.equal(entries[2].relatedEntryCount, 0);
  for (const secret of [ipHash(f.env), 'private-hash', 'private-salt', RAW_IP]) assert.equal(JSON.stringify(entries).includes(secret), false);
  assert.equal((await f.rows('guestbook_entry_ips')).find((row) => row.entry_id === 'pending').state, 'pending', 'reads need no reconciliation writes');
});

test('admin can create and revoke an indefinite ban by entryId or id alias with unchanged responses', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [{ id: 'one' }, { id: 'two' }]);
  await f.mapping('one'); await f.mapping('two');
  const banned = await f.admin('admin.guestbook.ip.ban', { entryId: ' one ', reason: '  spam  ' });
  assert.deepEqual(banned, { entryId: 'one', ipBlocked: true, relatedEntryCount: 2 });
  assert.equal((await f.rows('ip_bans'))[0].revoked_at, null);
  assert.equal((await f.rows('ip_bans'))[0].reason, 'spam');
  assert.deepEqual(await f.admin('admin.guestbook.ip.unban', { id: 'two' }), { entryId: 'two', ipBlocked: false, relatedEntryCount: 2 });
  assert.ok((await f.rows('ip_bans'))[0].revoked_at);
  assert.deepEqual((await f.rows('ip_ban_events')).map((row) => row.action), ['ban', 'unban']);
  assert.equal((await f.request('admin.guestbook.ip.ban', { token: f.session() })).status, 400);
  assert.equal((await f.request('admin.guestbook.ip.ban', { token: f.session(), entryId: 'no-map' })).status, 404);
});

test('active bans list is private, ordered and revocable by source after every related entry is deleted', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [{ id: 'old' }, { id: 'new' }, { id: 'revoked' }]);
  for (const id of ['old', 'new', 'revoked']) await f.mapping(id, ipHash(f.env, id));
  await f.admin('admin.guestbook.ip.ban', { entryId: 'old', reason: 'old ban' });
  f.advance(1000);
  await f.admin('admin.guestbook.ip.ban', { entryId: 'new' });
  await f.admin('admin.guestbook.ip.ban', { entryId: 'revoked' });
  await f.admin('admin.guestbook.ip.unban', { entryId: 'revoked' });
  const listed = await f.admin('admin.guestbook.ip.bans.list');
  assert.deepEqual(listed.bans.map((b) => b.sourceEntryId), ['new', 'old']);
  assert.deepEqual(listed.bans[0].relatedEntryIds, ['new']);
  assert.equal(listed.bans[0].relatedEntryCount, 1);
  assert.equal(listed.bans[0].reason, '관리자 수동 차단');
  assert.equal(JSON.stringify(listed).includes('ip_hash'), false);
  assert.equal(JSON.stringify(listed).includes(ipHash(f.env, 'new')), false);
  await f.admin('admin.guestbook.bulkDelete', { ids: ['new'] });
  const after = await f.admin('admin.guestbook.ip.bans.list');
  assert.equal(after.bans[0].relatedEntryCount, 0);
  assert.deepEqual(await f.admin('admin.guestbook.ip.unban', { entryId: 'new' }), { entryId: 'new', ipBlocked: false, relatedEntryCount: 0 });
});

test('IP security actions reject absent or invalid sessions before accessing D1', async (t) => {
  const f = await fixture(t);
  delete f.env.SECURITY_DB;
  for (const action of ['admin.guestbook.ip.bans.list', 'admin.guestbook.ip.ban', 'admin.guestbook.ip.unban']) {
    assert.equal((await f.request(action, { entryId: 'e' })).status, 401);
    const rejected = await f.request(action, { entryId: 'e', token: 'invalid.token' });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.error, '관리자 로그인이 만료되었습니다.');
  }
});

test('bulk actions trim and deduplicate ids and enforce action-specific request fields', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [{ id: 'g', status: 'visible', message: 'keep', passwordHash: 'keep hash' }]);
  assert.deepEqual(await f.admin('admin.guestbook.bulkStatus', { token: ` ${f.session()} `, ids: [' g ', 'g', 'missing'], status: ' visible ' }), { updatedIds: ['g'], missingIds: ['missing'] });
  await f.admin('admin.guestbook.bulkStatus', { ids: [' g ', 'g'], status: 'hidden', hiddenReason: ' repeated spam ' });
  assert.equal((await f.rows('guestbook_entries'))[0].hiddenReason, 'repeated spam');
  assert.equal((await f.rows('guestbook_entries'))[0].passwordHash, 'keep hash');
  assert.deepEqual(await f.admin('admin.assetOverride.bulkStatus', { ids: ['a'], status: 'deleted' }), { updatedIds: ['a'], missingIds: [] });
  for (const [action, id] of [['admin.guestbook.bulkDelete', 'g'], ['admin.assetOverride.delete', 'a'], ['admin.thing.delete', 'missing']]) {
    const data = await f.admin(action, { ids: [` ${id} `, id] });
    assert.deepEqual(data, id === 'missing' ? { deletedIds: [], alreadyMissingIds: [id] } : { deletedIds: [id], alreadyMissingIds: [] });
  }
});

test('public and admin reads ignore unrelated client fields without mutating content', async (t) => {
  const f = await fixture(t);
  await f.seed('things', [{ id: 't', status: 'hidden' }]);
  assert.deepEqual(await f.call('thing.listPublic', { token: 'ignored', ids: ['t'], thing: {}, gatewaySecret: 'ignored' }), []);
  assert.equal((await f.admin('admin.thing.list', { ids: ['ignored'], gatewaySecret: 'ignored' }))[0].id, 't');
  assert.equal(f.fetchCalls.length, 0);
});

test('thing save canonicalizes URLs, trims title/id, preserves description and clears image URLs', async (t) => {
  const f = await fixture(t);
  const created = await f.admin('admin.thing.save', { thing: { title: ' New thing ', url: ' HTTPS://Example.TEST/path with space ', imageUrl: '   ', status: ' visible ', sortOrder: 10 } });
  assert.equal(created.title, 'New thing'); assert.equal(created.url, 'https://example.test/path%20with%20space');
  assert.equal(created.imageUrl, ''); assert.equal(created.description, '');
  const updated = await f.admin('admin.thing.save', { thing: { ...validThing, id: ` ${created.id} `, description: ' keep spaces ', imageUrl: ' HTTPS://Images.Example.TEST/a b.png ', sortOrder: -5 } });
  assert.equal(updated.description, ' keep spaces '); assert.equal(updated.imageUrl, 'https://images.example.test/a%20b.png');
  assert.equal((await f.rows('things')).length, 1);
  await f.admin('admin.thing.save', { thing: { ...validThing, id: created.id, imageUrl: '' } });
  assert.equal((await f.call('thing.listPublic'))[0].imageUrl, '');
});

test('thing saves reject all legacy unsafe URL, malformed field and unknown field cases', async (t) => {
  const f = await fixture(t);
  const invalidPayloads = [
    { token: 'token', thing: { ...validThing, url: 'javascript:alert(1)' } },
    { token: 'token', thing: { ...validThing, url: 'data:text/html,unsafe' } },
    { token: 'token', thing: { ...validThing, url: '/relative/path' } },
    { token: 'token', thing: { ...validThing, url: 'https://user:password@example.test/app' } },
    { token: 'token', thing: { ...validThing, url: 'https://?missing-host' } },
    { token: 'token', thing: { ...validThing, url: 'https://example.test/path\nsegment' } },
    { token: 'token', thing: { ...validThing, imageUrl: 'javascript:alert(1)' } },
    { token: 'token', thing: { ...validThing, imageUrl: 'data:image/png;base64,unsafe' } },
    { token: 'token', thing: { ...validThing, imageUrl: '/relative/image.png' } },
    { token: 'token', thing: { ...validThing, imageUrl: 'https://user:password@example.test/image.png' } },
    { token: 'token', thing: { ...validThing, imageUrl: 'https://?missing-host' } },
    { token: 'token', thing: { ...validThing, imageUrl: 'https://example.test/image\nsegment.png' } },
    { token: 'token', thing: { ...validThing, title: '' } },
    { token: 'token', thing: { ...validThing, title: 'x'.repeat(161) } },
    { token: 'token', thing: { ...validThing, description: 'x'.repeat(2001) } },
    { token: 'token', thing: { ...validThing, status: 'deleted' } },
    { token: 'token', thing: { ...validThing, sortOrder: 1.5 } },
    { token: 'token', thing: { ...validThing, id: 'x'.repeat(129) } },
    ...['=FORMULA()', '+formula', '-formula', '@formula'].map((id) => ({
      token: 'token', thing: { ...validThing, id }
    })),
    { token: 'token', thing: { ...validThing, id: 'bad\u0000id' } },
    { token: 'token', thing: { ...validThing, unsupported: true } },
    { token: 'token', thing: validThing, ids: ['unsupported'] },
    { token: 'token', thing: null }
  ];
  for (const payload of invalidPayloads) {
    assert.equal((await f.request('admin.thing.save', payload)).status, 400, JSON.stringify(payload));
  }
  assert.deepEqual(await f.rows('things'), []);
});

test('bulk actions reject all legacy extra field and invalid status cases', async (t) => {
  const f = await fixture(t);
  const invalidCases = [
    ['admin.guestbook.bulkStatus', { token: 'token', ids: ['entry'], status: 'draft' }],
    ['admin.guestbook.bulkStatus', { token: 'token', ids: ['entry'], status: 'hidden' }],
    ['admin.guestbook.bulkStatus', {
      token: 'token', ids: ['entry'], status: 'visible', hiddenReason: 'not allowed'
    }],
    ['admin.assetOverride.bulkStatus', { token: 'token', ids: ['asset'], status: 'draft' }],
    ['admin.assetOverride.delete', { token: 'token', ids: ['asset'], status: 'deleted' }],
    ['admin.thing.delete', { token: 'token', ids: ['thing'], status: 'hidden' }],
    ...['=FORMULA()', '+formula', '-formula', '@formula'].map((id) => [
      'admin.thing.delete', { token: 'token', ids: [id] }
    ])
  ];
  for (const [action, payload] of invalidCases) assert.equal((await f.request(action, payload)).status, 400, action);
});

test('all three storage actions require exactly the storage bearer without human credentials', async (t) => {
  const f = await fixture(t);
  const cases = [
    ['storage.sync.assetOverride.list', {}], ['storage.sync.assetOverride.save', { override: { assetId: 'a' } }],
    ['storage.sync.assetOverride.delete', { ids: ['a'] }]
  ];
  for (const [action, body] of cases) {
    assert.equal((await f.request(action, body, { Origin: '' })).status, 403);
    assert.equal((await f.request(action, body, { Authorization: 'Bearer wrong' })).status, 403);
    await f.storage(action, body);
  }
  assert.equal(f.fetchCalls.length, 0);
});

test('storage sync fails closed on configuration, unknown fields, unknown namespace and admin use', async (t) => {
  const f = await fixture(t);
  const secret = f.env.STORAGE_SYNC_SECRET;
  for (const configured of [undefined, 'short']) {
    f.env.STORAGE_SYNC_SECRET = configured;
    assert.equal((await f.request('storage.sync.assetOverride.list', {}, { Authorization: `Bearer ${secret}` })).status, 503);
  }
  f.env.STORAGE_SYNC_SECRET = secret;
  for (const body of [{ token: 'token' }, { password: 'password' }, { gatewaySecret: 'client-secret' }]) {
    assert.equal((await f.request('storage.sync.assetOverride.list', body, storageHeaders(f))).status, 400);
  }
  assert.equal((await f.request('storage.sync.guestbook.list', {}, storageHeaders(f))).status, 400);
  assert.equal((await f.request('admin.guestbook.ip.ban', { entryId: 'entry' }, storageHeaders(f))).status, 401);
  assert.equal((await f.request('admin.assetOverride.list', {}, storageHeaders(f))).ok, false);
});

test('storage validation rejects malformed asset and id fields', async (t) => {
  const f = await fixture(t);
  for (const override of [null, { assetId: '' }, { assetId: 'a', status: 'draft' }, { assetId: 'a', tags: ['x'.repeat(101)] }, { assetId: 'a', sortOrder: '3' }, { assetId: 'a', sortOrder: 1e20 }, { assetId: 'a', extra: true }]) {
    assert.equal((await f.request('storage.sync.assetOverride.save', { override }, storageHeaders(f))).status, 400);
  }
  for (const ids of [null, [], [''], [23], ['x'.repeat(513)]]) {
    assert.equal((await f.request('admin.assetOverride.delete', { token: f.session(), ids })).status, 400);
  }
});

test('bulk requests allow 100 unique ids after deduplication and reject 101', async (t) => {
  const f = await fixture(t);
  const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
  assert.deepEqual(await f.admin('admin.assetOverride.delete', { ids: [...ids, ...ids] }), { deletedIds: [], alreadyMissingIds: ids });
  assert.equal((await f.request('admin.assetOverride.delete', { token: f.session(), ids: [...ids, 'overflow'] })).status, 400);
});

test('guestbook deletion removes only requested mappings, preserves bans and cannot confirm unrelated ids', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [{ id: 'one' }, { id: 'two' }]);
  for (const id of ['one', 'two', 'missing']) await f.mapping(id);
  await f.admin('admin.guestbook.ip.ban', { entryId: 'one' });
  assert.deepEqual(await f.admin('admin.guestbook.bulkDelete', { ids: ['one', 'missing'] }), { deletedIds: ['one'], alreadyMissingIds: ['missing'] });
  assert.deepEqual((await f.rows('guestbook_entry_ips')).map((r) => r.entry_id), ['two']);
  assert.equal((await f.rows('ip_bans')).length, 1);
  assert.equal((await f.rows('ip_ban_events')).length, 1);
  assert.deepEqual(await f.admin('admin.guestbook.bulkDelete', { ids: ['one', 'missing'] }), { deletedIds: [], alreadyMissingIds: ['one', 'missing'] });
});

test('D1 create rolls back entry and mapping together on failure in either statement', async (t) => {
  for (const table of ['guestbook_entries', 'guestbook_entry_ips']) {
    const f = await fixture(t);
    await f.db.prepare(`CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END`).run();
    const result = await f.request('guestbook.create', guestInput);
    assert.equal(result.status, 503);
    assert.equal(result.error, '보안 게이트웨이가 요청을 처리하지 못했습니다.');
    assert.deepEqual(await f.rows('guestbook_entries'), []);
    assert.deepEqual(await f.rows('guestbook_entry_ips'), []);
    assert.equal(f.fetchCalls.length, 1, 'writes are never retried');
    await f.db.prepare('DROP TRIGGER fail_insert').run();
    await f.create({ clientId: 'fresh-client-00000001' });
    assert.equal((await f.rows('guestbook_entries')).length, 1);
    assert.equal((await f.rows('guestbook_entry_ips')).length, 1);
  }
});

test('D1 bulk deletion rolls back entries if mapping cleanup fails and retry commits exactly once', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [{ id: 'g', message: 'keep' }]); await f.mapping('g');
  await f.db.prepare("CREATE TRIGGER fail_delete BEFORE DELETE ON guestbook_entry_ips BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END").run();
  assert.equal((await f.request('admin.guestbook.bulkDelete', { token: f.session(), ids: ['g'] })).status, 503);
  assert.equal((await f.rows('guestbook_entries')).length, 1);
  assert.equal((await f.rows('guestbook_entry_ips')).length, 1);
  assert.deepEqual(await f.rows('audit_log'), []);
  await f.db.prepare('DROP TRIGGER fail_delete').run();
  assert.deepEqual(await f.admin('admin.guestbook.bulkDelete', { ids: ['g'] }), { deletedIds: ['g'], alreadyMissingIds: [] });
  assert.equal((await f.rows('audit_log')).length, 1);
});

test('invalid admin sessions cannot delete entries or mappings', async (t) => {
  const f = await fixture(t);
  await f.seed('guestbook', [{ id: 'g' }]); await f.mapping('g');
  const response = await f.request('admin.guestbook.bulkDelete', { token: 'invalid.token', ids: ['g'] });
  assert.equal(response.status, 200); assert.equal(response.ok, false);
  assert.equal((await f.rows('guestbook_entries')).length, 1);
  assert.equal((await f.rows('guestbook_entry_ips')).length, 1);
});

test('public reads use D1 with no network, immediately reflect writes, and fail closed without a database', async (t) => {
  const f = await fixture(t);
  for (const action of ['guestbook.listPublic', 'thing.listPublic', 'assetOverride.listPublic']) assert.deepEqual(await f.call(action), []);
  await f.admin('admin.assetOverride.save', { override: { assetId: 'a', displayName: 'instant' } });
  assert.equal((await f.call('assetOverride.listPublic'))[0].displayName, 'instant');
  assert.equal(f.fetchCalls.length, 0);
  delete f.env.SECURITY_DB;
  assert.equal((await f.request('guestbook.listPublic')).status, 503);
});
