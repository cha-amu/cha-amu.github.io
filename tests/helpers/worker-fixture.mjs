import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID, webcrypto } from 'node:crypto';
import { createGateway } from '../../worker/src/index.js';
import { CONTENT_TABLES, storedRecord } from '../../worker/src/content-schema.js';
import { createD1 } from './d1.mjs';

export const ORIGIN = 'https://cha-amu.github.io';
export const RAW_IP = '203.0.113.7';
export const ADMIN_PASSWORD = '관리자-password🔐';
export const GUESTBOOK_PEPPER = 'guestbook-test-pepper-00000000000000000000000000000000';
export const INITIAL_TIME = '2026-10-07T00:00:00.000Z';
export const allowLimiter = () => ({ calls: [], async limit(input) { this.calls.push(input); return { success: true }; } });
export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const ipHash = (env, ip = RAW_IP) => createHmac('sha256', env.IP_HASH_SECRET).update(`v1\0ip\0${ip}`).digest('hex');

export function apiRequest(action, payload = {}, headers = {}) {
  return new Request('https://gateway.test/api', {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', Origin: ORIGIN, 'CF-Connecting-IP': RAW_IP, ...headers },
    body: JSON.stringify({ action, ...payload })
  });
}

export async function fixture(t, options = {}) {
  const { db, mf } = await createD1(t);
  const env = {
    ALLOWED_ORIGIN: ORIGIN, TURNSTILE_EXPECTED_HOSTNAME: 'cha-amu.github.io',
    IP_HASH_SECRET: 'ip-hash-secret-0000000000000000000000', TURNSTILE_SECRET_KEY: 'turnstile-secret-key',
    STORAGE_SYNC_SECRET: 'storage-sync-secret-00000000000000000000',
    GUESTBOOK_SERVER_PEPPER: GUESTBOOK_PEPPER,
    ADMIN_PASSWORD_PEPPER: 'admin-password-pepper-0000000000000000000000000000',
    ADMIN_SESSION_SECRET: 'admin-session-secret-000000000000000000000000000000',
    ADMIN_SESSION_TTL_MS: '600000', GUESTBOOK_PASSWORD_ITERATIONS: '1',
    SECURITY_DB: db,
    GUESTBOOK_CREATE_RATE_LIMITER: allowLimiter(), GUESTBOOK_DELETE_RATE_LIMITER: allowLimiter(), ADMIN_LOGIN_RATE_LIMITER: allowLimiter()
  };
  env.ADMIN_PASSWORD_HASH = sha(ADMIN_PASSWORD + env.ADMIN_PASSWORD_PEPPER);
  Object.assign(env, options.env);
  let now = Date.parse(INITIAL_TIME);
  const fetchCalls = [];
  const deps = {
    subtle: webcrypto.subtle,
    randomUUID: options.randomUUID || randomUUID,
    nowIso: () => new Date(now).toISOString(),
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify', 'Only Turnstile may use fetch');
      const form = new URLSearchParams(init.body);
      fetchCalls.push({ url, init, form });
      const result = options.turnstile ? await options.turnstile(form) : {
        success: true, hostname: env.TURNSTILE_EXPECTED_HOSTNAME,
        action: form.get('response') === 'admin-turnstile' ? 'admin_login' : 'guestbook_create'
      };
      return result instanceof Response ? result : Response.json(result);
    }
  };
  const gateway = createGateway(deps);
  // Independently sign test sessions; login/session tests use the public login action.
  const session = (exp = now + 600000) => {
    const payload = Buffer.from(JSON.stringify({ exp, nonce: randomUUID() })).toString('base64url');
    return `${payload}.${createHmac('sha256', env.ADMIN_SESSION_SECRET).update(payload).digest('hex')}`;
  };
  const f = {
    db, mf, env, deps, gateway, fetchCalls, session,
    advance(ms) { now += ms; }, now() { return now; },
    async request(action, payload = {}, headers = {}) {
      const response = await gateway.fetch(apiRequest(action, payload, headers), env);
      return { response, status: response.status, ...await response.json() };
    },
    async call(action, payload = {}, headers = {}) {
      const result = await this.request(action, payload, headers);
      assert.equal(result.status, 200, `${action}: ${JSON.stringify(result)}`);
      assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`);
      return result.data;
    },
    admin(action, payload = {}) { return this.call(action, { token: session(), ...payload }); },
    storage(action, payload = {}) { return this.call(action, payload, { Origin: '', Authorization: `Bearer ${env.STORAGE_SYNC_SECRET}` }); },
    create(payload = {}) {
      return this.call('guestbook.create', {
        name: '', message: '안녕하세요', deletePassword: 'delete-password', clientId: randomUUID(), website: '', turnstileToken: 'guest-turnstile', ...payload
      });
    },
    async seed(name, rows) {
      const definition = CONTENT_TABLES[name];
      if (!rows.length) return;
      await db.batch(rows.map((row) => {
        const { columns, values } = storedRecord(definition, row);
        return db.prepare(`INSERT INTO ${definition.table} (${columns.join(',')}) VALUES (${values.map(() => '?').join(',')})`).bind(...values);
      }));
    },
    async mapping(id, hash = ipHash(env), state = 'active', date = INITIAL_TIME) {
      await db.prepare("INSERT INTO guestbook_entry_ips VALUES (?, ?, 'v1', ?, ?, ?)").bind(id, hash, state, date, date).run();
    },
    async rows(table) { return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results; }
  };
  return f;
}
