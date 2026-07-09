/**
 * Cha-amu Apps Script API.
 * Runtime secrets live in Script Properties, synced from GitHub Actions secrets during deployment.
 */
const SHEETS = {
  posts: 'posts',
  guestbook: 'guestbook',
  assetOverrides: 'assetOverrides',
  settings: 'settings',
  auditLog: 'auditLog'
};


const SHEET_COLUMNS = {
  posts: [
    'id', 'slug', 'title', 'excerpt', 'body', 'tags', 'status',
    'createdAt', 'updatedAt', 'publishedAt'
  ],
  guestbook: [
    'id', 'name', 'message', 'status', 'createdAt', 'passwordSalt',
    'passwordHash', 'passwordHashAlgorithm', 'passwordHashIterations', 'hiddenReason'
  ],
  assetOverrides: [
    'assetId', 'displayName', 'description', 'tags', 'sourceUrl',
    'status', 'sortOrder', 'updatedAt'
  ],
  settings: ['key', 'value', 'description', 'updatedAt'],
  auditLog: ['id', 'action', 'targetType', 'targetId', 'createdAt']
};

const SESSION_TTL_MS = Number(getProperty_('ADMIN_SESSION_TTL_MS', '60000'));
const PASSWORD_ITERATIONS = Number(getProperty_('GUESTBOOK_PASSWORD_ITERATIONS', '1'));
const GUESTBOOK_PASSWORD_HASH_ALGORITHM = 'SHA-256+salt+pepper';
const MIN_SECRET_LENGTH = 32;
const PUBLIC_CACHE_TTL_SECONDS = Math.max(1, Number(getProperty_('PUBLIC_CACHE_TTL_SECONDS', '300')) || 300);
const PUBLIC_CACHE_KEYS = {
  posts: 'public:posts:v1',
  guestbook: 'public:guestbook:v1'
};
const RATE_LIMITS = {
  adminLoginBurst: { key: 'admin-login-burst', limit: 1, windowSeconds: 2, message: '로그인 시도가 너무 빠릅니다. 잠시 후 다시 시도하세요.' },
  adminLoginWindow: { key: 'admin-login-window', limit: 8, windowSeconds: 300, message: '로그인 시도가 너무 많습니다. 5분 후 다시 시도하세요.' },
  guestbookCreateBurst: { key: 'guestbook-create-burst', limit: 1, windowSeconds: 10, message: '방명록 작성이 너무 빠릅니다. 잠시 후 다시 시도하세요.' },
  guestbookCreateWindow: { key: 'guestbook-create-window', limit: 12, windowSeconds: 3600, message: '방명록 작성이 너무 많습니다. 나중에 다시 시도하세요.' },
  guestbookDeleteWindow: { key: 'guestbook-delete-window', limit: 30, windowSeconds: 3600, message: '삭제 시도가 너무 많습니다. 나중에 다시 시도하세요.' },
  guestbookDeleteEntryWindow: { key: 'guestbook-delete-entry', limit: 5, windowSeconds: 600, message: '이 글의 삭제 비밀번호 시도가 너무 많습니다. 10분 후 다시 시도하세요.' }
};

function doPost(event) {
  try {
    const body = parseJson_(event && event.postData && event.postData.contents);
    const action = body.action;
    const data = route_(action, body);
    return json_({ ok: true, data });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function doGet(event) {
  try {
    const action = event && event.parameter && event.parameter.action;
    if (action === 'health') return json_({ ok: true, data: health_() });
    return json_({ ok: true, data: { name: 'cha-amu-api' } });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

/**
 * Run once from the Apps Script editor after creating/deploying the script.
 * Requires SPREADSHEET_ID in Script Properties and creates required sheets/headers.
 */
function setupChaAmu() {
  getSpreadsheetId_();
  Object.keys(SHEET_COLUMNS).forEach((sheetName) => {
    const sheet = getSheet_(sheetName);
    ensureHeaders_(sheet, SHEET_COLUMNS[sheetName]);
    sheet.setFrozenRows(1);
  });
  seedSettings_();
  return health_();
}

function health_() {
  return { name: 'cha-amu-api' };
}

function route_(action, body) {
  switch (action) {
    case 'post.listPublic': return listPublicPosts_();
    case 'guestbook.listPublic': return listPublicGuestbook_();
    case 'assetOverride.listPublic': return listPublicAssetOverrides_();
    case 'guestbook.create': return createGuestbook_(body);
    case 'guestbook.hideByPassword': return hideGuestbookByPassword_(body);
    case 'admin.login': return adminLogin_(body);
    case 'admin.session.refresh': requireAdmin_(body.token); return createAdminSession_();
    case 'admin.post.list': requireAdmin_(body.token); return rowsToObjects_(SHEETS.posts);
    case 'admin.post.save': requireAdmin_(body.token); return savePost_(body.post);
    case 'admin.guestbook.hide': requireAdmin_(body.token); return adminHideGuestbook_(body);
    case 'admin.assetOverride.list': requireAdmin_(body.token); return rowsToObjects_(SHEETS.assetOverrides);
    case 'admin.assetOverride.save': requireAdmin_(body.token); return saveAssetOverride_(body.override);
    default: throw new Error('Unknown action: ' + action);
  }
}

function listPublicPosts_() {
  return readPublicCache_(PUBLIC_CACHE_KEYS.posts, function () {
    return rowsToObjects_(SHEETS.posts).filter((post) => post.status === 'published');
  });
}

function listPublicGuestbook_() {
  return readPublicCache_(PUBLIC_CACHE_KEYS.guestbook, function () {
    return rowsToObjects_(SHEETS.guestbook)
      .filter((entry) => entry.status === 'visible')
      .map((entry) => ({ id: String(entry.id), name: String(entry.name || ''), message: String(entry.message || ''), status: entry.status, createdAt: entry.createdAt }));
  });
}

function listPublicAssetOverrides_() {
  return rowsToObjects_(SHEETS.assetOverrides);
}

function createGuestbook_(body) {
  assert_(body.name && body.message && body.deletePassword, 'Missing guestbook fields.');
  enforceRateLimit_(RATE_LIMITS.guestbookCreateBurst);
  enforceRateLimit_(RATE_LIMITS.guestbookCreateWindow);
  verifyTurnstile_(body.turnstileToken);
  const salt = Utilities.getUuid();
  const passwordHash = hashPassword_(body.deletePassword, salt);
  const entry = {
    id: Utilities.getUuid(),
    name: String(body.name).slice(0, 40),
    message: String(body.message).slice(0, 1000),
    status: 'visible',
    createdAt: new Date().toISOString(),
    passwordSalt: salt,
    passwordHash,
    passwordHashAlgorithm: GUESTBOOK_PASSWORD_HASH_ALGORITHM,
    passwordHashIterations: 1,
    hiddenReason: ''
  };
  appendObject_(SHEETS.guestbook, entry);
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
  return { id: entry.id, name: entry.name, message: entry.message, status: entry.status, createdAt: entry.createdAt };
}

function hideGuestbookByPassword_(body) {
  assert_(body.id, 'Guestbook entry id is required.');
  enforceRateLimit_(RATE_LIMITS.guestbookDeleteWindow);
  enforceRateLimit_(Object.assign({}, RATE_LIMITS.guestbookDeleteEntryWindow, { key: RATE_LIMITS.guestbookDeleteEntryWindow.key + ':' + rateKeyPart_(body.id) }));
  const sheet = getSheet_(SHEETS.guestbook);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex = headers.indexOf('id');
  const saltIndex = headers.indexOf('passwordSalt');
  const hashIndex = headers.indexOf('passwordHash');
  const algorithmIndex = headers.indexOf('passwordHashAlgorithm');
  const iterationsIndex = headers.indexOf('passwordHashIterations');
  const statusIndex = headers.indexOf('status');
  assert_(idIndex >= 0 && saltIndex >= 0 && hashIndex >= 0 && statusIndex >= 0, 'guestbook columns are not initialized.');
  for (let row = 1; row < values.length; row++) {
    if (values[row][idIndex] === body.id) {
      const expected = values[row][hashIndex];
      const actual = hashPasswordForEntry_(
        body.deletePassword,
        values[row][saltIndex],
        algorithmIndex >= 0 ? values[row][algorithmIndex] : '',
        iterationsIndex >= 0 ? values[row][iterationsIndex] : ''
      );
      assert_(constantTimeEqual_(expected, actual), '삭제용 비밀번호가 맞지 않습니다.');
      sheet.getRange(row + 1, statusIndex + 1).setValue('hidden');
      invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
      return { id: body.id };
    }
  }
  throw new Error('Guestbook entry not found.');
}

function adminLogin_(body) {
  enforceRateLimit_(RATE_LIMITS.adminLoginBurst);
  enforceRateLimit_(RATE_LIMITS.adminLoginWindow);
  const expected = getRequiredProperty_('ADMIN_PASSWORD_HASH', 32);
  const actual = sha256Hex_(String(body.password || '') + getRequiredProperty_('ADMIN_PASSWORD_PEPPER'));
  assert_(constantTimeEqual_(expected, actual), '관리자 비밀번호가 맞지 않습니다.');
  audit_('admin.login', 'admin', '');
  return createAdminSession_();
}

function createAdminSession_() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ exp: expiresAt, nonce: Utilities.getUuid() }));
  const sig = hmacHex_(payload, getRequiredProperty_('ADMIN_SESSION_SECRET'));
  return { token: payload + '.' + sig, expiresAt: new Date(expiresAt).toISOString() };
}

function requireAdmin_(token) {
  assert_(token && token.indexOf('.') > -1, 'Admin session is required.');
  const parts = token.split('.');
  const payload = parts[0];
  const sig = parts[1];
  assert_(constantTimeEqual_(sig, hmacHex_(payload, getRequiredProperty_('ADMIN_SESSION_SECRET'))), 'Invalid admin session.');
  const decoded = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payload)).getDataAsString());
  assert_(Date.now() <= decoded.exp, 'Admin session expired.');
}

function savePost_(post) {
  const next = Object.assign({}, post, {
    id: post.id || Utilities.getUuid(),
    tags: Array.isArray(post.tags) ? post.tags : [],
    updatedAt: new Date().toISOString(),
    createdAt: post.createdAt || new Date().toISOString(),
    publishedAt: post.status === 'published' ? (post.publishedAt || new Date().toISOString()) : post.publishedAt || ''
  });
  upsertObject_(SHEETS.posts, 'id', next);
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.posts);
  audit_('post.save', 'post', next.id);
  return next;
}

function saveAssetOverride_(override) {
  assert_(override && override.assetId, 'assetId is required.');
  const next = Object.assign({}, override, { updatedAt: new Date().toISOString() });
  upsertObject_(SHEETS.assetOverrides, 'assetId', next);
  audit_('assetOverride.update', 'asset', next.assetId);
  return next;
}

function adminHideGuestbook_(body) {
  const sheet = getSheet_(SHEETS.guestbook);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex = headers.indexOf('id');
  const statusIndex = headers.indexOf('status');
  const reasonIndex = headers.indexOf('hiddenReason');
  for (let row = 1; row < values.length; row++) {
    if (values[row][idIndex] === body.id) {
      sheet.getRange(row + 1, statusIndex + 1).setValue('hidden');
      if (reasonIndex >= 0) sheet.getRange(row + 1, reasonIndex + 1).setValue(body.hiddenReason || '');
      invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
      audit_('guestbook.hide', 'guestbook', body.id);
      return { id: body.id };
    }
  }
  throw new Error('Guestbook entry not found.');
}

function verifyTurnstile_(_) {
  // Turnstile is intentionally disabled for the current deployment.
  // Re-enable with UrlFetchApp and script.external_request scope when spam protection is added.
  return { skipped: true, reason: 'Turnstile disabled.' };
}
function rowsToObjects_(sheetName) {
  const values = getSheet_(sheetName).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter((row) => row.some(Boolean)).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = parseCell_(row[index]);
    });
    return obj;
  });
}

function appendObject_(sheetName, object) {
  const sheet = getSheet_(sheetName);
  const headers = ensureHeaders_(sheet, Object.keys(object));
  sheet.appendRow(headers.map((header) => formatCell_(object[header])));
}

function upsertObject_(sheetName, key, object) {
  const sheet = getSheet_(sheetName);
  const headers = ensureHeaders_(sheet, Object.keys(object));
  const keyIndex = headers.indexOf(key);
  const values = sheet.getDataRange().getValues();
  const rowValues = headers.map((header) => formatCell_(object[header]));
  for (let row = 1; row < values.length; row++) {
    if (values[row][keyIndex] === object[key]) {
      sheet.getRange(row + 1, 1, 1, headers.length).setValues([rowValues]);
      return;
    }
  }
  sheet.appendRow(rowValues);
}

function ensureHeaders_(sheet, keys) {
  const width = Math.max(sheet.getLastColumn(), keys.length, 1);
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].filter(Boolean);
  const headers = current.concat(keys.filter((key) => current.indexOf(key) === -1));
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return headers;
}

function getSheet_(name) {
  const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function getSpreadsheetId_() {
  return getRequiredProperty_('SPREADSHEET_ID', 20);
}

function seedSettings_() {
  const existing = rowsToObjects_(SHEETS.settings).reduce((map, row) => {
    map[row.key] = row;
    return map;
  }, {});
  const defaults = [
    { key: 'guestbookWriteMode', value: 'anonymous', description: 'anonymous 또는 google-login', updatedAt: new Date().toISOString() },
    { key: 'archiveManifestUrl', value: 'https://cha-amu.github.io/storage/manifests/assets.json', description: 'storage repo asset manifest URL', updatedAt: new Date().toISOString() }
  ];
  defaults.forEach((row) => {
    if (!existing[row.key]) upsertObject_(SHEETS.settings, 'key', row);
  });
}

function audit_(action, targetType, targetId) {
  try {
    appendObject_(SHEETS.auditLog, { id: Utilities.getUuid(), action, targetType, targetId, createdAt: new Date().toISOString() });
  } catch (_) {
    // Audit must not break user-facing operations.
  }
}

function parseJson_(value) { return value ? JSON.parse(value) : {}; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function readPublicCache_(key, producer) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { cache.remove(key); }
  }
  const data = producer();
  try {
    cache.put(key, JSON.stringify(data), PUBLIC_CACHE_TTL_SECONDS);
  } catch (_) {
    // Public cache failures must not break reads; large payloads can exceed Apps Script cache limits.
  }
  return data;
}
function invalidatePublicCache_() {
  const cache = CacheService.getScriptCache();
  Array.prototype.slice.call(arguments).filter(Boolean).forEach(function (key) {
    try { cache.remove(key); } catch (_) { /* cache invalidation must not break writes */ }
  });
}
function assert_(condition, message) { if (!condition) throw new Error(message); }
function getProperty_(key, fallback) { return PropertiesService.getScriptProperties().getProperty(key) || fallback; }
function getRequiredProperty_(key, minLength) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  const requiredLength = minLength || MIN_SECRET_LENGTH;
  assert_(value && String(value).length >= requiredLength, 'Server security config is missing.');
  return value;
}
function rateKeyPart_(value) {
  return String(value || '').replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 80);
}
function enforceRateLimit_(rule) {
  const lock = LockService.getScriptLock();
  lock.waitLock(3000);
  try {
    const cache = CacheService.getScriptCache();
    const now = Date.now();
    const raw = cache.get(rule.key);
    let state = raw ? JSON.parse(raw) : null;
    if (!state || !state.resetAt || now >= state.resetAt) {
      state = { count: 0, resetAt: now + rule.windowSeconds * 1000 };
    }
    state.count += 1;
    const ttl = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
    cache.put(rule.key, JSON.stringify(state), ttl);
    assert_(state.count <= rule.limit, rule.message || '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
  } finally {
    lock.releaseLock();
  }
}
function parseCell_(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}
function formatCell_(value) { return Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value; }
function sha256Hex_(value) { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)); }
function hmacHex_(value, secret) { return bytesToHex_(Utilities.computeHmacSha256Signature(value, secret)); }
function hashPassword_(password, salt) {
  return sha256Hex_(String(salt) + ':' + String(password) + ':' + getRequiredProperty_('GUESTBOOK_SERVER_PEPPER'));
}
function hashPasswordForEntry_(password, salt, algorithm, iterations) {
  if (String(algorithm).indexOf('PBKDF2-HMAC-SHA256') === 0) {
    const pepperedPassword = String(password) + getRequiredProperty_('GUESTBOOK_SERVER_PEPPER');
    return pbkdf2Sha256Hex_(pepperedPassword, String(salt), Number(iterations || PASSWORD_ITERATIONS || 50000));
  }
  return hashPassword_(password, salt);
}
function pbkdf2Sha256Hex_(password, salt, iterations) {
  const keyBytes = stringToBytes_(password);
  const blockIndex = [0, 0, 0, 1];
  let u = Utilities.computeHmacSha256Signature(stringToBytes_(salt).concat(blockIndex), keyBytes);
  const out = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, keyBytes);
    for (let j = 0; j < out.length; j++) out[j] = out[j] ^ u[j];
  }
  return bytesToHex_(out);
}
function stringToBytes_(value) {
  return Utilities.newBlob(value).getBytes();
}
function bytesToHex_(bytes) { return bytes.map((byte) => ('0' + ((byte < 0 ? byte + 256 : byte).toString(16))).slice(-2)).join(''); }
function constantTimeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
