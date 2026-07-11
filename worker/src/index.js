const PUBLIC_ACTIONS = new Set([
  'post.listPublic',
  'guestbook.listPublic',
  'assetOverride.listPublic'
]);

const PROXIED_ACTIONS = new Set([
  ...PUBLIC_ACTIONS,
  'guestbook.hideByPassword',
  'admin.session.refresh',
  'admin.post.list',
  'admin.post.save',
  'admin.post.syncFromStorage',
  'admin.guestbook.hide',
  'admin.guestbook.restore',
  'admin.assetOverride.list',
  'admin.assetOverride.save'
]);

const UPSTREAM_FIELDS = new Map([
  ['post.listPublic', []],
  ['guestbook.listPublic', []],
  ['assetOverride.listPublic', []],
  ['guestbook.create', ['name', 'message', 'deletePassword', 'clientId', 'website']],
  ['guestbook.hideByPassword', ['id', 'deletePassword', 'clientId']],
  ['admin.login', ['password']],
  ['admin.session.verify', ['token']],
  ['admin.session.refresh', ['token']],
  ['admin.post.list', ['token']],
  ['admin.post.save', ['token', 'post']],
  ['admin.post.syncFromStorage', ['token', 'post']],
  ['admin.guestbook.list', ['token']],
  ['admin.guestbook.hide', ['token', 'id', 'hiddenReason']],
  ['admin.guestbook.restore', ['token', 'id']],
  ['admin.assetOverride.list', ['token']],
  ['admin.assetOverride.save', ['token', 'override']]
]);

const IP_BAN_SCOPE = 'guestbook.create';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_BODY_BYTES = 64 * 1024;
const encoder = new TextEncoder();

class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function addCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Vary', mergeVary(headers.get('Vary'), 'Origin'));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function mergeVary(current, value) {
  const values = new Set(String(current || '').split(',').map((item) => item.trim()).filter(Boolean));
  values.add(value);
  return Array.from(values).join(', ');
}

function assertAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  requireString(env.ALLOWED_ORIGIN, 'ALLOWED_ORIGIN');
  if (origin !== env.ALLOWED_ORIGIN) {
    throw new GatewayError(403, '허용되지 않은 요청 출처입니다.');
  }
}

function requireString(value, name, minLength = 1) {
  if (typeof value !== 'string' || value.length < minLength) {
    throw new GatewayError(503, `${name} 설정이 없습니다.`);
  }
  return value;
}

function requireDatabase(env) {
  if (!env.SECURITY_DB || typeof env.SECURITY_DB.prepare !== 'function') {
    throw new GatewayError(503, '보안 데이터베이스를 사용할 수 없습니다.');
  }
  return env.SECURITY_DB;
}

function requireRateLimiter(env, name) {
  const limiter = env[name];
  if (!limiter || typeof limiter.limit !== 'function') {
    throw new GatewayError(503, '요청 제한 서비스를 사용할 수 없습니다.');
  }
  return limiter;
}

async function enforceRateLimit(env, bindingName, key) {
  const result = await requireRateLimiter(env, bindingName).limit({ key });
  if (!result || result.success !== true) {
    throw new GatewayError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
  }
}

async function parseBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw new GatewayError(413, '요청 본문이 너무 큽니다.');
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('application/json') && !contentType.startsWith('text/plain')) {
    throw new GatewayError(415, '지원하지 않는 요청 형식입니다.');
  }

  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) {
    throw new GatewayError(413, '요청 본문이 너무 큽니다.');
  }

  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch (_) {
    throw new GatewayError(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }
}

function normalizeClientIp(request) {
  const raw = request.headers.get('CF-Connecting-IP');
  if (!raw || raw.includes(',') || raw.includes('%')) {
    throw new GatewayError(403, '클라이언트 주소를 확인할 수 없습니다.');
  }

  const value = raw.trim().toLowerCase();
  const parts = value.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const numbers = parts.map(Number);
    if (numbers.every((part) => part >= 0 && part <= 255)) return numbers.join('.');
  }

  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
  } catch (_) {
    // Fall through to the generic client-address error.
  }
  throw new GatewayError(403, '클라이언트 주소를 확인할 수 없습니다.');
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashClientIp(request, env, subtle) {
  const secret = requireString(env.IP_HASH_SECRET, 'IP_HASH_SECRET', 32);
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(`v1\0ip\0${normalizeClientIp(request)}`));
  return bytesToHex(signature);
}

function constantTimeEqual(left, right) {
  const leftBytes = encoder.encode(String(left || ''));
  const rightBytes = encoder.encode(String(right || ''));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function isTrustedService(request, env) {
  const configured = env.STORAGE_SYNC_SECRET;
  if (typeof configured !== 'string' || configured.length < 32) return false;
  const authorization = request.headers.get('Authorization') || '';
  return constantTimeEqual(authorization, `Bearer ${configured}`);
}

async function verifyTurnstile(body, request, env, expectedAction, fetchImpl) {
  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : '';
  if (!token || token.length > 2048) {
    throw new GatewayError(400, '사람 확인을 완료해 주세요.');
  }

  const secret = requireString(env.TURNSTILE_SECRET_KEY, 'TURNSTILE_SECRET_KEY', 10);
  const expectedHostname = requireString(env.TURNSTILE_EXPECTED_HOSTNAME, 'TURNSTILE_EXPECTED_HOSTNAME');
  const form = new URLSearchParams({
    secret,
    response: token,
    remoteip: normalizeClientIp(request)
  });

  let response;
  let result;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    if (!response.ok) throw new Error('turnstile unavailable');
    result = await response.json();
  } catch (_) {
    throw new GatewayError(503, '사람 확인 서비스를 사용할 수 없습니다.');
  }

  if (
    result?.success !== true ||
    result.hostname !== expectedHostname ||
    result.action !== expectedAction
  ) {
    throw new GatewayError(403, '사람 확인에 실패했습니다. 다시 시도하세요.');
  }
}

function upstreamPayload(action, body, env, overrides = {}) {
  const fields = UPSTREAM_FIELDS.get(action);
  if (!fields) throw new GatewayError(500, '원본 API 요청 계약이 없습니다.');
  const payload = { action };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = body[field];
  }
  Object.assign(payload, overrides);
  payload.gatewaySecret = requireString(env.GATEWAY_SHARED_SECRET, 'GATEWAY_SHARED_SECRET', 32);
  return payload;
}

async function callUpstream(action, body, env, fetchImpl, overrides) {
  const url = requireString(env.APPS_SCRIPT_URL, 'APPS_SCRIPT_URL');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(upstreamPayload(action, body, env, overrides))
    });
  } catch (_) {
    throw new GatewayError(502, '원본 API에 연결할 수 없습니다.');
  }

  if (!response.ok) {
    throw new GatewayError(502, '원본 API가 요청을 처리하지 못했습니다.');
  }

  let envelope;
  try {
    envelope = JSON.parse(await response.text());
  } catch (_) {
    throw new GatewayError(502, '원본 API 응답 형식이 올바르지 않습니다.');
  }
  if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    throw new GatewayError(502, '원본 API 응답 형식이 올바르지 않습니다.');
  }
  return envelope;
}

async function isIpBanned(db, ipHash) {
  const row = await db.prepare(
    `SELECT 1 AS banned
       FROM ip_bans
      WHERE scope = ? AND ip_hash = ? AND revoked_at IS NULL
      LIMIT 1`
  ).bind(IP_BAN_SCOPE, ipHash).first();
  return Boolean(row);
}

async function insertPendingMapping(db, entryId, ipHash, now) {
  await db.prepare(
    `INSERT INTO guestbook_entry_ips
      (entry_id, ip_hash, hash_version, state, created_at, updated_at)
     VALUES (?, ?, 'v1', 'pending', ?, ?)`
  ).bind(entryId, ipHash, now, now).run();
}

async function tryActivateMapping(db, entryId, now) {
  try {
    const result = await db.prepare(
      `UPDATE guestbook_entry_ips
          SET state = 'active', updated_at = ?
        WHERE entry_id = ? AND state = 'pending'`
    ).bind(now, entryId).run();
    return Boolean(result?.success && Number(result.meta?.changes || 0) === 1);
  } catch (_) {
    return false;
  }
}

async function removePendingMapping(db, entryId) {
  await db.prepare(
    `DELETE FROM guestbook_entry_ips WHERE entry_id = ? AND state = 'pending'`
  ).bind(entryId).run();
}

async function handleGuestbookCreate(body, request, env, dependencies) {
  const db = requireDatabase(env);
  const ipHash = await hashClientIp(request, env, dependencies.subtle);
  await enforceRateLimit(env, 'GUESTBOOK_CREATE_RATE_LIMITER', ipHash);
  if (await isIpBanned(db, ipHash)) {
    throw new GatewayError(403, '이 주소에서는 방명록을 작성할 수 없습니다.');
  }
  await verifyTurnstile(body, request, env, 'guestbook_create', dependencies.fetch);

  const entryId = dependencies.randomUUID();
  const createdAt = dependencies.nowIso();
  await insertPendingMapping(db, entryId, ipHash, createdAt);

  let envelope;
  try {
    envelope = await callUpstream('guestbook.create', body, env, dependencies.fetch, {
      gatewayEntryId: entryId
    });
  } catch (error) {
    // A network/format failure is ambiguous: leave the pending row for later reconciliation.
    throw error;
  }

  if (!envelope.ok) {
    await removePendingMapping(db, entryId);
    return envelope;
  }
  if (!envelope.data || String(envelope.data.id) !== entryId) {
    throw new GatewayError(502, '원본 API가 생성 식별자를 확인하지 못했습니다.');
  }

  // Apps Script has already committed the row. Return success even if this best-effort
  // activation fails so a browser retry cannot create a duplicate entry. Admin list
  // reconciliation promotes the durable pending mapping later.
  await tryActivateMapping(db, entryId, dependencies.nowIso());
  return envelope;
}

async function handleGuestbookDelete(body, request, env, dependencies) {
  const ipHash = await hashClientIp(request, env, dependencies.subtle);
  const entryId = typeof body.id === 'string' ? body.id.slice(0, 128) : '';
  await enforceRateLimit(env, 'GUESTBOOK_DELETE_RATE_LIMITER', `${ipHash}:${entryId}`);
  return callUpstream('guestbook.hideByPassword', body, env, dependencies.fetch);
}

async function handleAdminLogin(body, request, env, dependencies) {
  const ipHash = await hashClientIp(request, env, dependencies.subtle);
  await enforceRateLimit(env, 'ADMIN_LOGIN_RATE_LIMITER', ipHash);
  if (!isTrustedService(request, env)) {
    await verifyTurnstile(body, request, env, 'admin_login', dependencies.fetch);
  }
  return callUpstream('admin.login', body, env, dependencies.fetch);
}

async function requireAdminSession(body, env, fetchImpl) {
  if (typeof body.token !== 'string' || !body.token) {
    throw new GatewayError(401, '관리자 로그인이 필요합니다.');
  }
  const envelope = await callUpstream('admin.session.verify', { token: body.token }, env, fetchImpl);
  if (!envelope.ok) throw new GatewayError(401, '관리자 로그인이 만료되었습니다.');
}

async function listIpSecurity(db) {
  const result = await db.prepare(
    `SELECT m.entry_id,
            CASE WHEN b.ip_hash IS NULL THEN 0 ELSE 1 END AS ip_blocked,
            (SELECT COUNT(*)
               FROM guestbook_entry_ips related
              WHERE related.ip_hash = m.ip_hash AND related.state = 'active') AS related_entry_count
       FROM guestbook_entry_ips m
       LEFT JOIN ip_bans b
         ON b.scope = ? AND b.ip_hash = m.ip_hash AND b.revoked_at IS NULL
      WHERE m.state = 'active'`
  ).bind(IP_BAN_SCOPE).all();
  return new Map((result?.results || []).map((row) => [String(row.entry_id), row]));
}

async function reconcilePendingMappings(db, entries, now) {
  const pending = await db.prepare(
    `SELECT entry_id
       FROM guestbook_entry_ips
      WHERE state = 'pending'
      ORDER BY created_at
      LIMIT 100`
  ).all();
  const upstreamIds = new Set(entries.map((entry) => String(entry.id)));
  const statements = (pending?.results || [])
    .map((row) => String(row.entry_id))
    .filter((entryId) => upstreamIds.has(entryId))
    .map((entryId) => db.prepare(
      `UPDATE guestbook_entry_ips
          SET state = 'active', updated_at = ?
        WHERE entry_id = ? AND state = 'pending'`
    ).bind(now, entryId));
  if (statements.length) await db.batch(statements);
}

async function handleAdminGuestbookList(body, env, dependencies) {
  const envelope = await callUpstream('admin.guestbook.list', body, env, dependencies.fetch);
  if (!envelope.ok || !Array.isArray(envelope.data)) return envelope;

  const db = requireDatabase(env);
  await reconcilePendingMappings(db, envelope.data, dependencies.nowIso());
  const security = await listIpSecurity(db);
  return {
    ...envelope,
    data: envelope.data.map((entry) => {
      const row = security.get(String(entry.id));
      return {
        ...entry,
        ipBanAvailable: Boolean(row),
        ipBlocked: Boolean(row && Number(row.ip_blocked)),
        relatedEntryCount: row ? Number(row.related_entry_count || 0) : 0
      };
    })
  };
}

async function getActiveMapping(db, entryId) {
  return db.prepare(
    `SELECT ip_hash FROM guestbook_entry_ips WHERE entry_id = ? AND state = 'active' LIMIT 1`
  ).bind(entryId).first();
}

async function countRelatedEntries(db, ipHash) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM guestbook_entry_ips
      WHERE ip_hash = ? AND state = 'active'`
  ).bind(ipHash).first();
  return Number(row?.count || 0);
}

async function handleIpBan(body, env, dependencies, blocked) {
  await requireAdminSession(body, env, dependencies.fetch);
  const db = requireDatabase(env);
  const requestedEntryId = body.entryId ?? body.id;
  const entryId = typeof requestedEntryId === 'string' ? requestedEntryId.trim() : '';
  if (!entryId) throw new GatewayError(400, '방명록 글 식별자가 필요합니다.');
  const mapping = await getActiveMapping(db, entryId);
  if (!mapping) throw new GatewayError(404, '이 글에는 IP 정보가 없습니다.');

  const now = dependencies.nowIso();
  if (blocked) {
    const reason = String(body.reason || '관리자 수동 차단').trim().slice(0, 200) || '관리자 수동 차단';
    await db.batch([
      db.prepare(
        `INSERT INTO ip_bans
          (scope, ip_hash, reason, source_entry_id, banned_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(scope, ip_hash) DO UPDATE SET
           reason = excluded.reason,
           source_entry_id = excluded.source_entry_id,
           banned_at = excluded.banned_at,
           revoked_at = NULL`
      ).bind(IP_BAN_SCOPE, mapping.ip_hash, reason, entryId, now),
      db.prepare(
        `INSERT INTO ip_ban_events
          (scope, ip_hash, action, source_entry_id, reason, created_at)
         VALUES (?, ?, 'ban', ?, ?, ?)`
      ).bind(IP_BAN_SCOPE, mapping.ip_hash, entryId, reason, now)
    ]);
  } else {
    await db.batch([
      db.prepare(
        `UPDATE ip_bans SET revoked_at = ?
          WHERE scope = ? AND ip_hash = ? AND revoked_at IS NULL`
      ).bind(now, IP_BAN_SCOPE, mapping.ip_hash),
      db.prepare(
        `INSERT INTO ip_ban_events
          (scope, ip_hash, action, source_entry_id, reason, created_at)
         VALUES (?, ?, 'unban', ?, '', ?)`
      ).bind(IP_BAN_SCOPE, mapping.ip_hash, entryId, now)
    ]);
  }

  return {
    ok: true,
    data: {
      entryId,
      ipBlocked: blocked,
      relatedEntryCount: await countRelatedEntries(db, mapping.ip_hash)
    }
  };
}

async function routeApi(body, request, env, dependencies) {
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) throw new GatewayError(400, 'action이 필요합니다.');

  if (action === 'guestbook.create') {
    return handleGuestbookCreate(body, request, env, dependencies);
  }
  if (action === 'guestbook.hideByPassword') {
    return handleGuestbookDelete(body, request, env, dependencies);
  }
  if (action === 'admin.login') {
    return handleAdminLogin(body, request, env, dependencies);
  }
  if (action === 'admin.guestbook.list') {
    return handleAdminGuestbookList(body, env, dependencies);
  }
  if (action === 'admin.guestbook.ip.ban') {
    return handleIpBan(body, env, dependencies, true);
  }
  if (action === 'admin.guestbook.ip.unban') {
    return handleIpBan(body, env, dependencies, false);
  }
  if (PROXIED_ACTIONS.has(action)) {
    return callUpstream(action, body, env, dependencies.fetch);
  }
  throw new GatewayError(400, '지원하지 않는 action입니다.');
}

export function createGateway(overrides = {}) {
  const dependencies = {
    fetch: overrides.fetch || globalThis.fetch.bind(globalThis),
    subtle: overrides.subtle || globalThis.crypto.subtle,
    randomUUID: overrides.randomUUID || (() => globalThis.crypto.randomUUID()),
    nowIso: overrides.nowIso || (() => new Date().toISOString())
  };

  return {
    async fetch(request, env) {
      let response;
      try {
        assertAllowedOrigin(request, env);
        const url = new URL(request.url);

        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
          response = jsonResponse({ ok: true, data: { name: 'cha-amu-gateway' } });
        } else if (request.method === 'OPTIONS' && url.pathname === '/api') {
          response = new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              'Access-Control-Max-Age': '86400'
            }
          });
        } else if (request.method === 'POST' && url.pathname === '/api') {
          response = jsonResponse(await routeApi(await parseBody(request), request, env, dependencies));
        } else {
          throw new GatewayError(404, '요청 경로를 찾을 수 없습니다.');
        }
      } catch (error) {
        const status = error instanceof GatewayError ? error.status : 503;
        const message = error instanceof GatewayError ? error.message : '보안 게이트웨이가 요청을 처리하지 못했습니다.';
        response = jsonResponse({ ok: false, error: message }, status);
      }
      return addCors(response, request, env);
    }
  };
}

export default createGateway();
