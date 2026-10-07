import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createD1 } from './helpers/d1.mjs';

// Exercise the actual module graph in workerd too, including its WebCrypto and
// rate-limit bindings. Other tests inject only clock/fetch at the gateway boundary
// while using the same real Miniflare D1 binding.
test('the deployed Worker module graph runs in workerd: login, public reads, storage, create and both imported password algorithms', async (t) => {
  const pepper = 'guestbook-runtime-pepper-000000000000000000000000';
  const password = '관리자🔐';
  const adminPepper = 'admin-runtime-pepper-000000000000000000000000000';
  const storageSecret = 'storage-runtime-secret-00000000000000000000000000';
  const calls = [];
  const { db, mf } = await createD1(t, {
    script: undefined, scriptPath: fileURLToPath(new URL('../worker/src/index.js', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    bindings: {
      ALLOWED_ORIGIN: 'https://cha-amu.github.io', TURNSTILE_EXPECTED_HOSTNAME: 'cha-amu.github.io',
      TURNSTILE_SECRET_KEY: 'runtime-turnstile-secret', IP_HASH_SECRET: 'runtime-ip-hash-secret-000000000000000000000000',
      STORAGE_SYNC_SECRET: storageSecret, GUESTBOOK_SERVER_PEPPER: pepper,
      ADMIN_PASSWORD_HASH: createHash('sha256').update(password + adminPepper).digest('hex'),
      ADMIN_PASSWORD_PEPPER: adminPepper, ADMIN_SESSION_SECRET: 'runtime-admin-session-secret-00000000000000000000000',
      ADMIN_SESSION_TTL_MS: '600000', GUESTBOOK_PASSWORD_ITERATIONS: '1'
    },
    ratelimits: {
      GUESTBOOK_CREATE_RATE_LIMITER: { namespace_id: '1101', simple: { limit: 5, period: 60 } },
      GUESTBOOK_DELETE_RATE_LIMITER: { namespace_id: '1102', simple: { limit: 20, period: 60 } },
      ADMIN_LOGIN_RATE_LIMITER: { namespace_id: '1103', simple: { limit: 10, period: 60 } }
    },
    outboundService: async (request) => {
      assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      const form = new URLSearchParams(await request.text()); calls.push(form);
      return new Response(JSON.stringify({ success: true, hostname: 'cha-amu.github.io', action: form.get('response') === 'login' ? 'admin_login' : 'guestbook_create' }), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  const call = async (action, body = {}, headers = {}) => {
    const response = await mf.dispatchFetch('https://gateway.test/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://cha-amu.github.io', 'CF-Connecting-IP': '203.0.113.7', ...headers },
      body: JSON.stringify({ action, ...body })
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  };
  const session = await call('admin.login', { password, turnstileToken: 'login' });
  assert.deepEqual(await call('admin.session.verify', { token: session.token }), { valid: true });
  const refreshed = await call('admin.session.refresh', { token: session.token });
  assert.notEqual(refreshed.token, session.token);
  const asset = await call('storage.sync.assetOverride.save', { override: { assetId: 'storage', status: 'visible', displayName: '한국어', description: '설명', tags: ['태그'] } }, { Authorization: `Bearer ${storageSecret}` });
  assert.equal(asset.displayName, '한국어'); assert.deepEqual((await call('assetOverride.listPublic'))[0].tags, ['태그']);
  const created = await call('guestbook.create', { message: 'hello', name: '', deletePassword: 'pw', turnstileToken: 'guest' });
  assert.equal(created.name, 'ㅇㅁ');
  const mapping = await db.prepare('SELECT * FROM guestbook_entry_ips WHERE entry_id = ?').bind(created.id).first();
  assert.equal(mapping.state, 'active');
  await call('guestbook.hideByPassword', { id: created.id, deletePassword: 'pw' });
  const salt = '실제 UTF-8 솔트🔑';
  const deletePassword = '삭제-password😀';
  const hash = pbkdf2Sync(deletePassword + pepper, salt, 50000, 32, 'sha256').toString('hex');
  await db.prepare("INSERT INTO guestbook_entries (id, passwordSalt, passwordHash, passwordHashAlgorithm, passwordHashIterations, status) VALUES ('pbkdf', ?, ?, 'PBKDF2-HMAC-SHA256+pepper', 50000, 'visible')").bind(salt, hash).run();
  assert.deepEqual(await call('guestbook.hideByPassword', { id: 'pbkdf', deletePassword }), { id: 'pbkdf' });
  assert.equal((await db.prepare("SELECT status FROM guestbook_entries WHERE id = 'pbkdf'").first()).status, 'hidden');
  assert.equal((await call('guestbook.listPublic')).length, 0);
  assert.equal((await call('admin.guestbook.list', { token: session.token }))[0].ipBanAvailable, true);
  assert.equal(calls.length, 2, 'all other actions stay entirely inside the Worker/D1');
});
