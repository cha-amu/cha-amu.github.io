import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import { createGateway } from '../worker/src/index.js';

const APP_URL = 'https://apps-script.test/exec';
const ORIGIN = 'https://cha-amu.github.io';
const RAW_IP = '203.0.113.42';
const CREATED_ID = '11111111-1111-4111-8111-111111111111';

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
    if (this.sql.includes('SELECT COUNT(*) AS count')) {
      const [ipHash] = this.values;
      const count = Array.from(this.database.mappings.values())
        .filter((mapping) => mapping.ipHash === ipHash && mapping.state === 'active').length;
      return { count };
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async all() {
    if (this.sql.includes("WHERE state = 'pending'") && this.sql.startsWith('SELECT entry_id')) {
      return {
        success: true,
        results: Array.from(this.database.mappings.entries())
          .filter(([, mapping]) => mapping.state === 'pending')
          .slice(0, 100)
          .map(([entryId]) => ({ entry_id: entryId }))
      };
    }
    if (!this.sql.includes('FROM guestbook_entry_ips m')) {
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

test('trusted storage sync can log in without forwarding its bearer secret', async () => {
  const env = createEnv();
  const { gateway, appCalls, turnstileCalls } = fixture({
    appHandler: () => ({ ok: true, data: { token: 'admin-token' } })
  });
  const response = await gateway.fetch(apiRequest('admin.login', { password: 'password' }, {
    Origin: '',
    Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}`
  }), env);

  assert.equal(response.status, 200);
  assert.equal(turnstileCalls.length, 0);
  assert.equal(appCalls.length, 1);
  assert.equal(JSON.stringify(appCalls[0]).includes(env.STORAGE_SYNC_SECRET), false);
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
        { id: 'legacy', message: 'legacy entry' }
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
