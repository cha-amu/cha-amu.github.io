import { CONTENT_TABLES, readRecord, storedRecord } from './content-schema.js';
import {
  assert, ContentError, constantTimeEqual, hashGuestbookPassword,
  checkAdminPassword, createAdminSession, requireAdmin
} from './content-auth.js';
import {
  RATE_LIMITS, clientScope, scoped, enforceContentRateLimit, enforceGuestbookCreateLimits
} from './content-rate-limits.js';

const DEFAULT_NAME = 'ㅇㅁ';
const IDS_SQL = 'SELECT value FROM json_each(?)';
// Code.js prefixed text starting with = + - @ with an apostrophe so Sheets would not run it
// as a formula. Sheets dropped that apostrophe when reading the cell back; D1 would keep it
// and show it to readers, so text is stored exactly as typed.
// Apps Script sorted titles with the Korean collation (Hangul before Latin); workerd's
// default locale would reorder the things page.
const TITLE_COLLATION = 'ko';

function insertStatement(db, definition, record, { upsert = false } = {}) {
  const { columns, values } = storedRecord(definition, record);
  let sql = `INSERT INTO ${definition.table} (${columns.join(',')}) SELECT ${values.map(() => '?').join(',')}`;
  sql += ' WHERE true';
  if (upsert) sql += ` ON CONFLICT(${definition.key}) DO UPDATE SET ${columns.filter((key) => key !== definition.key).map((key) => `${key} = excluded.${key}`).join(',')}`;
  return db.prepare(`${sql} RETURNING ${definition.key}`).bind(...values);
}

async function list(db, name) {
  const definition = CONTENT_TABLES[name];
  const { results } = await db.prepare(`SELECT * FROM ${definition.table} ORDER BY rowid`).all();
  return results.map((row) => readRecord(definition, row));
}

function guestbookProjection(entry, admin = false) {
  return {
    id: String(entry.id), name: String(entry.name || '').trim() || DEFAULT_NAME,
    message: String(entry.message || ''), status: entry.status, createdAt: entry.createdAt,
    ...(admin ? { hiddenReason: String(entry.hiddenReason || '') } : {})
  };
}

async function publicThings(db) {
  return (await list(db, 'things')).filter((thing) => thing.id && thing.status === 'visible')
    .map((thing) => ({
      id: String(thing.id), title: String(thing.title || ''), description: String(thing.description || ''),
      url: String(thing.url || ''), imageUrl: String(thing.imageUrl || ''), status: 'visible',
      sortOrder: Number(thing.sortOrder || 0), updatedAt: String(thing.updatedAt || '')
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, TITLE_COLLATION) || a.id.localeCompare(b.id, TITLE_COLLATION));
}

async function audit(db, action, targetType, ids, dependencies) {
  if (!ids.length) return;
  try {
    // One statement for even a 100-id bulk action; never exceed D1's bind limit.
    const rows = ids.map((targetId) => ({ id: dependencies.randomUUID(), targetId }));
    await db.prepare(`INSERT INTO audit_log (id, action, targetType, targetId, createdAt)
      SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.targetId'), ? FROM json_each(?)`)
      .bind(action, targetType, dependencies.nowIso(), JSON.stringify(rows)).run();
  } catch {
    // As in Code.js, audit failure must not turn a committed write into an error.
  }
}

async function createGuestbook(db, body, env, deps, context) {
  const id = String(context.entryId || '').trim();
  const name = String(body.name || '').trim() || DEFAULT_NAME;
  const message = String(body.message || '').trim().slice(0, 1000);
  const password = String(body.deletePassword || '');
  assert(!String(body.website || '').trim(), '요청을 처리할 수 없습니다.');
  assert(message && password, '메시지와 비밀번호를 입력해야 합니다.');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id), 'Security gateway entry id is missing.');
  await enforceGuestbookCreateLimits(db, body, message, env, deps);
  const salt = deps.randomUUID();
  const entry = {
    id, name: name.slice(0, 40), message,
    status: 'visible', createdAt: deps.nowIso(), passwordSalt: salt,
    passwordHash: await hashGuestbookPassword(password, salt, '', 1, env, deps.subtle),
    passwordHashAlgorithm: 'SHA-256+salt+pepper', passwordHashIterations: 1, hiddenReason: ''
  };
  await db.batch([
    insertStatement(db, CONTENT_TABLES.guestbook, entry),
    db.prepare(`INSERT INTO guestbook_entry_ips
      (entry_id, ip_hash, hash_version, state, created_at, updated_at)
      VALUES (?, ?, 'v1', 'active', ?, ?)`)
      .bind(id, context.ipHash, entry.createdAt, entry.createdAt)
  ]);
  return { id, name: name.slice(0, 40), message, status: entry.status, createdAt: entry.createdAt };
}

async function hideByPassword(db, body, env, deps) {
  assert(body.id, 'Guestbook entry id is required.');
  assert(body.deletePassword, '비밀번호를 입력해야 합니다.');
  await enforceContentRateLimit(db, scoped(RATE_LIMITS.guestbookDeleteWindow, await clientScope(body, env, deps.subtle)), deps);
  await enforceContentRateLimit(db, scoped(RATE_LIMITS.guestbookDeleteEntryWindow, body.id), deps);
  const entry = typeof body.id === 'string'
    ? await db.prepare('SELECT * FROM guestbook_entries WHERE id = ?').bind(body.id).first() : null;
  assert(entry, 'Guestbook entry not found.');
  const actual = await hashGuestbookPassword(body.deletePassword, entry.passwordSalt, entry.passwordHashAlgorithm, entry.passwordHashIterations, env, deps.subtle);
  assert(constantTimeEqual(entry.passwordHash, actual), '삭제용 비밀번호가 맞지 않습니다.');
  const changed = await db.prepare(`UPDATE guestbook_entries SET status = 'hidden'
    WHERE id = ? AND passwordHash = ? AND passwordSalt = ? RETURNING id`)
    .bind(body.id, entry.passwordHash, entry.passwordSalt).first();
  assert(changed, 'Guestbook entry not found.');
  return { id: body.id };
}

async function saveAssetOverride(db, override, deps) {
  assert(override && override.assetId, 'assetId is required.');
  const next = { ...override, updatedAt: deps.nowIso() };
  await insertStatement(db, CONTENT_TABLES.assetOverrides, next, { upsert: true }).run();
  await audit(db, 'assetOverride.update', 'asset', [next.assetId], deps);
  return next;
}

// The gateway additionally canonicalizes URLs and validates request field allowlists.
function validateThingUrl(value) {
  const url = String(value || '').trim();
  assert(url && url.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(url), 'Thing URL must be an absolute HTTP or HTTPS URL.');
  assert(!/^https?:\/\/[^/?#]*@/i.test(url), 'Thing URL must not contain credentials.');
  const match = url.match(/^https?:\/\/(\[[0-9a-f:.]+\]|[^/?#:@\\\s]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i);
  assert(match, 'Thing URL must contain a valid hostname.');
  const hostname = match[1];
  const valid = hostname[0] === '[' ? /^\[[0-9a-f]*:[0-9a-f:.]*\]$/i.test(hostname)
    : hostname !== '.' && hostname[0] !== '.' && !hostname.includes('..');
  assert(valid && (!match[2] || Number(match[2]) <= 65535), 'Thing URL must contain a valid hostname.');
  return url;
}

async function saveThing(db, thing, deps) {
  assert(thing && typeof thing === 'object' && !Array.isArray(thing), 'Thing is required.');
  const id = String(thing.id || '').trim() || deps.randomUUID();
  const title = String(thing.title || '').trim();
  const description = String(thing.description || '');
  const status = String(thing.status || 'visible');
  const sortOrder = Number(thing.sortOrder);
  assert(id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id) && !/^[=+\-@]/.test(id), 'Invalid thing id.');
  assert(title && title.length <= 160 && !/[\u0000-\u001f\u007f]/.test(title), 'Invalid thing title.');
  assert(description.length <= 2000, 'Thing description is too long.');
  assert(['visible', 'hidden'].includes(status), 'Invalid thing status.');
  assert(Number.isSafeInteger(sortOrder) && Math.abs(sortOrder) <= 1000000000, 'Invalid thing sort order.');
  const next = {
    id, title, description, url: validateThingUrl(thing.url),
    imageUrl: String(thing.imageUrl || '').trim() ? validateThingUrl(thing.imageUrl) : '',
    status, sortOrder, updatedAt: deps.nowIso()
  };
  await insertStatement(db, CONTENT_TABLES.things, next, { upsert: true }).run();
  await audit(db, 'thing.save', 'thing', [id], deps);
  return next;
}

function validateIds(ids) {
  // Gateway already trims, deduplicates and caps at 100; Code.js also rejects controls.
  assert(ids.every((id) => !/[\u0000-\u001f\u007f]/.test(id)), 'Invalid id.');
  return JSON.stringify(ids);
}

function mutationResult(ids, rows, successKey, missingKey, key = 'id') {
  const changed = new Set(rows.map((row) => row[key]));
  return { [successKey]: ids.filter((id) => changed.has(id)), [missingKey]: ids.filter((id) => !changed.has(id)) };
}

async function bulkStatus(db, name, body, deps) {
  const ids = validateIds(body.ids);
  const now = deps.nowIso();
  let statement;
  if (name === 'guestbook') {
    const hasReason = Object.hasOwn(body, 'hiddenReason');
    statement = db.prepare(`UPDATE guestbook_entries SET status = ?,
      hiddenReason = CASE WHEN ? = 'visible' THEN '' WHEN ? THEN ? ELSE hiddenReason END
      WHERE id IN (${IDS_SQL}) RETURNING id`)
      .bind(body.status, body.status, Number(hasReason), hasReason ? body.hiddenReason.trim() : '', ids);
  } else {
    statement = db.prepare(`INSERT INTO asset_overrides (assetId, status, updatedAt)
      SELECT value, ?, ? FROM json_each(?) WHERE true
      ON CONFLICT(assetId) DO UPDATE SET status = excluded.status, updatedAt = excluded.updatedAt RETURNING assetId`)
      .bind(body.status, now, ids);
  }
  const { results } = await statement.all();
  const result = mutationResult(body.ids, results, 'updatedIds', 'missingIds', CONTENT_TABLES[name].key);
  const [action, type] = name === 'guestbook' ? ['guestbook.bulkStatus', 'guestbook'] : ['assetOverride.bulkStatus', 'asset'];
  await audit(db, action, type, result.updatedIds, deps);
  return result;
}

async function bulkDelete(db, name, body, deps) {
  const ids = validateIds(body.ids);
  const definition = CONTENT_TABLES[name];
  const statements = [];
  const deleteIndex = statements.length;
  statements.push(db.prepare(`DELETE FROM ${definition.table} WHERE ${definition.key} IN (${IDS_SQL}) RETURNING ${definition.key}`).bind(ids));
  if (name === 'guestbook') {
    // Includes already-missing ids; unrelated mappings and all bans/events survive.
    statements.push(db.prepare(`DELETE FROM guestbook_entry_ips WHERE entry_id IN (${IDS_SQL})`).bind(ids));
  }
  const results = await db.batch(statements);
  const result = mutationResult(body.ids, results[deleteIndex].results, 'deletedIds', 'alreadyMissingIds', definition.key);
  const [action, type] = name === 'guestbook' ? ['guestbook.bulkDelete', 'guestbook']
      : name === 'things' ? ['thing.delete', 'thing'] : ['assetOverride.delete', 'asset'];
  await audit(db, action, type, result.deletedIds, deps);
  return result;
}

async function adminGuestbookStatus(db, body, deps, visible) {
  const row = await db.prepare('UPDATE guestbook_entries SET status = ?, hiddenReason = ? WHERE id = ? RETURNING id')
    .bind(visible ? 'visible' : 'hidden', visible ? '' : String(body.hiddenReason || ''), String(body.id || '')).first();
  assert(row, 'Guestbook entry not found.');
  await audit(db, visible ? 'guestbook.restore' : 'guestbook.hide', 'guestbook', [body.id], deps);
  return { id: body.id };
}

async function dispatch(action, body, env, deps, context) {
  if (action.startsWith('admin.') && action !== 'admin.login') await requireAdmin(body.token, env, deps);
  if (action === 'admin.session.verify') return { valid: true };
  if (action === 'admin.session.refresh') return createAdminSession(env, deps);
  const db = env.SECURITY_DB;
  switch (action) {
    case 'guestbook.listPublic': return (await list(db, 'guestbook')).filter((entry) => entry.status === 'visible').map((entry) => guestbookProjection(entry));
    case 'assetOverride.listPublic': return list(db, 'assetOverrides');
    case 'thing.listPublic': return publicThings(db);
    case 'guestbook.create': return createGuestbook(db, body, env, deps, context);
    case 'guestbook.hideByPassword': return hideByPassword(db, body, env, deps);
    case 'admin.login':
      await enforceContentRateLimit(db, RATE_LIMITS.adminLoginEmergencyWindow, deps);
      await checkAdminPassword(body, env, deps);
      await audit(db, 'admin.login', 'admin', [''], deps);
      return createAdminSession(env, deps);
    case 'admin.guestbook.list': return (await list(db, 'guestbook')).map((entry) => guestbookProjection(entry, true));
    case 'admin.guestbook.hide': return adminGuestbookStatus(db, body, deps, false);
    case 'admin.guestbook.restore': return adminGuestbookStatus(db, body, deps, true);
    case 'admin.guestbook.bulkStatus': return bulkStatus(db, 'guestbook', body, deps);
    case 'admin.guestbook.bulkDelete': return bulkDelete(db, 'guestbook', body, deps);
    case 'admin.assetOverride.list': case 'storage.sync.assetOverride.list': return list(db, 'assetOverrides');
    case 'admin.assetOverride.save': case 'storage.sync.assetOverride.save': return saveAssetOverride(db, body.override, deps);
    case 'admin.assetOverride.bulkStatus': return bulkStatus(db, 'assetOverrides', body, deps);
    case 'admin.assetOverride.delete': case 'storage.sync.assetOverride.delete': return bulkDelete(db, 'assetOverrides', body, deps);
    case 'admin.thing.list': return list(db, 'things');
    case 'admin.thing.save': return saveThing(db, body.thing, deps);
    case 'admin.thing.delete': return bulkDelete(db, 'things', body, deps);
    default: throw new ContentError(`Unknown action: ${action}`);
  }
}

export async function contentAction(action, body, env, dependencies, context = {}) {
  try { return { ok: true, data: await dispatch(action, body, env, dependencies, context) }; }
  catch (error) {
    // Legacy Apps Script validation/auth failures were HTTP 200 envelopes.
    // Database/runtime failures propagate to the gateway's fail-closed 503 handler.
    if (error instanceof ContentError) return { ok: false, error: error.message };
    throw error;
  }
}
