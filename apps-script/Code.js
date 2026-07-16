/**
 * Cha-amu Apps Script API.
 * Runtime secrets live in Script Properties, synced from GitHub Actions secrets during deployment.
 */
const SHEETS = {
  posts: 'posts',
  postDeletions: 'postDeletions',
  guestbook: 'guestbook',
  things: 'things',
  assetOverrides: 'assetOverrides',
  settings: 'settings',
  auditLog: 'auditLog'
};


const SHEET_COLUMNS = {
  posts: [
    'id', 'slug', 'title', 'excerpt', 'body', 'tags', 'status',
    'createdAt', 'updatedAt', 'publishedAt', 'source', 'storagePath',
    'bodyUrl', 'syncStatus'
  ],
  postDeletions: ['id', 'storagePath', 'nonce', 'deletedAt', 'finalizedAt'],
  guestbook: [
    'id', 'name', 'message', 'status', 'createdAt', 'passwordSalt',
    'passwordHash', 'passwordHashAlgorithm', 'passwordHashIterations', 'hiddenReason'
  ],
  things: ['id', 'title', 'description', 'url', 'status', 'sortOrder', 'updatedAt'],
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
const DEFAULT_GUESTBOOK_NAME = 'ㅇㅁ';
const MIN_SECRET_LENGTH = 32;
const MAX_BULK_ITEMS = 100;
const PUBLIC_CACHE_TTL_SECONDS = Math.max(1, Number(getProperty_('PUBLIC_CACHE_TTL_SECONDS', '300')) || 300);
const PUBLIC_CACHE_KEYS = {
  posts: 'public:posts:v2',
  guestbook: 'public:guestbook:v1',
  things: 'public:things:v1'
};
const RATE_LIMITS = {
  adminLoginEmergencyWindow: { key: 'admin-login-emergency-window', limit: 120, windowSeconds: 3600, message: '관리자 로그인 요청이 일시적으로 많습니다. 나중에 다시 시도하세요.' },
  guestbookCreateBurst: { key: 'guestbook-create-burst', limit: 1, windowSeconds: 10, message: '방명록 작성이 너무 빠릅니다. 잠시 후 다시 시도하세요.' },
  guestbookCreateWindow: { key: 'guestbook-create-window', limit: 12, windowSeconds: 3600, message: '방명록 작성이 너무 많습니다. 나중에 다시 시도하세요.' },
  guestbookClientDuplicateWindow: { key: 'guestbook-client-duplicate-window', limit: 1, windowSeconds: 600, message: '같은 메시지가 반복되어 잠시 제한했습니다.' },
  guestbookGlobalDuplicateWindow: { key: 'guestbook-global-duplicate-window', limit: 2, windowSeconds: 600, message: '같은 긴 메시지가 반복되어 잠시 제한했습니다.' },
  guestbookEmergencyWindow: { key: 'guestbook-emergency-window', limit: 120, windowSeconds: 3600, message: '방명록 요청이 일시적으로 많습니다. 나중에 다시 시도하세요.' },
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
  if (!isPublicAction_(action) && action !== 'setup.properties') requireGateway_(body.gatewaySecret);
  switch (action) {
    case 'post.listPublic': return listPublicPosts_();
    case 'guestbook.listPublic': return listPublicGuestbook_();
    case 'assetOverride.listPublic': return listPublicAssetOverrides_();
    case 'thing.listPublic': return listPublicThings_();
    case 'guestbook.create': return createGuestbook_(body);
    case 'guestbook.hideByPassword': return hideGuestbookByPassword_(body);
    case 'admin.login': return adminLogin_(body);
    case 'admin.session.verify': requireAdmin_(body.token); return { valid: true };
    case 'admin.session.refresh': requireAdmin_(body.token); return createAdminSession_();
    case 'admin.post.list': requireAdmin_(body.token); return rowsToObjects_(SHEETS.posts);
    case 'admin.post.save': requireAdmin_(body.token); return savePost_(body.post);
    case 'admin.post.bulkStatus': requireAdmin_(body.token); return bulkPostStatus_(body);
    case 'admin.post.bulkDelete': requireAdmin_(body.token); return bulkDeletePosts_(body);
    case 'admin.guestbook.list': requireAdmin_(body.token); return listAdminGuestbook_();
    case 'admin.guestbook.hide': requireAdmin_(body.token); return adminHideGuestbook_(body);
    case 'admin.guestbook.restore': requireAdmin_(body.token); return adminRestoreGuestbook_(body);
    case 'admin.guestbook.bulkStatus': requireAdmin_(body.token); return bulkGuestbookStatus_(body);
    case 'admin.guestbook.bulkDelete': requireAdmin_(body.token); return bulkDeleteGuestbook_(body);
    case 'admin.assetOverride.list': requireAdmin_(body.token); return rowsToObjects_(SHEETS.assetOverrides);
    case 'admin.assetOverride.save': requireAdmin_(body.token); return saveAssetOverride_(body.override);
    case 'admin.assetOverride.bulkStatus': requireAdmin_(body.token); return bulkAssetOverrideStatus_(body);
    case 'admin.assetOverride.delete': requireAdmin_(body.token); return bulkDeleteAssetOverrides_(body);
    case 'admin.thing.list': requireAdmin_(body.token); return rowsToObjects_(SHEETS.things);
    case 'admin.thing.save': requireAdmin_(body.token); return saveThing_(body.thing);
    case 'admin.thing.delete': requireAdmin_(body.token); return deleteThings_(body);
    case 'storage.sync.post.list': return rowsToObjects_(SHEETS.posts);
    case 'storage.sync.post.save': return syncPostFromStorage_(body.post);
    case 'storage.sync.postDeletion.list': return listPostDeletions_();
    case 'storage.sync.postDeletion.finalize': return finalizePostDeletions_(body);
    case 'storage.sync.assetOverride.list': return rowsToObjects_(SHEETS.assetOverrides);
    case 'storage.sync.assetOverride.save': return saveAssetOverride_(body.override);
    case 'storage.sync.assetOverride.delete': return bulkDeleteAssetOverrides_(body);
    default: throw new Error('Unknown action: ' + action);
  }
}

function isPublicAction_(action) {
  return action === 'post.listPublic' || action === 'guestbook.listPublic' || action === 'assetOverride.listPublic' || action === 'thing.listPublic';
}

function requireGateway_(secret) {
  const expected = getRequiredProperty_('GATEWAY_SHARED_SECRET');
  assert_(constantTimeEqual_(expected, secret), 'Security gateway authentication failed.');
}

function listPublicPosts_() {
  return readPublicCache_(PUBLIC_CACHE_KEYS.posts, function () {
    const deletions = rowsToObjects_(SHEETS.postDeletions);
    const deletedIds = new Set(deletions.map(function (entry) { return String(entry.id || ''); }).filter(Boolean));
    const records = rowsToObjects_(SHEETS.posts)
      .filter(function (post) { return post.id && !deletedIds.has(String(post.id)); })
      .map(function (post) {
        if (post.status === 'published') return post;
        return {
          id: String(post.id),
          status: String(post.status || 'hidden'),
          updatedAt: post.updatedAt || post.createdAt || ''
        };
      });
    deletions.forEach(function (entry) {
      if (!entry.id) return;
      records.push({ id: String(entry.id), status: 'deleted', updatedAt: entry.deletedAt || '' });
    });
    return records;
  });
}

function listPublicGuestbook_() {
  return readPublicCache_(PUBLIC_CACHE_KEYS.guestbook, function () {
    return rowsToObjects_(SHEETS.guestbook)
      .filter((entry) => entry.status === 'visible')
      .map((entry) => ({ id: String(entry.id), name: String(entry.name || '').trim() || DEFAULT_GUESTBOOK_NAME, message: String(entry.message || ''), status: entry.status, createdAt: entry.createdAt }));
  });
}

function listPublicAssetOverrides_() {
  return rowsToObjects_(SHEETS.assetOverrides);
}

function listPublicThings_() {
  return readPublicCache_(PUBLIC_CACHE_KEYS.things, function () {
    return rowsToObjects_(SHEETS.things)
      .filter(function (thing) { return thing.id && thing.status === 'visible'; })
      .map(function (thing) {
        return {
          id: String(thing.id),
          title: String(thing.title || ''),
          description: String(thing.description || ''),
          url: String(thing.url || ''),
          status: 'visible',
          sortOrder: Number(thing.sortOrder || 0),
          updatedAt: String(thing.updatedAt || '')
        };
      })
      .sort(function (left, right) {
        return left.sortOrder - right.sortOrder || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
      });
  });
}

function createGuestbook_(body) {
  const gatewayEntryId = String(body.gatewayEntryId || '').trim();
  const name = String(body.name || '').trim() || DEFAULT_GUESTBOOK_NAME;
  const message = String(body.message || '').trim().slice(0, 1000);
  const deletePassword = String(body.deletePassword || '');
  assert_(!String(body.website || '').trim(), '요청을 처리할 수 없습니다.');
  assert_(message && deletePassword, '메시지와 비밀번호를 입력해야 합니다.');
  assert_(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gatewayEntryId), 'Security gateway entry id is missing.');
  const clientScope = guestbookClientScope_(body);
  enforceRateLimit_(scopedRateLimit_(RATE_LIMITS.guestbookCreateBurst, clientScope));
  enforceRateLimit_(scopedRateLimit_(RATE_LIMITS.guestbookCreateWindow, clientScope));
  const messageKey = guestbookMessageKey_(message);
  enforceRateLimit_(scopedRateLimit_(RATE_LIMITS.guestbookClientDuplicateWindow, clientScope + ':' + messageKey));
  if (normalizeGuestbookMessage_(message).length >= 20) {
    enforceRateLimit_(scopedRateLimit_(RATE_LIMITS.guestbookGlobalDuplicateWindow, messageKey));
  }
  enforceRateLimit_(RATE_LIMITS.guestbookEmergencyWindow);
  const salt = Utilities.getUuid();
  const passwordHash = hashPassword_(deletePassword, salt);
  const entry = {
    id: gatewayEntryId,
    name: literalSheetText_(name.slice(0, 40)),
    message: literalSheetText_(message),
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
  return { id: entry.id, name: name.slice(0, 40), message, status: entry.status, createdAt: entry.createdAt };
}

function hideGuestbookByPassword_(body) {
  assert_(body.id, 'Guestbook entry id is required.');
  assert_(body.deletePassword, '비밀번호를 입력해야 합니다.');
  enforceRateLimit_(scopedRateLimit_(RATE_LIMITS.guestbookDeleteWindow, guestbookClientScope_(body)));
  enforceRateLimit_(Object.assign({}, RATE_LIMITS.guestbookDeleteEntryWindow, { key: RATE_LIMITS.guestbookDeleteEntryWindow.key + ':' + rateKeyPart_(body.id) }));
  const result = withScriptLock_(function () {
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
        return { id: body.id };
      }
    }
    throw new Error('Guestbook entry not found.');
  });
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
  return result;
}

function adminLogin_(body) {
  enforceRateLimit_(RATE_LIMITS.adminLoginEmergencyWindow);
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
  withScriptLock_(function () {
    assertPostIdNotDeleted_(next.id);
    upsertObject_(SHEETS.posts, 'id', next);
  });
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.posts);
  audit_('post.save', 'post', next.id);
  return next;
}

function syncPostFromStorage_(post) {
  assert_(post && post.id, 'Post id is required.');
  const next = Object.assign({}, post, {
    tags: Array.isArray(post.tags) ? post.tags : [],
    updatedAt: post.updatedAt || post.publishedAt || post.createdAt || new Date().toISOString(),
    createdAt: post.createdAt || post.publishedAt || new Date().toISOString(),
    publishedAt: post.publishedAt || (post.status === 'published' ? (post.createdAt || new Date().toISOString()) : ''),
    source: 'storage',
    syncStatus: 'synced'
  });
  withScriptLock_(function () {
    assertPostIdNotDeleted_(next.id);
    upsertObject_(SHEETS.posts, 'id', next);
  });
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.posts);
  audit_('post.syncFromStorage', 'post', next.id);
  return next;
}

function saveAssetOverride_(override) {
  assert_(override && override.assetId, 'assetId is required.');
  const next = Object.assign({}, override, { updatedAt: new Date().toISOString() });
  withScriptLock_(function () {
    upsertObject_(SHEETS.assetOverrides, 'assetId', next);
  });
  audit_('assetOverride.update', 'asset', next.assetId);
  return next;
}

function validateThingUrl_(value) {
  const url = String(value || '').trim();
  assert_(url && url.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(url), 'Thing URL must be an absolute HTTP or HTTPS URL.');
  assert_(!/^https?:\/\/[^/?#]*@/i.test(url), 'Thing URL must not contain credentials.');
  const match = url.match(/^https?:\/\/(\[[0-9a-f:.]+\]|[^/?#:@\\\s]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i);
  assert_(match, 'Thing URL must contain a valid hostname.');
  const hostname = match[1];
  const validHostname = hostname[0] === '['
    ? /^\[[0-9a-f]*:[0-9a-f:.]*\]$/i.test(hostname)
    : hostname !== '.' && hostname[0] !== '.' && hostname.indexOf('..') === -1;
  assert_(validHostname && (!match[2] || Number(match[2]) <= 65535), 'Thing URL must contain a valid hostname.');
  return url;
}

function validateThingId_(value) {
  const id = String(value || '').trim();
  assert_(id && id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id) && !/^[=+\-@]/.test(id), 'Invalid thing id.');
  return id;
}

function saveThing_(thing) {
  assert_(thing && typeof thing === 'object' && !Array.isArray(thing), 'Thing is required.');
  const requestedId = String(thing.id || '').trim();
  const id = requestedId ? validateThingId_(requestedId) : Utilities.getUuid();
  const title = String(thing.title || '').trim();
  const description = String(thing.description || '');
  const status = String(thing.status || 'visible');
  const sortOrder = Number(thing.sortOrder);
  assert_(title && title.length <= 160 && !/[\u0000-\u001f\u007f]/.test(title), 'Invalid thing title.');
  assert_(description.length <= 2000, 'Thing description is too long.');
  assert_(['visible', 'hidden'].indexOf(status) >= 0, 'Invalid thing status.');
  assert_(Number.isSafeInteger(sortOrder) && Math.abs(sortOrder) <= 1000000000, 'Invalid thing sort order.');
  const url = validateThingUrl_(thing.url);
  const updatedAt = new Date().toISOString();
  const next = { id, title, description, url, status, sortOrder, updatedAt };
  const stored = Object.assign({}, next, {
    title: literalSheetText_(title),
    description: literalSheetText_(description)
  });
  withScriptLock_(function () {
    upsertObject_(SHEETS.things, 'id', stored);
  });
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.things);
  audit_('thing.save', 'thing', id);
  return next;
}

function deleteThings_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Thing ids', 128).map(validateThingId_);
  const result = withScriptLock_(function () {
    return deleteSheetRowsByIds_(SHEETS.things, 'id', ids);
  });
  if (result.deletedIds.length) invalidatePublicCache_(PUBLIC_CACHE_KEYS.things);
  result.deletedIds.forEach(function (id) { audit_('thing.delete', 'thing', id); });
  return result;
}

function bulkPostStatus_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Post ids', 512);
  const status = String(body.status || '');
  assert_(['published', 'draft', 'hidden'].indexOf(status) >= 0, 'Invalid post status.');
  const now = new Date().toISOString();
  const result = withScriptLock_(function () {
    const table = indexedSheet_(SHEETS.posts, 'id');
    const updatedIds = [];
    const missingIds = [];
    ids.forEach(function (id) {
      const row = table.byId.get(id);
      if (!row) {
        missingIds.push(id);
        return;
      }
      patchTableCell_(table, row, 'status', status);
      patchTableCell_(table, row, 'updatedAt', now);
      if (status === 'published' && !row.values[table.headers.indexOf('publishedAt')]) {
        patchTableCell_(table, row, 'publishedAt', now);
      }
      updatedIds.push(id);
    });
    return { updatedIds, missingIds };
  });
  if (result.updatedIds.length) {
    invalidatePublicCache_(PUBLIC_CACHE_KEYS.posts);
    result.updatedIds.forEach(function (id) { audit_('post.bulkStatus', 'post', id); });
  }
  return result;
}

function bulkDeletePosts_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Post ids', 512);
  const now = new Date().toISOString();
  let tombstonesChanged = false;
  const result = withScriptLock_(function () {
    const posts = indexedSheet_(SHEETS.posts, 'id');
    const deletions = indexedSheet_(SHEETS.postDeletions, 'id');
    const deletedIds = [];
    const alreadyMissingIds = [];
    const rowNumbers = [];
    const storagePathIndex = posts.headers.indexOf('storagePath');

    ids.forEach(function (id) {
      const postRow = posts.byId.get(id);
      const storagePath = postRow && storagePathIndex >= 0 ? String(postRow.values[storagePathIndex] || '') : '';
      const deletionRow = deletions.byId.get(id);
      if (deletionRow) {
        const deletionStoragePathIndex = deletions.headers.indexOf('storagePath');
        const deletionNonceIndex = deletions.headers.indexOf('nonce');
        const deletedAtIndex = deletions.headers.indexOf('deletedAt');
        if (storagePath && !deletionRow.values[deletionStoragePathIndex]) {
          patchTableCell_(deletions, deletionRow, 'storagePath', storagePath);
          tombstonesChanged = true;
        }
        if (!deletionRow.values[deletionNonceIndex]) {
          patchTableCell_(deletions, deletionRow, 'nonce', Utilities.getUuid());
          tombstonesChanged = true;
        }
        if (!deletionRow.values[deletedAtIndex]) {
          patchTableCell_(deletions, deletionRow, 'deletedAt', now);
          tombstonesChanged = true;
        }
      } else {
        appendObject_(SHEETS.postDeletions, {
          id,
          storagePath,
          nonce: Utilities.getUuid(),
          deletedAt: now
        });
        tombstonesChanged = true;
      }

      if (!postRow) {
        alreadyMissingIds.push(id);
        return;
      }
      rowNumbers.push(postRow.rowNumber);
      deletedIds.push(id);
    });

    deleteRowsDescending_(posts.sheet, rowNumbers);
    return { deletedIds, alreadyMissingIds };
  });
  if (result.deletedIds.length || tombstonesChanged) {
    invalidatePublicCache_(PUBLIC_CACHE_KEYS.posts);
  }
  if (result.deletedIds.length) {
    result.deletedIds.forEach(function (id) { audit_('post.bulkDelete', 'post', id); });
  }
  return result;
}

function listPostDeletions_() {
  const sheet = getSheet_(SHEETS.postDeletions);
  ensureHeaders_(sheet, SHEET_COLUMNS.postDeletions);
  return rowsToObjects_(SHEETS.postDeletions).filter(function (entry) {
    return !String(entry.finalizedAt || '').trim();
  }).map(function (entry) {
    return {
      id: String(entry.id || ''),
      storagePath: String(entry.storagePath || ''),
      nonce: String(entry.nonce || ''),
      deletedAt: String(entry.deletedAt || '')
    };
  }).filter(function (entry) { return entry.id && entry.nonce; });
}

function finalizePostDeletions_(body) {
  const requested = normalizeDeletionRequests_(body.deletions);
  const result = withScriptLock_(function () {
    const table = indexedSheet_(SHEETS.postDeletions, 'id');
    const finalizedAtIndex = table.headers.indexOf('finalizedAt');
    const finalizedIds = [];
    const alreadyMissingIds = [];
    const rowsToFinalize = [];

    requested.forEach(function (request) {
      const row = table.byId.get(request.id);
      if (!row || row.values[finalizedAtIndex]) {
        alreadyMissingIds.push(request.id);
        return;
      }
      const nonce = String(row.values[table.headers.indexOf('nonce')] || '');
      assert_(constantTimeEqual_(nonce, request.nonce), 'Post deletion nonce is invalid.');
      finalizedIds.push(request.id);
      rowsToFinalize.push(row);
    });

    const finalizedAt = new Date().toISOString();
    rowsToFinalize.forEach(function (row) {
      patchTableCell_(table, row, 'finalizedAt', finalizedAt);
    });
    return { finalizedIds, alreadyMissingIds };
  });
  if (result.finalizedIds.length) {
    invalidatePublicCache_(PUBLIC_CACHE_KEYS.posts);
    result.finalizedIds.forEach(function (id) { audit_('postDeletion.finalize', 'post', id); });
  }
  return result;
}

function bulkGuestbookStatus_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Guestbook ids', 128);
  const status = String(body.status || '');
  assert_(['visible', 'hidden'].indexOf(status) >= 0, 'Invalid guestbook status.');
  const hasReason = Object.prototype.hasOwnProperty.call(body, 'hiddenReason');
  if (hasReason) assert_(typeof body.hiddenReason === 'string' && body.hiddenReason.length <= 500, 'Invalid hidden reason.');
  const hiddenReason = hasReason ? body.hiddenReason.trim() : '';
  const result = withScriptLock_(function () {
    const table = indexedSheet_(SHEETS.guestbook, 'id');
    const updatedIds = [];
    const missingIds = [];
    ids.forEach(function (id) {
      const row = table.byId.get(id);
      if (!row) {
        missingIds.push(id);
        return;
      }
      patchTableCell_(table, row, 'status', status);
      if (status === 'visible') patchTableCell_(table, row, 'hiddenReason', '');
      else if (hasReason) patchTableCell_(table, row, 'hiddenReason', hiddenReason);
      updatedIds.push(id);
    });
    return { updatedIds, missingIds };
  });
  if (result.updatedIds.length) {
    invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
    result.updatedIds.forEach(function (id) { audit_('guestbook.bulkStatus', 'guestbook', id); });
  }
  return result;
}

function bulkDeleteGuestbook_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Guestbook ids', 128);
  const result = withScriptLock_(function () {
    return deleteSheetRowsByIds_(SHEETS.guestbook, 'id', ids);
  });
  if (result.deletedIds.length) {
    invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
    result.deletedIds.forEach(function (id) { audit_('guestbook.bulkDelete', 'guestbook', id); });
  }
  return result;
}

function bulkAssetOverrideStatus_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Asset ids', 512);
  const status = String(body.status || '');
  assert_(['visible', 'hidden', 'deleted'].indexOf(status) >= 0, 'Invalid asset override status.');
  const now = new Date().toISOString();
  const result = withScriptLock_(function () {
    const table = indexedSheet_(SHEETS.assetOverrides, 'assetId');
    ids.forEach(function (id) {
      const row = table.byId.get(id);
      if (row) {
        patchTableCell_(table, row, 'status', status);
        patchTableCell_(table, row, 'updatedAt', now);
      } else {
        appendObject_(SHEETS.assetOverrides, { assetId: id, status, updatedAt: now });
      }
    });
    return { updatedIds: ids.slice(), missingIds: [] };
  });
  result.updatedIds.forEach(function (id) { audit_('assetOverride.bulkStatus', 'asset', id); });
  return result;
}

function bulkDeleteAssetOverrides_(body) {
  const ids = normalizeBulkIds_(body.ids, 'Asset ids', 512);
  const result = withScriptLock_(function () {
    return deleteSheetRowsByIds_(SHEETS.assetOverrides, 'assetId', ids);
  });
  result.deletedIds.forEach(function (id) { audit_('assetOverride.delete', 'asset', id); });
  return result;
}

function listAdminGuestbook_() {
  return rowsToObjects_(SHEETS.guestbook).map(function (entry) {
    return {
      id: String(entry.id),
      name: String(entry.name || '').trim() || DEFAULT_GUESTBOOK_NAME,
      message: String(entry.message || ''),
      status: entry.status,
      createdAt: entry.createdAt,
      hiddenReason: String(entry.hiddenReason || '')
    };
  });
}

function adminHideGuestbook_(body) {
  const result = withScriptLock_(function () {
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
        return { id: body.id };
      }
    }
    throw new Error('Guestbook entry not found.');
  });
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
  audit_('guestbook.hide', 'guestbook', body.id);
  return result;
}

function adminRestoreGuestbook_(body) {
  const result = withScriptLock_(function () {
    const sheet = getSheet_(SHEETS.guestbook);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIndex = headers.indexOf('id');
    const statusIndex = headers.indexOf('status');
    const reasonIndex = headers.indexOf('hiddenReason');
    for (let row = 1; row < values.length; row++) {
      if (values[row][idIndex] === body.id) {
        sheet.getRange(row + 1, statusIndex + 1).setValue('visible');
        if (reasonIndex >= 0) sheet.getRange(row + 1, reasonIndex + 1).setValue('');
        return { id: body.id };
      }
    }
    throw new Error('Guestbook entry not found.');
  });
  invalidatePublicCache_(PUBLIC_CACHE_KEYS.guestbook);
  audit_('guestbook.restore', 'guestbook', body.id);
  return result;
}

function normalizeBulkIds_(value, label, maxLength) {
  assert_(Array.isArray(value), label + ' must be an array.');
  assert_(value.length > 0 && value.length <= MAX_BULK_ITEMS, label + ' must contain 1 to ' + MAX_BULK_ITEMS + ' items.');
  const seen = new Set();
  return value.map(function (raw) {
    assert_(typeof raw === 'string', label + ' must contain only strings.');
    const id = raw.trim();
    assert_(id && id.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(id), 'Invalid id.');
    assert_(!seen.has(id), label + ' must contain unique ids.');
    seen.add(id);
    return id;
  });
}

function assertPostIdNotDeleted_(id) {
  const deletions = indexedSheet_(SHEETS.postDeletions, 'id');
  assert_(!deletions.byId.has(String(id || '').trim()), 'Post id is permanently deleted and cannot be saved.');
}

function normalizeDeletionRequests_(value) {
  assert_(Array.isArray(value), 'Post deletions must be an array.');
  assert_(value.length > 0 && value.length <= MAX_BULK_ITEMS, 'Post deletions must contain 1 to ' + MAX_BULK_ITEMS + ' items.');
  const seen = new Set();
  return value.map(function (raw) {
    assert_(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid post deletion request.');
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const nonce = typeof raw.nonce === 'string' ? raw.nonce.trim() : '';
    assert_(id && id.length <= 512 && !/[\u0000-\u001f\u007f]/.test(id), 'Invalid post deletion id.');
    assert_(nonce && nonce.length <= 128 && !/[\u0000-\u001f\u007f]/.test(nonce), 'Invalid post deletion nonce.');
    assert_(!seen.has(id), 'Post deletions must contain unique ids.');
    seen.add(id);
    return { id, nonce };
  });
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function indexedSheet_(sheetName, key) {
  const sheet = getSheet_(sheetName);
  const columns = SHEET_COLUMNS[sheetName];
  if (columns) ensureHeaders_(sheet, columns);
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const keyIndex = headers.indexOf(key);
  assert_(keyIndex >= 0, sheetName + ' key column is not initialized.');
  const byId = new Map();
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const id = String(values[rowIndex][keyIndex] || '').trim();
    if (!id) continue;
    assert_(!byId.has(id), sheetName + ' contains duplicate ids.');
    byId.set(id, { rowNumber: rowIndex + 1, values: values[rowIndex] });
  }
  return { sheet, headers, byId };
}

function patchTableCell_(table, row, key, value) {
  const columnIndex = table.headers.indexOf(key);
  assert_(columnIndex >= 0, key + ' column is not initialized.');
  const formatted = formatCell_(value);
  table.sheet.getRange(row.rowNumber, columnIndex + 1).setValue(formatted);
  row.values[columnIndex] = formatted;
}

function deleteRowsDescending_(sheet, rowNumbers) {
  rowNumbers.slice().sort(function (left, right) { return right - left; }).forEach(function (rowNumber) {
    sheet.deleteRow(rowNumber);
  });
}

function deleteSheetRowsByIds_(sheetName, key, ids) {
  const table = indexedSheet_(sheetName, key);
  const deletedIds = [];
  const alreadyMissingIds = [];
  const rowNumbers = [];
  ids.forEach(function (id) {
    const row = table.byId.get(id);
    if (!row) {
      alreadyMissingIds.push(id);
      return;
    }
    deletedIds.push(id);
    rowNumbers.push(row.rowNumber);
  });
  deleteRowsDescending_(table.sheet, rowNumbers);
  return { deletedIds, alreadyMissingIds };
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
function scopedRateLimit_(rule, scope) {
  return Object.assign({}, rule, { key: rule.key + ':' + rateKeyPart_(scope) });
}
function guestbookClientScope_(body) {
  const clientId = String(body.clientId || '').trim();
  const validClientId = /^[A-Za-z0-9_-]{16,128}$/.test(clientId);
  const source = validClientId ? 'client:' + clientId : 'password:' + String(body.deletePassword || '');
  return hmacHex_(source, getRequiredProperty_('GUESTBOOK_SERVER_PEPPER')).slice(0, 32);
}
function guestbookMessageKey_(message) {
  return sha256Hex_(normalizeGuestbookMessage_(message)).slice(0, 32);
}
function normalizeGuestbookMessage_(message) {
  return String(message || '').trim().slice(0, 1000).replace(/\s+/g, ' ').toLowerCase();
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
function literalSheetText_(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
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
