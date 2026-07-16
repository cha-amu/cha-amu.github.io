import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import { createGateway } from '../worker/src/index.js';

const APP_URL = 'https://apps-script.test/exec';
const ORIGIN = 'https://cha-amu.github.io';
const RAW_IP = '203.0.113.42';
const CREATED_ID = '11111111-1111-4111-8111-111111111111';
const DELETE_ACTIONS = new Set([
  'admin.post.bulkDelete',
  'admin.guestbook.bulkDelete',
  'admin.assetOverride.delete',
  'admin.thing.delete'
]);

class FakeD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes('SELECT 1 AS banned')) {
      const [scope, ipHash] = this.values;
      const ban = this.database.bans.get(`${scope}:${ipHash}`);
      return ban && !ban.revokedAt ? { banned: 1 } : null;
    }
    if (this.sql.includes("SELECT ip_hash FROM guestbook_entry_ips")) {
      const mapping = this.database.mappings.get(this.values[0]);
      return mapping?.state === 'active' ? { ip_hash: mapping.ipHash } : null;
    }
    if (this.sql.includes('FROM ip_bans') && this.sql.includes('source_entry_id = ?')) {
      const [scope, sourceEntryId] = this.values;
      const ban = Array.from(this.database.bans.values()).find((candidate) => (
        candidate.scope === scope &&
        candidate.sourceEntryId === sourceEntryId &&
        !candidate.revokedAt
      ));
      return ban ? { ip_hash: ban.ipHash } : null;
    }
    if (this.sql.includes('SELECT COUNT(*) AS count')) {
      const [ipHash] = this.values;
      const count = Array.from(this.database.mappings.values())
        .filter((mapping) => mapping.ipHash === ipHash && mapping.state === 'active').length;
      return { count };
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith('SELECT entry_id, state FROM guestbook_entry_ips')) {
      return {
        success: true,
        results: Array.from(this.database.mappings.entries())
          .map(([entryId, mapping]) => ({ entry_id: entryId, state: mapping.state }))
      };
    }
    if (!this.sql.includes('FROM guestbook_entry_ips m')) {
      if (this.sql.includes('FROM ip_bans b')) {
        const [scope] = this.values;
        const results = [];
        const activeBans = Array.from(this.database.bans.values())
          .filter((ban) => ban.scope === scope && !ban.revokedAt)
          .sort((left, right) => right.bannedAt.localeCompare(left.bannedAt));
        for (const ban of activeBans) {
          const relatedEntries = Array.from(this.database.mappings.entries())
            .filter(([, mapping]) => mapping.ipHash === ban.ipHash && mapping.state === 'active')
            .sort((left, right) => {
              const byCreatedAt = String(left[1].createdAt || '').localeCompare(String(right[1].createdAt || ''));
              return byCreatedAt || left[0].localeCompare(right[0]);
            });
          if (!relatedEntries.length) {
            results.push({
              ip_hash: ban.ipHash,
              reason: ban.reason,
              source_entry_id: ban.sourceEntryId,
              banned_at: ban.bannedAt,
              related_entry_id: null
            });
            continue;
          }
          for (const [entryId] of relatedEntries) {
            results.push({
              ip_hash: ban.ipHash,
              reason: ban.reason,
              source_entry_id: ban.sourceEntryId,
              banned_at: ban.bannedAt,
              related_entry_id: entryId
            });
          }
        }
        return { success: true, results };
      }
      throw new Error(`Unhandled all SQL: ${this.sql}`);
    }
    const [scope] = this.values;
    const results = Array.from(this.database.mappings.entries())
      .filter(([, mapping]) => mapping.state === 'active')
      .map(([entryId, mapping]) => {
        const ban = this.database.bans.get(`${scope}:${mapping.ipHash}`);
        const relatedCount = Array.from(this.database.mappings.values())
          .filter((related) => related.ipHash === mapping.ipHash && related.state === 'active').length;
        return {
          entry_id: entryId,
          ip_blocked: ban && !ban.revokedAt ? 1 : 0,
          related_entry_count: relatedCount
        };
      });
    return { success: true, results };
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO guestbook_entry_ips')) {
      const [entryId, ipHash, createdAt, updatedAt] = this.values;
      this.database.mappings.set(entryId, { ipHash, state: 'pending', createdAt, updatedAt });
      return changed(1);
    }
    if (this.sql.startsWith('UPDATE guestbook_entry_ips')) {
      if (this.database.failActivationOnce) {
        this.database.failActivationOnce = false;
        throw new Error('simulated D1 activation outage');
      }
      const [updatedAt, entryId] = this.values;
      const mapping = this.database.mappings.get(entryId);
      if (!mapping || mapping.state !== 'pending') return changed(0);
      mapping.state = 'active';
      mapping.updatedAt = updatedAt;
      return changed(1);
    }
    if (this.sql.startsWith('DELETE FROM guestbook_entry_ips')) {
      const mapping = this.database.mappings.get(this.values[0]);
      if (!this.sql.includes("state = 'pending'")) {
        if (this.database.failMappingCleanup) throw new Error('simulated D1 cleanup outage');
        if (!mapping) return changed(0);
        this.database.mappings.delete(this.values[0]);
        return changed(1);
      }
      if (!mapping || mapping.state !== 'pending') return changed(0);
      this.database.mappings.delete(this.values[0]);
      return changed(1);
    }
    if (this.sql.startsWith('INSERT INTO ip_bans')) {
      const [scope, ipHash, reason, sourceEntryId, bannedAt] = this.values;
      this.database.bans.set(`${scope}:${ipHash}`, {
        scope,
        ipHash,
        reason,
        sourceEntryId,
        bannedAt,
        revokedAt: null
      });
      return changed(1);
    }
    if (this.sql.startsWith('UPDATE ip_bans SET revoked_at')) {
      const [revokedAt, scope, ipHash] = this.values;
      const ban = this.database.bans.get(`${scope}:${ipHash}`);
      if (!ban || ban.revokedAt) return changed(0);
      ban.revokedAt = revokedAt;
      return changed(1);
    }
    if (this.sql.startsWith('INSERT INTO ip_ban_events')) {
      const isBan = this.sql.includes("'ban'");
      const [scope, ipHash, sourceEntryId, reasonOrCreatedAt, maybeCreatedAt] = this.values;
      this.database.events.push({
        scope,
        ipHash,
        action: isBan ? 'ban' : 'unban',
        sourceEntryId,
        reason: isBan ? reasonOrCreatedAt : '',
        createdAt: isBan ? maybeCreatedAt : reasonOrCreatedAt
      });
      return changed(1);
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`);
  }
}

class FakeD1 {
  constructor() {
    this.mappings = new Map();
    this.bans = new Map();
    this.events = [];
    this.failActivationOnce = false;
    this.failMappingCleanup = false;
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function changed(changes) {
  return { success: true, meta: { changes } };
}

function allowLimiter() {
  return { calls: [], async limit(input) { this.calls.push(input); return { success: true }; } };
}

function createEnv(database = new FakeD1()) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    TURNSTILE_EXPECTED_HOSTNAME: 'cha-amu.github.io',
    APPS_SCRIPT_URL: APP_URL,
    GATEWAY_SHARED_SECRET: 'gateway-shared-secret-00000000000000000000',
    IP_HASH_SECRET: 'ip-hash-secret-0000000000000000000000',
    TURNSTILE_SECRET_KEY: 'turnstile-secret-key',
    STORAGE_SYNC_SECRET: 'storage-sync-secret-00000000000000000000',
    SECURITY_DB: database,
    GUESTBOOK_CREATE_RATE_LIMITER: allowLimiter(),
    GUESTBOOK_DELETE_RATE_LIMITER: allowLimiter(),
    ADMIN_LOGIN_RATE_LIMITER: allowLimiter()
  };
}

function apiRequest(action, payload = {}, headers = {}) {
  return new Request('https://cha-amu-gateway.test/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      Origin: ORIGIN,
      'CF-Connecting-IP': RAW_IP,
      ...headers
    },
    body: JSON.stringify({ action, ...payload })
  });
}

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function fixture(overrides = {}) {
  const appCalls = [];
  const turnstileCalls = [];
  const appHandler = overrides.appHandler || ((body) => {
    if (body.action === 'guestbook.create') {
      return { ok: true, data: { id: body.gatewayEntryId, name: 'ㅇㅁ', message: body.message } };
    }
    return { ok: true, data: {} };
  });
  const turnstileHandler = overrides.turnstileHandler || (() => ({
    success: true,
    hostname: 'cha-amu.github.io',
    action: 'guestbook_create'
  }));
  const fetch = async (url, init) => {
    const target = String(url);
    if (target === APP_URL) {
      const body = JSON.parse(init.body);
      appCalls.push({ body, init });
      const result = await appHandler(body);
      return result instanceof Response ? result : responseJson(result);
    }
    if (target.includes('/turnstile/v0/siteverify')) {
      const form = new URLSearchParams(init.body);
      turnstileCalls.push({ form, init });
      const result = await turnstileHandler(form);
      return result instanceof Response ? result : responseJson(result);
    }
    throw new Error(`Unexpected fetch URL: ${target}`);
  };
  const gateway = createGateway({
    fetch,
    subtle: webcrypto.subtle,
    randomUUID: () => CREATED_ID,
    nowIso: () => '2026-07-11T00:00:00.000Z'
  });
  return { gateway, appCalls, turnstileCalls };
}

test('health is non-sensitive and exact CORS origin is returned', async () => {
  const { gateway } = fixture();
  const env = createEnv();
  const response = await gateway.fetch(new Request('https://cha-amu-gateway.test/health', {
    headers: { Origin: ORIGIN }
  }), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await response.json(), { ok: true, data: { name: 'cha-amu-gateway' } });
});

test('a different browser origin is rejected before any upstream call', async () => {
  const { gateway, appCalls } = fixture();
  const response = await gateway.fetch(apiRequest('post.listPublic', {}, {
    Origin: 'https://attacker.example'
  }), createEnv());

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(appCalls.length, 0);
});

test('guestbook create validates Turnstile and stores only an HMAC IP mapping', async () => {
  const database = new FakeD1();
  const env = createEnv(database);
  const { gateway, appCalls, turnstileCalls } = fixture();
  const response = await gateway.fetch(apiRequest('guestbook.create', {
    name: '',
    message: '안녕하세요',
    deletePassword: 'secret',
    turnstileToken: 'verified-token',
    gatewayEntryId: 'attacker-selected-id',
    gatewaySecret: 'attacker-secret',
    ipHash: 'attacker-ip-hash',
    rawIp: RAW_IP,
    authorization: 'Bearer attacker-token'
  }), env);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.id, CREATED_ID);
  assert.equal(turnstileCalls.length, 1);
  assert.equal(turnstileCalls[0].form.get('remoteip'), RAW_IP);
  assert.equal(appCalls.length, 1);
  assert.equal(appCalls[0].body.gatewayEntryId, CREATED_ID);
  assert.equal(appCalls[0].body.gatewaySecret, env.GATEWAY_SHARED_SECRET);
  assert.equal('turnstileToken' in appCalls[0].body, false);
  assert.equal('ipHash' in appCalls[0].body, false);
  assert.equal('rawIp' in appCalls[0].body, false);
  assert.equal('authorization' in appCalls[0].body, false);
  assert.equal(JSON.stringify(appCalls[0].body).includes(RAW_IP), false);
  assert.equal(database.mappings.get(CREATED_ID).state, 'active');
  assert.equal(database.mappings.get(CREATED_ID).ipHash.length, 64);
  assert.equal(JSON.stringify(Array.from(database.mappings.values())).includes(RAW_IP), false);
});

test('Turnstile hostname and action must both match exactly', async () => {
  const database = new FakeD1();
  const { gateway, appCalls } = fixture({
    turnstileHandler: () => ({ success: true, hostname: 'evil.example', action: 'guestbook_create' })
  });
  const response = await gateway.fetch(apiRequest('guestbook.create', {
    message: 'blocked',
    deletePassword: 'secret',
    turnstileToken: 'token'
  }), createEnv(database));

  assert.equal(response.status, 403);
  assert.equal(appCalls.length, 0);
  assert.equal(database.mappings.size, 0);
});

test('an active manual IP ban blocks create before Turnstile and Apps Script', async () => {
  const database = new FakeD1();
  const env = createEnv(database);
  const { gateway, appCalls, turnstileCalls } = fixture();
  const first = await gateway.fetch(apiRequest('guestbook.create', {
    message: 'first', deletePassword: 'secret', turnstileToken: 'token'
  }), env);
  assert.equal(first.status, 200);
  const ipHash = database.mappings.get(CREATED_ID).ipHash;
  database.bans.set(`guestbook.create:${ipHash}`, { revokedAt: null });

  appCalls.length = 0;
  turnstileCalls.length = 0;
  const blocked = await gateway.fetch(apiRequest('guestbook.create', {
    message: 'second', deletePassword: 'secret', turnstileToken: 'token'
  }), env);
  assert.equal(blocked.status, 403);
  assert.equal(appCalls.length, 0);
  assert.equal(turnstileCalls.length, 0);
});

test('interactive admin login requires admin_login Turnstile action', async () => {
  const { gateway, appCalls, turnstileCalls } = fixture({
    appHandler: () => ({ ok: true, data: { token: 'admin-token' } }),
    turnstileHandler: () => ({ success: true, hostname: 'cha-amu.github.io', action: 'admin_login' })
  });
  const response = await gateway.fetch(apiRequest('admin.login', {
    password: 'password', turnstileToken: 'admin-turnstile-token'
  }), createEnv());

  assert.equal(response.status, 200);
  assert.equal(turnstileCalls.length, 1);
  assert.equal(appCalls[0].body.action, 'admin.login');
  assert.equal('turnstileToken' in appCalls[0].body, false);
});

test('storage sync bearer cannot bypass interactive admin login verification', async () => {
  const env = createEnv();
  const { gateway, appCalls, turnstileCalls } = fixture({
    appHandler: () => ({ ok: true, data: { token: 'admin-token' } })
  });
  const response = await gateway.fetch(apiRequest('admin.login', { password: 'password' }, {
    Origin: '',
    Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
  }), env);

  assert.equal(response.status, 400);
  assert.equal(turnstileCalls.length, 0);
  assert.equal(appCalls.length, 0);
});

test('admin list exposes only ban state and related count, never the IP hash', async () => {
  const database = new FakeD1();
  database.mappings.set('mapped', { ipHash: 'a'.repeat(64), state: 'active' });
  database.mappings.set('related', { ipHash: 'a'.repeat(64), state: 'active' });
  database.bans.set(`guestbook.create:${'a'.repeat(64)}`, { revokedAt: null });
  const { gateway } = fixture({
    appHandler: () => ({
      ok: true,
      data: [
        { id: 'mapped', message: 'mapped entry' },
        { id: 'legacy', message: 'legacy entry' },
        { id: 'related', message: 'related entry' }
      ]
    })
  });
  const response = await gateway.fetch(apiRequest('admin.guestbook.list', { token: 'admin-token' }), createEnv(database));
  const envelope = await response.json();

  assert.deepEqual(envelope.data[0], {
    id: 'mapped',
    message: 'mapped entry',
    ipBanAvailable: true,
    ipBlocked: true,
    relatedEntryCount: 2
  });
  assert.deepEqual(envelope.data[1], {
    id: 'legacy',
    message: 'legacy entry',
    ipBanAvailable: false,
    ipBlocked: false,
    relatedEntryCount: 0
  });
  assert.equal(JSON.stringify(envelope).includes('a'.repeat(64)), false);
});

test('admin can create and revoke an indefinite ban by entryId after session verification', async () => {
  const database = new FakeD1();
  database.mappings.set('entry-for-ban', { ipHash: 'b'.repeat(64), state: 'active' });
  database.mappings.set('same-ip', { ipHash: 'b'.repeat(64), state: 'active' });
  const { gateway, appCalls } = fixture({
    appHandler: (body) => {
      assert.equal(body.action, 'admin.session.verify');
      assert.equal(body.token, 'admin-token');
      return { ok: true, data: { valid: true } };
    }
  });
  const env = createEnv(database);

  const banResponse = await gateway.fetch(apiRequest('admin.guestbook.ip.ban', {
    token: 'admin-token', entryId: 'entry-for-ban', reason: 'spam'
  }), env);
  assert.equal(banResponse.status, 200);
  assert.deepEqual((await banResponse.json()).data, {
    entryId: 'entry-for-ban', ipBlocked: true, relatedEntryCount: 2
  });
  assert.equal(database.bans.get(`guestbook.create:${'b'.repeat(64)}`).revokedAt, null);

  const unbanResponse = await gateway.fetch(apiRequest('admin.guestbook.ip.unban', {
    token: 'admin-token', entryId: 'entry-for-ban'
  }), env);
  assert.equal(unbanResponse.status, 200);
  assert.equal((await unbanResponse.json()).data.ipBlocked, false);
  assert.ok(database.bans.get(`guestbook.create:${'b'.repeat(64)}`).revokedAt);
  assert.equal(database.events.length, 2);
  assert.equal(appCalls.length, 2);
});

test('authenticated admin can list active bans without exposing IP identifiers', async () => {
  const database = new FakeD1();
  const firstHash = 'c'.repeat(64);
  const secondHash = 'd'.repeat(64);
  database.mappings.set('first-source', {
    ipHash: firstHash,
    state: 'active',
    createdAt: '2026-07-10T01:00:00.000Z'
  });
  database.mappings.set('first-related', {
    ipHash: firstHash,
    state: 'active',
    createdAt: '2026-07-10T02:00:00.000Z'
  });
  database.mappings.set('revoked-related', {
    ipHash: secondHash,
    state: 'active',
    createdAt: '2026-07-10T03:00:00.000Z'
  });
  database.bans.set(`guestbook.create:${firstHash}`, {
    scope: 'guestbook.create',
    ipHash: firstHash,
    reason: '반복 광고',
    sourceEntryId: 'first-source',
    bannedAt: '2026-07-11T02:00:00.000Z',
    revokedAt: null
  });
  database.bans.set(`guestbook.create:${secondHash}`, {
    scope: 'guestbook.create',
    ipHash: secondHash,
    reason: '해제됨',
    sourceEntryId: 'revoked-related',
    bannedAt: '2026-07-11T01:00:00.000Z',
    revokedAt: '2026-07-11T03:00:00.000Z'
  });
  const { gateway, appCalls } = fixture({
    appHandler: (body) => {
      assert.equal(body.action, 'admin.session.verify');
      assert.equal(body.token, 'admin-token');
      return { ok: true, data: { valid: true } };
    }
  });

  const response = await gateway.fetch(apiRequest('admin.guestbook.ip.bans.list', {
    token: 'admin-token'
  }), createEnv(database));
  const envelope = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(envelope, {
    ok: true,
    data: {
      bans: [{
        sourceEntryId: 'first-source',
        reason: '반복 광고',
        bannedAt: '2026-07-11T02:00:00.000Z',
        relatedEntryIds: ['first-source', 'first-related'],
        relatedEntryCount: 2
      }]
    }
  });
  assert.equal(appCalls.length, 1);
  assert.equal(JSON.stringify(envelope).includes(firstHash), false);
  assert.equal(JSON.stringify(envelope).includes(secondHash), false);
  assert.equal(JSON.stringify(envelope).includes(RAW_IP), false);
});

test('ban list rejects a missing or invalid admin session before reading D1', async () => {
  const database = new FakeD1();
  database.bans.set(`guestbook.create:${'e'.repeat(64)}`, {
    scope: 'guestbook.create',
    ipHash: 'e'.repeat(64),
    reason: 'must stay private',
    sourceEntryId: 'private-entry',
    bannedAt: '2026-07-11T02:00:00.000Z',
    revokedAt: null
  });
  const { gateway, appCalls } = fixture({
    appHandler: () => ({ ok: false, error: 'expired' })
  });

  const missingToken = await gateway.fetch(
    apiRequest('admin.guestbook.ip.bans.list'),
    createEnv(database)
  );
  const invalidToken = await gateway.fetch(
    apiRequest('admin.guestbook.ip.bans.list', { token: 'expired-token' }),
    createEnv(database)
  );

  assert.equal(missingToken.status, 401);
  assert.equal(invalidToken.status, 401);
  assert.equal(appCalls.length, 1);
  assert.equal(JSON.stringify(await invalidToken.json()).includes('must stay private'), false);
});

test('a listed ban remains revocable by sourceEntryId after all related mappings are gone', async () => {
  const database = new FakeD1();
  const staleHash = 'f'.repeat(64);
  database.bans.set(`guestbook.create:${staleHash}`, {
    scope: 'guestbook.create',
    ipHash: staleHash,
    reason: '오래된 반복 광고',
    sourceEntryId: 'stale-source',
    bannedAt: '2026-07-11T04:00:00.000Z',
    revokedAt: null
  });
  const { gateway, appCalls } = fixture({
    appHandler: (body) => {
      assert.equal(body.action, 'admin.session.verify');
      assert.equal(body.token, 'admin-token');
      return { ok: true, data: { valid: true } };
    }
  });
  const env = createEnv(database);

  const listed = await gateway.fetch(apiRequest('admin.guestbook.ip.bans.list', {
    token: 'admin-token'
  }), env);
  const listedEnvelope = await listed.json();
  assert.deepEqual(listedEnvelope.data.bans, [{
    sourceEntryId: 'stale-source',
    reason: '오래된 반복 광고',
    bannedAt: '2026-07-11T04:00:00.000Z',
    relatedEntryIds: [],
    relatedEntryCount: 0
  }]);

  const unbanned = await gateway.fetch(apiRequest('admin.guestbook.ip.unban', {
    token: 'admin-token', entryId: 'stale-source'
  }), env);
  assert.equal(unbanned.status, 200);
  assert.deepEqual((await unbanned.json()).data, {
    entryId: 'stale-source',
    ipBlocked: false,
    relatedEntryCount: 0
  });
  assert.equal(database.bans.get(`guestbook.create:${staleHash}`).revokedAt, '2026-07-11T00:00:00.000Z');
  assert.equal(appCalls.length, 2);
  assert.equal(JSON.stringify(listedEnvelope).includes(staleHash), false);
});

test('clear upstream rejection removes pending mapping while ambiguous failure keeps it', async () => {
  const rejectedDatabase = new FakeD1();
  const rejectedFixture = fixture({ appHandler: () => ({ ok: false, error: 'rejected' }) });
  const rejected = await rejectedFixture.gateway.fetch(apiRequest('guestbook.create', {
    message: 'rejected', deletePassword: 'secret', turnstileToken: 'token'
  }), createEnv(rejectedDatabase));
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).ok, false);
  assert.equal(rejectedDatabase.mappings.size, 0);

  const pendingDatabase = new FakeD1();
  const failedFixture = fixture({ appHandler: () => { throw new Error('network timeout'); } });
  const failed = await failedFixture.gateway.fetch(apiRequest('guestbook.create', {
    message: 'ambiguous', deletePassword: 'secret', turnstileToken: 'token'
  }), createEnv(pendingDatabase));
  assert.equal(failed.status, 502);
  assert.equal(pendingDatabase.mappings.get(CREATED_ID).state, 'pending');
});

test('post-commit D1 activation failure returns success and admin list reconciles the pending mapping', async () => {
  const database = new FakeD1();
  database.failActivationOnce = true;
  const { gateway } = fixture({
    appHandler: (body) => {
      if (body.action === 'guestbook.create') {
        return { ok: true, data: { id: body.gatewayEntryId, message: body.message } };
      }
      if (body.action === 'admin.guestbook.list') {
        return { ok: true, data: [{ id: CREATED_ID, message: 'committed' }] };
      }
      throw new Error(`Unexpected action: ${body.action}`);
    }
  });
  const env = createEnv(database);
  const created = await gateway.fetch(apiRequest('guestbook.create', {
    message: 'committed', deletePassword: 'secret', turnstileToken: 'token'
  }), env);

  assert.equal(created.status, 200);
  assert.equal((await created.json()).ok, true);
  assert.equal(database.mappings.get(CREATED_ID).state, 'pending');

  const listed = await gateway.fetch(apiRequest('admin.guestbook.list', { token: 'admin-token' }), env);
  assert.equal(listed.status, 200);
  assert.equal(database.mappings.get(CREATED_ID).state, 'active');
  assert.equal((await listed.json()).data[0].ipBanAvailable, true);
});

test('protected actions fail closed when rate limiting is unavailable', async () => {
  const env = createEnv();
  delete env.ADMIN_LOGIN_RATE_LIMITER;
  const { gateway, appCalls, turnstileCalls } = fixture();
  const response = await gateway.fetch(apiRequest('admin.login', {
    password: 'password', turnstileToken: 'token'
  }), env);

  assert.equal(response.status, 503);
  assert.equal(appCalls.length, 0);
  assert.equal(turnstileCalls.length, 0);
});

test('bulk admin actions normalize and forward only their action-specific fields', async () => {
  const { gateway, appCalls } = fixture({
    appHandler: (body) => DELETE_ACTIONS.has(body.action)
      ? { ok: true, data: { deletedIds: body.ids } }
      : { ok: true, data: {} }
  });
  const env = createEnv();
  const cases = [
    {
      action: 'admin.post.bulkStatus',
      payload: { token: ' admin-token ', ids: [' post-1 ', 'post-1', 'post-2'], status: 'draft' },
      expected: { token: 'admin-token', ids: ['post-1', 'post-2'], status: 'draft' }
    },
    {
      action: 'admin.post.bulkDelete',
      payload: { token: 'admin-token', ids: ['post-1'] },
      expected: { token: 'admin-token', ids: ['post-1'] }
    },
    {
      action: 'admin.guestbook.bulkStatus',
      payload: {
        token: 'admin-token',
        ids: ['guestbook-1'],
        status: 'hidden',
        hiddenReason: ' repeated spam '
      },
      expected: {
        token: 'admin-token',
        ids: ['guestbook-1'],
        status: 'hidden',
        hiddenReason: 'repeated spam'
      }
    },
    {
      action: 'admin.guestbook.bulkDelete',
      payload: { token: 'admin-token', ids: ['guestbook-1'] },
      expected: { token: 'admin-token', ids: ['guestbook-1'] }
    },
    {
      action: 'admin.assetOverride.bulkStatus',
      payload: { token: 'admin-token', ids: ['asset-1'], status: 'deleted' },
      expected: { token: 'admin-token', ids: ['asset-1'], status: 'deleted' }
    },
    {
      action: 'admin.assetOverride.delete',
      payload: { token: 'admin-token', ids: ['asset-1'] },
      expected: { token: 'admin-token', ids: ['asset-1'] }
    },
    {
      action: 'admin.thing.delete',
      payload: { token: ' admin-token ', ids: [' thing-1 ', 'thing-1', 'thing-2'] },
      expected: { token: 'admin-token', ids: ['thing-1', 'thing-2'] }
    }
  ];

  for (const testCase of cases) {
    const response = await gateway.fetch(apiRequest(testCase.action, testCase.payload), env);
    assert.equal(response.status, 200, testCase.action);
  }

  assert.equal(appCalls.length, cases.length);
  for (let index = 0; index < cases.length; index += 1) {
    assert.deepEqual(appCalls[index].body, {
      action: cases[index].action,
      ...cases[index].expected,
      gatewaySecret: env.GATEWAY_SHARED_SECRET
    });
  }
});

test('thing public and admin list actions forward only their allowlisted fields', async () => {
  const { gateway, appCalls } = fixture({
    appHandler: (body) => ({ ok: true, data: body.action === 'thing.listPublic' ? [] : [{ id: 'thing-1' }] })
  });
  const env = createEnv();

  const publicResponse = await gateway.fetch(apiRequest('thing.listPublic', {
    token: 'client-selected-token',
    ids: ['client-selected-id'],
    thing: { title: 'client-selected-thing' },
    gatewaySecret: 'client-selected-secret'
  }), env);
  const adminResponse = await gateway.fetch(apiRequest('admin.thing.list', {
    token: 'admin-token',
    ids: ['ignored-id'],
    gatewaySecret: 'client-selected-secret'
  }), env);

  assert.equal(publicResponse.status, 200);
  assert.deepEqual((await publicResponse.json()).data, []);
  assert.equal(adminResponse.status, 200);
  assert.deepEqual((await adminResponse.json()).data, [{ id: 'thing-1' }]);
  assert.deepEqual(appCalls.map((call) => call.body), [
    { action: 'thing.listPublic', gatewaySecret: env.GATEWAY_SHARED_SECRET },
    { action: 'admin.thing.list', token: 'admin-token', gatewaySecret: env.GATEWAY_SHARED_SECRET }
  ]);
});

test('thing save normalizes create and update payloads before forwarding them', async () => {
  const { gateway, appCalls } = fixture({
    appHandler: (body) => ({ ok: true, data: { id: body.thing.id || 'generated-id', ...body.thing } })
  });
  const env = createEnv();
  const createResponse = await gateway.fetch(apiRequest('admin.thing.save', {
    token: ' admin-token ',
    thing: {
      title: ' New thing ',
      url: ' HTTPS://Example.TEST/path with space ',
      imageUrl: '   ',
      status: ' visible ',
      sortOrder: 10
    }
  }), env);
  const updateResponse = await gateway.fetch(apiRequest('admin.thing.save', {
    token: 'admin-token',
    thing: {
      id: ' thing-1 ',
      title: 'Updated thing',
      description: ' keep surrounding spaces ',
      url: 'https://example.test/updated?from=admin',
      imageUrl: ' HTTPS://Images.Example.TEST/preview with space.png ',
      status: 'hidden',
      sortOrder: -5
    }
  }), env);

  assert.equal(createResponse.status, 200);
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(appCalls.map((call) => call.body), [
    {
      action: 'admin.thing.save',
      token: 'admin-token',
      thing: {
        title: 'New thing',
        description: '',
        url: 'https://example.test/path%20with%20space',
        imageUrl: '',
        status: 'visible',
        sortOrder: 10
      },
      gatewaySecret: env.GATEWAY_SHARED_SECRET
    },
    {
      action: 'admin.thing.save',
      token: 'admin-token',
      thing: {
        title: 'Updated thing',
        description: ' keep surrounding spaces ',
        url: 'https://example.test/updated?from=admin',
        imageUrl: 'https://images.example.test/preview%20with%20space.png',
        status: 'hidden',
        id: 'thing-1',
        sortOrder: -5
      },
      gatewaySecret: env.GATEWAY_SHARED_SECRET
    }
  ]);
});

test('thing save rejects unsafe URLs, malformed fields, and unknown request data', async () => {
  const validThing = {
    title: 'Valid thing',
    description: 'description',
    url: 'https://example.test/app',
    imageUrl: '',
    status: 'visible',
    sortOrder: 10
  };
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
    const { gateway, appCalls } = fixture();
    const response = await gateway.fetch(apiRequest('admin.thing.save', payload), createEnv());
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 200));
    assert.equal(appCalls.length, 0);
  }
});

test('storage sync actions require their bearer and forward no human credentials', async () => {
  const env = createEnv();
  const cases = [
    {
      action: 'storage.sync.post.list',
      payload: {},
      expected: {}
    },
    {
      action: 'storage.sync.post.save',
      payload: {
        post: {
          id: ' post-1 ', title: 'Post', excerpt: '', body: 'Body', tags: [' tag '],
          status: ' published ', createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T01:00:00.000Z', publishedAt: '2026-07-12T00:00:00.000Z',
          storagePath: 'posts/2026/post-1.md', bodyUrl: 'https://example.test/post-1.md'
        }
      },
      expected: {
        post: {
          id: 'post-1', title: 'Post', excerpt: '', body: 'Body', tags: ['tag'],
          status: 'published', createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T01:00:00.000Z', publishedAt: '2026-07-12T00:00:00.000Z',
          storagePath: 'posts/2026/post-1.md', bodyUrl: 'https://example.test/post-1.md'
        }
      }
    },
    {
      action: 'storage.sync.postDeletion.list',
      payload: {},
      expected: {}
    },
    {
      action: 'storage.sync.postDeletion.finalize',
      payload: {
        deletions: [
          { id: ' post-1 ', nonce: ' nonce-1 ' },
          { id: 'post-1', nonce: 'nonce-1' },
          { id: 'post-2', nonce: 'nonce-2' }
        ]
      },
      expected: {
        deletions: [
          { id: 'post-1', nonce: 'nonce-1' },
          { id: 'post-2', nonce: 'nonce-2' }
        ]
      }
    },
    {
      action: 'storage.sync.assetOverride.list',
      payload: {},
      expected: {}
    },
    {
      action: 'storage.sync.assetOverride.save',
      payload: {
        override: {
          assetId: ' asset-1 ', displayName: 'Asset', description: '', tags: [' image '],
          sourceUrl: 'https://example.test/asset', status: ' visible ', sortOrder: 4.5
        }
      },
      expected: {
        override: {
          assetId: 'asset-1', displayName: 'Asset', description: '', tags: ['image'],
          sourceUrl: 'https://example.test/asset', status: 'visible', sortOrder: 4.5
        }
      }
    },
    {
      action: 'storage.sync.assetOverride.delete',
      payload: { ids: [' asset-1 ', 'asset-1', 'asset-2'] },
      expected: { ids: ['asset-1', 'asset-2'] }
    }
  ];

  for (const testCase of cases) {
    const { gateway, appCalls } = fixture();
    const missingBearer = await gateway.fetch(apiRequest(testCase.action, testCase.payload, { Origin: '' }), env);
    assert.equal(missingBearer.status, 403, testCase.action);
    assert.equal(appCalls.length, 0, testCase.action);

    const wrongBearer = await gateway.fetch(apiRequest(testCase.action, testCase.payload, {
      Origin: '',
      Authorization: 'Bearer wrong-storage-sync-secret-000000000000000'
    }), env);
    assert.equal(wrongBearer.status, 403, testCase.action);
    assert.equal(appCalls.length, 0, testCase.action);

    const trusted = await gateway.fetch(apiRequest(testCase.action, testCase.payload, {
      Origin: '',
      Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
    }), env);
    assert.equal(trusted.status, 200, testCase.action);
    assert.equal(appCalls.length, 1, testCase.action);
    assert.deepEqual(appCalls[0].body, {
      action: testCase.action,
      ...testCase.expected,
      gatewaySecret: env.GATEWAY_SHARED_SECRET
    });
    const upstream = JSON.stringify(appCalls[0]);
    assert.equal(upstream.includes(env.STORAGE_SYNC_SECRET), false, testCase.action);
    assert.equal(upstream.includes('password'), false, testCase.action);
    assert.equal(upstream.includes('token'), false, testCase.action);
  }
});

test('storage sync fails closed on missing configuration, extra fields, or admin namespace use', async () => {
  for (const configuredSecret of [undefined, 'too-short']) {
    const env = createEnv();
    if (configuredSecret === undefined) delete env.STORAGE_SYNC_SECRET;
    else env.STORAGE_SYNC_SECRET = configuredSecret;
    const { gateway, appCalls } = fixture();
    const response = await gateway.fetch(apiRequest('storage.sync.post.list', {}, {
      Origin: '', Authorization: 'Bearer any-secret-value'
    }), env);
    assert.equal(response.status, 503);
    assert.equal(appCalls.length, 0);
  }

  const env = createEnv();
  for (const payload of [
    { token: 'admin-token' },
    { password: 'admin-password' },
    { gatewaySecret: 'client-selected-secret' }
  ]) {
    const { gateway, appCalls } = fixture();
    const response = await gateway.fetch(apiRequest('storage.sync.post.list', payload, {
      Origin: '', Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
    }), env);
    assert.equal(response.status, 400);
    assert.equal(appCalls.length, 0);
  }

  const { gateway: unknownGateway, appCalls: unknownCalls } = fixture();
  const unknownResponse = await unknownGateway.fetch(apiRequest('storage.sync.guestbook.list', {}, {
    Origin: '', Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
  }), env);
  assert.equal(unknownResponse.status, 400);
  assert.equal(unknownCalls.length, 0);

  const { gateway, appCalls } = fixture();
  const adminResponse = await gateway.fetch(apiRequest('admin.guestbook.ip.ban', {
    entryId: 'entry-1'
  }, {
    Origin: '', Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
  }), env);
  assert.equal(adminResponse.status, 401);
  assert.equal(appCalls.length, 0);
});

test('bulk admin actions reject unknown fields, invalid statuses, and malformed finalize pairs', async () => {
  const invalidCases = [
    ['admin.post.bulkStatus', { token: 'token', ids: ['post'], status: 'deleted' }],
    ['admin.post.bulkStatus', { token: 'token', ids: ['post'], status: 'draft', hiddenReason: 'no' }],
    ['admin.post.bulkDelete', { token: 'token', ids: ['post'], status: 'hidden' }],
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

  for (const [action, payload] of invalidCases) {
    const { gateway, appCalls } = fixture();
    const env = createEnv();
    const response = await gateway.fetch(apiRequest(action, payload), env);
    assert.equal(response.status, 400, action);
    assert.equal(appCalls.length, 0, action);
  }
});

test('bulk requests allow at most 100 unique ids after deduplication', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `id-${index}`);
  const { gateway, appCalls } = fixture({
    appHandler: (body) => ({ ok: true, data: { deletedIds: body.ids } })
  });
  const env = createEnv();

  const accepted = await gateway.fetch(apiRequest('admin.post.bulkDelete', {
    token: 'token', ids: [...ids, ...ids]
  }), env);
  assert.equal(accepted.status, 200);
  assert.deepEqual(appCalls[0].body.ids, ids);

  const rejected = await gateway.fetch(apiRequest('admin.post.bulkDelete', {
    token: 'token', ids: [...ids, 'id-100']
  }), env);
  assert.equal(rejected.status, 400);
  assert.equal(appCalls.length, 1);

  const rejectedFinalize = await gateway.fetch(apiRequest('storage.sync.postDeletion.finalize', {
    deletions: [...ids, 'id-100'].map((id) => ({ id, nonce: `nonce-${id}` }))
  }, {
    Origin: '',
    Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
  }), env);
  assert.equal(rejectedFinalize.status, 400);
  assert.equal(appCalls.length, 1);
});

test('guestbook bulk delete cleans only upstream-confirmed mappings after commit', async () => {
  const database = new FakeD1();
  database.mappings.set('deleted-entry', {
    ipHash: 'a'.repeat(64), state: 'active', createdAt: '2026-07-10T00:00:00.000Z'
  });
  database.mappings.set('already-missing-entry', {
    ipHash: 'b'.repeat(64), state: 'pending', createdAt: '2026-07-10T00:00:00.000Z'
  });
  database.mappings.set('unconfirmed-entry', {
    ipHash: 'c'.repeat(64), state: 'active', createdAt: '2026-07-10T00:00:00.000Z'
  });
  database.bans.set(`guestbook.create:${'a'.repeat(64)}`, {
    scope: 'guestbook.create', ipHash: 'a'.repeat(64), sourceEntryId: 'deleted-entry', revokedAt: null
  });
  database.events.push({ action: 'ban', sourceEntryId: 'deleted-entry' });
  const bansBefore = structuredClone(Array.from(database.bans.entries()));
  const eventsBefore = structuredClone(database.events);
  const { gateway } = fixture({
    appHandler: (body) => {
      assert.equal(body.action, 'admin.guestbook.bulkDelete');
      assert.equal(database.mappings.has('deleted-entry'), true);
      assert.equal(database.mappings.has('already-missing-entry'), true);
      return {
        ok: true,
        data: {
          deletedIds: ['deleted-entry'],
          alreadyMissingIds: ['already-missing-entry']
        }
      };
    }
  });

  const response = await gateway.fetch(apiRequest('admin.guestbook.bulkDelete', {
    token: 'admin-token',
    ids: ['deleted-entry', 'already-missing-entry', 'unconfirmed-entry']
  }), createEnv(database));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    deletedIds: ['deleted-entry'],
    alreadyMissingIds: ['already-missing-entry']
  });
  assert.equal(database.mappings.has('deleted-entry'), false);
  assert.equal(database.mappings.has('already-missing-entry'), false);
  assert.equal(database.mappings.has('unconfirmed-entry'), true);
  assert.deepEqual(Array.from(database.bans.entries()), bansBefore);
  assert.deepEqual(database.events, eventsBefore);
});

test('guestbook mapping cleanup retries through admin reconciliation after a transient D1 failure', async () => {
  const database = new FakeD1();
  database.mappings.set('committed-entry', { ipHash: 'd'.repeat(64), state: 'active' });
  database.bans.set(`guestbook.create:${'d'.repeat(64)}`, {
    scope: 'guestbook.create', ipHash: 'd'.repeat(64), sourceEntryId: 'committed-entry', revokedAt: null
  });
  database.failMappingCleanup = true;
  const { gateway } = fixture({
    appHandler: (body) => body.action === 'admin.guestbook.bulkDelete'
      ? { ok: true, data: { deletedIds: ['committed-entry'] } }
      : { ok: true, data: [] }
  });
  const env = createEnv(database);

  const response = await gateway.fetch(apiRequest('admin.guestbook.bulkDelete', {
    token: 'admin-token', ids: ['committed-entry']
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { deletedIds: ['committed-entry'] });
  assert.equal(database.mappings.has('committed-entry'), true);

  database.failMappingCleanup = false;
  const listed = await gateway.fetch(apiRequest('admin.guestbook.list', { token: 'admin-token' }), env);
  assert.equal(listed.status, 200);
  assert.equal(database.mappings.has('committed-entry'), false);
  assert.equal(database.bans.has(`guestbook.create:${'d'.repeat(64)}`), true);
});

test('delete responses cannot confirm ids outside the requested set', async () => {
  for (const action of DELETE_ACTIONS) {
    const database = new FakeD1();
    database.mappings.set('requested', { ipHash: 'e'.repeat(64), state: 'active' });
    const { gateway } = fixture({
      appHandler: () => ({ ok: true, data: { deletedIds: ['not-requested'] } })
    });

    const response = await gateway.fetch(apiRequest(action, {
      token: 'admin-token', ids: ['requested']
    }), createEnv(database));

    assert.equal(response.status, 502, action);
    assert.equal(database.mappings.has('requested'), true, action);
  }
});

test('guestbook mapping cleanup does not run when upstream rejects the delete', async () => {
  const database = new FakeD1();
  database.mappings.set('rejected-entry', { ipHash: 'f'.repeat(64), state: 'active' });
  const { gateway } = fixture({ appHandler: () => ({ ok: false, error: 'rejected' }) });

  const response = await gateway.fetch(apiRequest('admin.guestbook.bulkDelete', {
    token: 'admin-token', ids: ['rejected-entry']
  }), createEnv(database));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, false);
  assert.equal(database.mappings.has('rejected-entry'), true);
});
