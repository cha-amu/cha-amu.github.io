import { assert, hmacHex, requiredSecret, sha256Hex } from './content-auth.js';

export const RATE_LIMITS = {
  adminLoginEmergencyWindow: { key: 'admin-login-emergency-window', limit: 120, windowSeconds: 3600, message: '관리자 로그인 요청이 일시적으로 많습니다. 나중에 다시 시도하세요.' },
  guestbookCreateBurst: { key: 'guestbook-create-burst', limit: 1, windowSeconds: 10, message: '방명록 작성이 너무 빠릅니다. 잠시 후 다시 시도하세요.' },
  guestbookCreateWindow: { key: 'guestbook-create-window', limit: 12, windowSeconds: 3600, message: '방명록 작성이 너무 많습니다. 나중에 다시 시도하세요.' },
  guestbookClientDuplicateWindow: { key: 'guestbook-client-duplicate-window', limit: 1, windowSeconds: 600, message: '같은 메시지가 반복되어 잠시 제한했습니다.' },
  guestbookGlobalDuplicateWindow: { key: 'guestbook-global-duplicate-window', limit: 2, windowSeconds: 600, message: '같은 긴 메시지가 반복되어 잠시 제한했습니다.' },
  guestbookEmergencyWindow: { key: 'guestbook-emergency-window', limit: 120, windowSeconds: 3600, message: '방명록 요청이 일시적으로 많습니다. 나중에 다시 시도하세요.' },
  guestbookDeleteWindow: { key: 'guestbook-delete-window', limit: 30, windowSeconds: 3600, message: '삭제 시도가 너무 많습니다. 나중에 다시 시도하세요.' },
  guestbookDeleteEntryWindow: { key: 'guestbook-delete-entry', limit: 5, windowSeconds: 600, message: '이 글의 삭제 비밀번호 시도가 너무 많습니다. 10분 후 다시 시도하세요.' }
};

function keyPart(value) { return String(value || '').replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 80); }
export function scoped(rule, scope) { return { ...rule, key: `${rule.key}:${keyPart(scope)}` }; }
export function normalizeMessage(value) { return String(value || '').trim().slice(0, 1000).replace(/\s+/g, ' ').toLowerCase(); }

export async function clientScope(body, env, subtle) {
  const clientId = String(body.clientId || '').trim();
  const source = /^[A-Za-z0-9_-]{16,128}$/.test(clientId)
    ? `client:${clientId}` : `password:${String(body.deletePassword || '')}`;
  return (await hmacHex(source, requiredSecret(env, 'GUESTBOOK_SERVER_PEPPER'), subtle)).slice(0, 32);
}

export async function enforceContentRateLimit(db, rule, dependencies) {
  const now = Date.parse(dependencies.nowIso());
  // Each attempt increments atomically, including rejected attempts. Prune only
  // expired windows, with an indexed predicate, to bound persistent storage.
  const [, result] = await db.batch([
    db.prepare('DELETE FROM rate_limit_windows WHERE reset_at <= ?').bind(now),
    db.prepare(`INSERT INTO rate_limit_windows (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`)
      .bind(rule.key, now + rule.windowSeconds * 1000)
  ]);
  assert(result.results[0].count <= rule.limit, rule.message);
}

export async function enforceGuestbookCreateLimits(db, body, message, env, dependencies) {
  const scope = await clientScope(body, env, dependencies.subtle);
  await enforceContentRateLimit(db, scoped(RATE_LIMITS.guestbookCreateBurst, scope), dependencies);
  await enforceContentRateLimit(db, scoped(RATE_LIMITS.guestbookCreateWindow, scope), dependencies);
  const messageKey = (await sha256Hex(normalizeMessage(message), dependencies.subtle)).slice(0, 32);
  await enforceContentRateLimit(db, scoped(RATE_LIMITS.guestbookClientDuplicateWindow, `${scope}:${messageKey}`), dependencies);
  if (normalizeMessage(message).length >= 20) {
    await enforceContentRateLimit(db, scoped(RATE_LIMITS.guestbookGlobalDuplicateWindow, messageKey), dependencies);
  }
  await enforceContentRateLimit(db, RATE_LIMITS.guestbookEmergencyWindow, dependencies);
}
