import { contentAction } from './content-api.js';

const PUBLIC_ACTIONS = new Set([
  'guestbook.listPublic',
  'assetOverride.listPublic',
  'thing.listPublic'
]);

const CONTENT_ACTIONS = new Set([
  ...PUBLIC_ACTIONS,
  'guestbook.hideByPassword',
  'admin.session.verify',
  'admin.session.refresh',
  'admin.guestbook.hide',
  'admin.guestbook.restore',
  'admin.assetOverride.list',
  'admin.assetOverride.save',
  'admin.thing.list'
]);

const VALIDATED_ADMIN_ACTIONS = new Set([
  'admin.guestbook.bulkStatus',
  'admin.guestbook.bulkDelete',
  'admin.assetOverride.bulkStatus',
  'admin.assetOverride.delete',
  'admin.thing.delete'
]);

const STORAGE_SYNC_ACTIONS = new Set([
  'storage.sync.assetOverride.list',
  'storage.sync.assetOverride.save',
  'storage.sync.assetOverride.delete'
]);

const ACTION_FIELDS = new Map([
  ['guestbook.listPublic', []],
  ['assetOverride.listPublic', []],
  ['thing.listPublic', []],
  ['guestbook.create', ['name', 'message', 'deletePassword', 'clientId', 'website']],
  ['guestbook.hideByPassword', ['id', 'deletePassword', 'clientId']],
  ['admin.login', ['password']],
  ['admin.session.verify', ['token']],
  ['admin.session.refresh', ['token']],
  ['admin.guestbook.list', ['token']],
  ['admin.guestbook.hide', ['token', 'id', 'hiddenReason']],
  ['admin.guestbook.restore', ['token', 'id']],
  ['admin.guestbook.bulkStatus', ['token', 'ids', 'status', 'hiddenReason']],
  ['admin.guestbook.bulkDelete', ['token', 'ids']],
  ['admin.assetOverride.list', ['token']],
  ['admin.assetOverride.save', ['token', 'override']],
  ['admin.assetOverride.bulkStatus', ['token', 'ids', 'status']],
  ['admin.assetOverride.delete', ['token', 'ids']],
  ['admin.thing.list', ['token']],
  ['admin.thing.save', ['token', 'thing']],
  ['admin.thing.delete', ['token', 'ids']],
  ['storage.sync.assetOverride.list', []],
  ['storage.sync.assetOverride.save', ['override']],
  ['storage.sync.assetOverride.delete', ['ids']]
]);

const IP_BAN_SCOPE = 'guestbook.create';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BULK_IDS = 100;
const MAX_ASSET_ID_LENGTH = 512;
const MAX_GUESTBOOK_ID_LENGTH = 128;
const MAX_THING_ID_LENGTH = 128;
const MAX_THING_TITLE_LENGTH = 160;
const MAX_THING_DESCRIPTION_LENGTH = 2_000;
const MAX_THING_URL_LENGTH = 2_048;
const MAX_TOKEN_LENGTH = 2048;
const MAX_HIDDEN_REASON_LENGTH = 500;
const MAX_STORAGE_TEXT_LENGTH = 5_000;
const MAX_STORAGE_URL_LENGTH = 2_048;
const MAX_STORAGE_TAGS = 100;
const MAX_STORAGE_TAG_LENGTH = 100;
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

function requireRequestString(value, name, maxLength) {
  if (typeof value !== 'string') {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  return normalized;
}

function assertOnlyFields(body, allowedFields) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) {
      throw new GatewayError(400, `지원하지 않는 요청 필드입니다: ${field}`);
    }
  }
}

function normalizeBulkIds(value, maxIdLength) {
  if (!Array.isArray(value)) {
    throw new GatewayError(400, 'ids는 배열이어야 합니다.');
  }
  const ids = [];
  const seen = new Set();
  for (const valueItem of value) {
    const id = requireRequestString(valueItem, 'id', maxIdLength);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length > MAX_BULK_IDS) {
      throw new GatewayError(400, `한 번에 최대 ${MAX_BULK_IDS}개까지 처리할 수 있습니다.`);
    }
  }
  if (!ids.length) throw new GatewayError(400, '처리할 id가 필요합니다.');
  return ids;
}

function requirePlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  return value;
}

function normalizeOptionalString(value, name, maxLength) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  return value;
}

function normalizeStorageTags(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_STORAGE_TAGS) {
    throw new GatewayError(400, 'tags 값이 올바르지 않습니다.');
  }
  return value.map((tag) => requireRequestString(tag, 'tag', MAX_STORAGE_TAG_LENGTH));
}

function normalizeStorageAssetOverride(value) {
  const override = requirePlainObject(value, 'override');
  const fields = ['assetId', 'displayName', 'description', 'tags', 'sourceUrl', 'status', 'sortOrder'];
  assertOnlyFields(override, fields);
  const normalized = {
    assetId: requireRequestString(override.assetId, 'assetId', MAX_ASSET_ID_LENGTH)
  };
  for (const [field, maxLength] of Object.entries({
    displayName: MAX_STORAGE_TEXT_LENGTH,
    description: MAX_STORAGE_TEXT_LENGTH,
    sourceUrl: MAX_STORAGE_URL_LENGTH
  })) {
    const fieldValue = normalizeOptionalString(override[field], field, maxLength);
    if (fieldValue !== undefined) normalized[field] = fieldValue;
  }
  const tags = normalizeStorageTags(override.tags);
  if (tags !== undefined) normalized.tags = tags;
  if (override.status !== undefined) {
    const status = requireRequestString(override.status, 'status', 32);
    if (!new Set(['visible', 'hidden', 'deleted']).has(status)) {
      throw new GatewayError(400, '지원하지 않는 자료 상태입니다.');
    }
    normalized.status = status;
  }
  if (override.sortOrder !== undefined) {
    if (!Number.isFinite(override.sortOrder) || Math.abs(override.sortOrder) > Number.MAX_SAFE_INTEGER) {
      throw new GatewayError(400, 'sortOrder 값이 올바르지 않습니다.');
    }
    normalized.sortOrder = override.sortOrder;
  }
  return normalized;
}

function normalizeThingUrl(value, name = 'url', allowEmpty = false) {
  if (allowEmpty && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) return '';
  const raw = requireRequestString(value, name, MAX_THING_URL_LENGTH);
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  if (!new Set(['http:', 'https:']).has(url.protocol) || !url.hostname || url.username || url.password) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  const canonical = url.href;
  if (canonical.length > MAX_THING_URL_LENGTH) {
    throw new GatewayError(400, `${name} 값이 올바르지 않습니다.`);
  }
  return canonical;
}

function normalizeThingId(value) {
  const id = requireRequestString(value, 'id', MAX_THING_ID_LENGTH);
  if (/[\u0000-\u001f\u007f]/.test(id) || /^[=+\-@]/.test(id)) {
    throw new GatewayError(400, 'id 값이 올바르지 않습니다.');
  }
  return id;
}

function normalizeThingSaveAction(body) {
  assertOnlyFields(body, ['action', 'token', 'thing']);
  const token = requireRequestString(body.token, 'token', MAX_TOKEN_LENGTH);
  const thing = requirePlainObject(body.thing, 'thing');
  assertOnlyFields(thing, ['id', 'title', 'description', 'url', 'imageUrl', 'status', 'sortOrder']);

  const normalizedThing = {
    title: requireRequestString(thing.title, 'title', MAX_THING_TITLE_LENGTH),
    description: normalizeOptionalString(thing.description, 'description', MAX_THING_DESCRIPTION_LENGTH) || '',
    url: normalizeThingUrl(thing.url),
    imageUrl: normalizeThingUrl(thing.imageUrl, 'imageUrl', true),
    status: requireRequestString(thing.status, 'status', 32)
  };
  if (!new Set(['visible', 'hidden']).has(normalizedThing.status)) {
    throw new GatewayError(400, '지원하지 않는 링크 상태입니다.');
  }
  if (thing.id !== undefined) normalizedThing.id = normalizeThingId(thing.id);
  if (!Number.isSafeInteger(thing.sortOrder) || Math.abs(thing.sortOrder) > 1_000_000_000) {
    throw new GatewayError(400, 'sortOrder 값이 올바르지 않습니다.');
  }
  normalizedThing.sortOrder = thing.sortOrder;
  return { token, thing: normalizedThing };
}

function normalizeStorageSyncAction(action, body) {
  if (action.endsWith('.list')) {
    assertOnlyFields(body, ['action']);
    return {};
  }
  if (action === 'storage.sync.assetOverride.save') {
    assertOnlyFields(body, ['action', 'override']);
    return { override: normalizeStorageAssetOverride(body.override) };
  }
  assertOnlyFields(body, ['action', 'ids']);
  return { ids: normalizeBulkIds(body.ids, MAX_ASSET_ID_LENGTH) };
}

function normalizeAdminAction(action, body) {
  const token = requireRequestString(body.token, 'token', MAX_TOKEN_LENGTH);
  const isBulkStatus = action.endsWith('.bulkStatus');
  const allowedFields = ['action', 'token', 'ids'];
  if (isBulkStatus) allowedFields.push('status');
  if (action === 'admin.guestbook.bulkStatus') allowedFields.push('hiddenReason');
  assertOnlyFields(body, allowedFields);

  const maxIdLength = action.startsWith('admin.guestbook.')
    ? MAX_GUESTBOOK_ID_LENGTH
    : action.startsWith('admin.thing.')
      ? MAX_THING_ID_LENGTH
      : MAX_ASSET_ID_LENGTH;
  const ids = normalizeBulkIds(body.ids, maxIdLength);
  const normalized = { token, ids: action.startsWith('admin.thing.') ? ids.map(normalizeThingId) : ids };
  if (!isBulkStatus) return normalized;

  const statuses = action === 'admin.guestbook.bulkStatus'
    ? new Set(['visible', 'hidden'])
    : new Set(['visible', 'hidden', 'deleted']);
  const status = requireRequestString(body.status, 'status', 32);
  if (!statuses.has(status)) throw new GatewayError(400, '지원하지 않는 상태입니다.');
  normalized.status = status;

  if (action === 'admin.guestbook.bulkStatus') {
    const rawReason = body.hiddenReason;
    if (status === 'hidden') {
      normalized.hiddenReason = requireRequestString(rawReason, 'hiddenReason', MAX_HIDDEN_REASON_LENGTH);
    } else if (rawReason !== undefined && (typeof rawReason !== 'string' || rawReason.trim())) {
      throw new GatewayError(400, '공개 처리에는 숨김 사유를 사용할 수 없습니다.');
    }
  }
  return normalized;
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

function requireTrustedStorageSync(request, env) {
  const configured = requireString(env.STORAGE_SYNC_SECRET, 'STORAGE_SYNC_SECRET', 32);
  const authorization = request.headers.get('Authorization') || '';
  if (!constantTimeEqual(authorization, `Bearer ${configured}`)) {
    throw new GatewayError(403, '저장소 동기화 인증에 실패했습니다.');
  }
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

function callContent(action, body, env, dependencies, context) {
  const fields = ACTION_FIELDS.get(action);
  const payload = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = body[field];
  }
  if (!action.startsWith('admin.session.')) requireDatabase(env);
  return contentAction(action, payload, env, dependencies, context);
}

async function handleValidatedAdminAction(action, body, env, dependencies) {
  return callContent(action, normalizeAdminAction(action, body), env, dependencies);
}

async function handleThingSave(body, env, dependencies) {
  return callContent('admin.thing.save', normalizeThingSaveAction(body), env, dependencies);
}

async function handleStorageSyncAction(action, body, request, env, dependencies) {
  requireTrustedStorageSync(request, env);
  return callContent(action, normalizeStorageSyncAction(action, body), env, dependencies);
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

async function handleGuestbookCreate(body, request, env, dependencies) {
  const db = requireDatabase(env);
  const ipHash = await hashClientIp(request, env, dependencies.subtle);
  await enforceRateLimit(env, 'GUESTBOOK_CREATE_RATE_LIMITER', ipHash);
  if (await isIpBanned(db, ipHash)) {
    throw new GatewayError(403, '이 주소에서는 방명록을 작성할 수 없습니다.');
  }
  await verifyTurnstile(body, request, env, 'guestbook_create', dependencies.fetch);

  return callContent('guestbook.create', body, env, dependencies, {
    entryId: dependencies.randomUUID(), ipHash
  });
}

async function handleGuestbookDelete(body, request, env, dependencies) {
  const ipHash = await hashClientIp(request, env, dependencies.subtle);
  const entryId = typeof body.id === 'string' ? body.id.slice(0, 128) : '';
  await enforceRateLimit(env, 'GUESTBOOK_DELETE_RATE_LIMITER', `${ipHash}:${entryId}`);
  return callContent('guestbook.hideByPassword', body, env, dependencies);
}

async function handleAdminLogin(body, request, env, dependencies) {
  const ipHash = await hashClientIp(request, env, dependencies.subtle);
  await enforceRateLimit(env, 'ADMIN_LOGIN_RATE_LIMITER', ipHash);
  await verifyTurnstile(body, request, env, 'admin_login', dependencies.fetch);
  return callContent('admin.login', body, env, dependencies);
}

async function requireAdminSession(body, env, dependencies) {
  if (typeof body.token !== 'string' || !body.token) {
    throw new GatewayError(401, '관리자 로그인이 필요합니다.');
  }
  const envelope = await callContent('admin.session.verify', { token: body.token }, env, dependencies);
  if (!envelope.ok) throw new GatewayError(401, '관리자 로그인이 만료되었습니다.');
}

async function listIpSecurity(db) {
  const result = await db.prepare(
    `SELECT m.entry_id,
            CASE WHEN b.ip_hash IS NULL THEN 0 ELSE 1 END AS ip_blocked,
            (SELECT COUNT(*)
               FROM guestbook_entry_ips related
              WHERE related.ip_hash = m.ip_hash AND related.state IN ('active', 'pending')
                AND EXISTS (SELECT 1 FROM guestbook_entries e WHERE e.id = related.entry_id)) AS related_entry_count
       FROM guestbook_entry_ips m
       LEFT JOIN ip_bans b
         ON b.scope = ? AND b.ip_hash = m.ip_hash AND b.revoked_at IS NULL
      WHERE m.state IN ('active', 'pending')
        AND EXISTS (SELECT 1 FROM guestbook_entries e WHERE e.id = m.entry_id)`
  ).bind(IP_BAN_SCOPE).all();
  return new Map((result?.results || []).map((row) => [String(row.entry_id), row]));
}

async function handleAdminGuestbookList(body, env, dependencies) {
  const envelope = await callContent('admin.guestbook.list', body, env, dependencies);
  if (!envelope.ok || !Array.isArray(envelope.data)) return envelope;

  const db = requireDatabase(env);
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
    `SELECT ip_hash FROM guestbook_entry_ips WHERE entry_id = ? AND state IN ('active', 'pending')
       AND EXISTS (SELECT 1 FROM guestbook_entries e WHERE e.id = guestbook_entry_ips.entry_id) LIMIT 1`
  ).bind(entryId).first();
}

async function countRelatedEntries(db, ipHash) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM guestbook_entry_ips
      WHERE ip_hash = ? AND state IN ('active', 'pending')
        AND EXISTS (SELECT 1 FROM guestbook_entries e WHERE e.id = guestbook_entry_ips.entry_id)`
  ).bind(ipHash).first();
  return Number(row?.count || 0);
}

async function getActiveBanBySourceEntry(db, entryId) {
  return db.prepare(
    `SELECT ip_hash
       FROM ip_bans
      WHERE scope = ? AND source_entry_id = ? AND revoked_at IS NULL
      LIMIT 1`
  ).bind(IP_BAN_SCOPE, entryId).first();
}

async function handleIpBanList(body, env, dependencies) {
  await requireAdminSession(body, env, dependencies);
  const db = requireDatabase(env);
  const result = await db.prepare(
    `SELECT b.ip_hash,
            b.reason,
            b.source_entry_id,
            b.banned_at,
            related.entry_id AS related_entry_id
       FROM ip_bans b
       LEFT JOIN guestbook_entry_ips related
         ON related.ip_hash = b.ip_hash AND related.state IN ('active', 'pending')
                AND EXISTS (SELECT 1 FROM guestbook_entries e WHERE e.id = related.entry_id)
      WHERE b.scope = ? AND b.revoked_at IS NULL
      ORDER BY b.banned_at DESC, related.created_at, related.entry_id`
  ).bind(IP_BAN_SCOPE).all();

  const bansByHash = new Map();
  for (const row of result?.results || []) {
    const ipHash = String(row.ip_hash || '');
    if (!ipHash) continue;
    let ban = bansByHash.get(ipHash);
    if (!ban) {
      ban = {
        sourceEntryId: row.source_entry_id ? String(row.source_entry_id) : null,
        reason: String(row.reason || ''),
        bannedAt: String(row.banned_at || ''),
        relatedEntryIds: []
      };
      bansByHash.set(ipHash, ban);
    }
    if (row.related_entry_id) ban.relatedEntryIds.push(String(row.related_entry_id));
  }

  return {
    ok: true,
    data: {
      bans: Array.from(bansByHash.values(), (ban) => ({
        ...ban,
        relatedEntryCount: ban.relatedEntryIds.length
      }))
    }
  };
}

async function handleIpBan(body, env, dependencies, blocked) {
  await requireAdminSession(body, env, dependencies);
  const db = requireDatabase(env);
  const requestedEntryId = body.entryId ?? body.id;
  const entryId = typeof requestedEntryId === 'string' ? requestedEntryId.trim() : '';
  if (!entryId) throw new GatewayError(400, '방명록 글 식별자가 필요합니다.');
  const mapping = await getActiveMapping(db, entryId);
  const target = mapping || (!blocked ? await getActiveBanBySourceEntry(db, entryId) : null);
  if (!target) throw new GatewayError(404, '이 글에는 IP 정보가 없습니다.');

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
      ).bind(IP_BAN_SCOPE, target.ip_hash, reason, entryId, now),
      db.prepare(
        `INSERT INTO ip_ban_events
          (scope, ip_hash, action, source_entry_id, reason, created_at)
         VALUES (?, ?, 'ban', ?, ?, ?)`
      ).bind(IP_BAN_SCOPE, target.ip_hash, entryId, reason, now)
    ]);
  } else {
    await db.batch([
      db.prepare(
        `UPDATE ip_bans SET revoked_at = ?
          WHERE scope = ? AND ip_hash = ? AND revoked_at IS NULL`
      ).bind(now, IP_BAN_SCOPE, target.ip_hash),
      db.prepare(
        `INSERT INTO ip_ban_events
          (scope, ip_hash, action, source_entry_id, reason, created_at)
         VALUES (?, ?, 'unban', ?, '', ?)`
      ).bind(IP_BAN_SCOPE, target.ip_hash, entryId, now)
    ]);
  }

  return {
    ok: true,
    data: {
      entryId,
      ipBlocked: blocked,
      relatedEntryCount: await countRelatedEntries(db, target.ip_hash)
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
  if (action === 'admin.guestbook.ip.bans.list') {
    return handleIpBanList(body, env, dependencies);
  }
  if (action === 'admin.guestbook.ip.unban') {
    return handleIpBan(body, env, dependencies, false);
  }
  if (action === 'admin.thing.save') {
    return handleThingSave(body, env, dependencies);
  }
  if (STORAGE_SYNC_ACTIONS.has(action)) {
    return handleStorageSyncAction(action, body, request, env, dependencies);
  }
  if (VALIDATED_ADMIN_ACTIONS.has(action)) {
    return handleValidatedAdminAction(action, body, env, dependencies);
  }
  if (CONTENT_ACTIONS.has(action)) {
    return callContent(action, body, env, dependencies);
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
