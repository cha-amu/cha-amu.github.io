const encoder = new TextEncoder();

export class ContentError extends Error {}
export function assert(condition, message) {
  if (!condition) throw new ContentError(message);
}

export function requiredSecret(env, key, minLength = 32) {
  const value = env[key];
  assert(value && String(value).length >= minLength, 'Server security config is missing.');
  return String(value);
}

export function constantTimeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value, subtle) {
  return hex(await subtle.digest('SHA-256', encoder.encode(String(value))));
}

export async function hmacHex(value, secret, subtle) {
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function hashGuestbookPassword(password, salt, algorithm, iterations, env, subtle) {
  const pepper = requiredSecret(env, 'GUESTBOOK_SERVER_PEPPER');
  if (!String(algorithm).startsWith('PBKDF2-HMAC-SHA256')) {
    return sha256Hex(`${String(salt)}:${String(password)}:${pepper}`, subtle);
  }
  // Code.js computes one 32-byte PBKDF2 block: U1 = HMAC(password+pepper,
  // UTF8(salt) || [0,0,0,1]), then XORs all U values. deriveBits is identical.
  const configured = Number(env.GUESTBOOK_PASSWORD_ITERATIONS || '1');
  const count = Number(iterations || configured || 50000);
  const rounds = Number.isNaN(count) ? 1 : Math.max(1, Math.ceil(count));
  const key = await subtle.importKey('raw', encoder.encode(String(password) + pepper), 'PBKDF2', false, ['deriveBits']);
  return hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(String(salt)), iterations: rounds }, key, 256));
}

export async function checkAdminPassword(body, env, dependencies) {
  const expected = requiredSecret(env, 'ADMIN_PASSWORD_HASH');
  const actual = await sha256Hex(String(body.password || '') + requiredSecret(env, 'ADMIN_PASSWORD_PEPPER'), dependencies.subtle);
  assert(constantTimeEqual(expected, actual), '관리자 비밀번호가 맞지 않습니다.');
}

export async function createAdminSession(env, dependencies) {
  const expiresAt = Date.parse(dependencies.nowIso()) + Number(env.ADMIN_SESSION_TTL_MS || '600000');
  const payload = btoa(JSON.stringify({ exp: expiresAt, nonce: dependencies.randomUUID() }))
    .replace(/\+/g, '-').replace(/\//g, '_');
  const signature = await hmacHex(payload, requiredSecret(env, 'ADMIN_SESSION_SECRET'), dependencies.subtle);
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

export async function requireAdmin(token, env, dependencies) {
  assert(typeof token === 'string' && token.includes('.'), 'Admin session is required.');
  const [payload, signature] = token.split('.');
  const expected = await hmacHex(payload, requiredSecret(env, 'ADMIN_SESSION_SECRET'), dependencies.subtle);
  assert(constantTimeEqual(signature, expected), 'Invalid admin session.');
  let decoded;
  try { decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { throw new ContentError('Invalid admin session.'); }
  assert(Date.parse(dependencies.nowIso()) <= decoded.exp, 'Admin session expired.');
}
