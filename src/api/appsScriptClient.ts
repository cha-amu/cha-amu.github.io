import { config, isApiConfigured } from '../config';
import { getMockGuestbook, getMockPosts } from '../data/mockData';
import { translate } from '../i18n';
import type { AdminSession, ApiEnvelope, AssetOverride, GuestbookAdminEntry, GuestbookEntry, GuestbookIpBan, Post, Thing } from '../types';
import { readCache, readCachePayload, writeCache, type CachePayload } from '../utils/localCache';

export class ApiNotConfiguredError extends Error {
  constructor() {
    super('API URL is not configured. Set VITE_API_URL.');
    this.name = 'ApiNotConfiguredError';
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

// Anonymous list reads that Apps Script answers without the gateway secret.
const PUBLIC_READ_ACTIONS = new Set(['post.listPublic', 'guestbook.listPublic', 'assetOverride.listPublic', 'thing.listPublic']);
const PUBLIC_READ_TIMEOUT_MS = 12_000;

/**
 * Reads a public list straight from the Apps Script web app. Apps Script returns each
 * result once, through a redirect to an echo URL. Relayed through the Cloudflare gateway,
 * that echo request was often lost between Cloudflare's Tokyo/Hong Kong egress and Google,
 * so first-time visitors waited up to 50 seconds for an error. A browser reaches Google
 * directly and reliably, and these reads carry no secret the gateway would have to add.
 * Returns null when the transport fails so the caller can try the gateway instead.
 */
async function readPublicList<T>(action: string): Promise<{ data: T } | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), PUBLIC_READ_TIMEOUT_MS);
  let envelope: ApiEnvelope<T> | null = null;
  try {
    const response = await fetch(config.publicReadUrl, {
      method: 'POST',
      // text/plain keeps this a simple CORS request; Apps Script allows any origin.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (_) {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!envelope || typeof envelope.ok !== 'boolean') return null;
  if (!envelope.ok) throw new ApiRequestError(envelope.error || translate('errors.apiRequest', { status: 502 }), 502, envelope.code);
  // Every public list is an array. Anything else means doGet answered in place of the list.
  return Array.isArray(envelope.data) ? { data: envelope.data } : null;
}

async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isApiConfigured) throw new ApiNotConfiguredError();

  if (config.publicReadUrl && PUBLIC_READ_ACTIONS.has(action)) {
    const direct = await readPublicList<T>(action);
    if (direct) return direct.data;
    // Networks that block Google's script hosts still read through the gateway.
  }

  const usesGateway = Boolean(config.gatewayUrl && config.apiUrl === config.gatewayUrl);

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': usesGateway ? 'application/json' : 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  });

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (_) {
    if (!response.ok) throw new ApiRequestError(translate('errors.apiRequest', { status: response.status }), response.status);
    throw new ApiRequestError(translate('errors.invalidApiResponse'), response.status);
  }

  if (!response.ok || !envelope.ok) {
    throw new ApiRequestError(envelope.error || translate('errors.apiRequest', { status: response.status }), response.status, envelope.code);
  }
  return envelope.data as T;
}

function requireArrayResponse<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new ApiRequestError(translate('errors.invalidApiResponse'), 502);
  return value as T[];
}

const POSTS_CACHE_KEY = 'posts:v1';
const POST_CONTROLS_CACHE_KEY = 'posts-control:v1';
const ASSET_OVERRIDES_CACHE_KEY = 'asset-overrides:v1';
const GUESTBOOK_CACHE_KEY = 'guestbook:v1';
const THINGS_CACHE_KEY = 'things:v1';
const GUESTBOOK_CLIENT_ID_CACHE_KEY = 'guestbook-client-id:v1';
let sessionGuestbookClientId = '';

function createGuestbookClientId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getGuestbookClientId() {
  const cached = readCache<unknown>(GUESTBOOK_CLIENT_ID_CACHE_KEY);
  if (typeof cached === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(cached)) return cached;
  if (!sessionGuestbookClientId) sessionGuestbookClientId = createGuestbookClientId();
  writeCache(GUESTBOOK_CLIENT_ID_CACHE_KEY, sessionGuestbookClientId);
  return sessionGuestbookClientId;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).map((tag) => tag.trim()).filter(Boolean);
  const text = asString(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try { return normalizeTags(JSON.parse(text)); } catch (_) { /* fall through */ }
  }
  return text.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function normalizePostStatus(value: unknown): Post['status'] {
  return value === 'published' || value === 'hidden' || value === 'draft' || value === 'deleted' ? value : 'draft';
}

function markdownBaseUrl(bodyUrl: string, storagePath: string): string | undefined {
  const candidate = bodyUrl || (storagePath
    ? `${config.storageBaseUrl}/${storagePath.replace(/^\/+/, '')}`
    : '');
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return new URL('.', url).href;
  } catch (_) {
    return undefined;
  }
}

export function normalizePost(value: unknown): Post | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id || record.slug).trim();
  if (!id) return null;
  const source = record.source === 'storage' ? 'storage' : 'sheets';
  const storagePath = asString(record.storagePath).trim();
  const bodyUrl = asString(record.bodyUrl).trim();
  return {
    id,
    slug: asString(record.slug).trim() || undefined,
    title: asString(record.title).trim() || translate('common.untitled'),
    excerpt: asString(record.excerpt).trim(),
    body: asString(record.body || record.bodyMarkdown),
    tags: normalizeTags(record.tags),
    status: normalizePostStatus(record.status),
    createdAt: asString(record.createdAt || record.updatedAt || new Date().toISOString()),
    updatedAt: asString(record.updatedAt).trim() || undefined,
    publishedAt: asString(record.publishedAt).trim() || undefined,
    source,
    storagePath: storagePath || undefined,
    bodyUrl: bodyUrl || undefined,
    markdownBaseUrl: asString(record.markdownBaseUrl).trim() || markdownBaseUrl(bodyUrl, storagePath),
    markdownRootUrl: asString(record.markdownRootUrl).trim()
      || (storagePath || source === 'storage' ? config.storageBaseUrl : undefined)
  };
}

export function normalizePosts(values: unknown): Post[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalizePost).filter((post): post is Post => Boolean(post));
}

function normalizeAssetOverride(value: unknown): AssetOverride | null {
  const record = asRecord(value);
  if (!record) return null;
  const assetId = asString(record.assetId).trim();
  if (!assetId) return null;
  const status = record.status === 'visible' || record.status === 'hidden' || record.status === 'deleted'
    ? record.status
    : undefined;
  const sortOrder = typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder)
    ? record.sortOrder
    : undefined;
  return {
    assetId,
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    tags: Array.isArray(record.tags) ? normalizeTags(record.tags) : undefined,
    sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl : undefined,
    status,
    sortOrder,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined
  };
}

function normalizeAssetOverrides(values: unknown): AssetOverride[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeAssetOverride).filter((override): override is AssetOverride => Boolean(override));
}

function normalizeHttpUrl(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

export function normalizeThing(value: unknown): Thing | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id).trim();
  const title = asString(record.title).trim();
  const url = normalizeHttpUrl(record.url);
  if (!id || !title || !url) return null;
  const imageUrl = normalizeHttpUrl(record.imageUrl);
  const numericSortOrder = Number(record.sortOrder);
  return {
    id,
    title,
    description: asString(record.description),
    url,
    imageUrl: imageUrl || undefined,
    status: record.status === 'visible' ? 'visible' : 'hidden',
    sortOrder: Number.isSafeInteger(numericSortOrder) ? numericSortOrder : 0,
    updatedAt: asString(record.updatedAt)
  };
}

export function normalizeThings(values: unknown): Thing[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeThing).filter((thing): thing is Thing => Boolean(thing));
}

export function readCachedPosts(): Post[] {
  return normalizePosts(readCache<unknown>(POSTS_CACHE_KEY));
}

export function readCachedPostsPayload(): CachePayload<Post[]> | null {
  const payload = readCachePayload<unknown>(POSTS_CACHE_KEY);
  if (!payload) return null;
  return {
    savedAt: payload.savedAt,
    data: normalizePosts(payload.data)
  };
}

export function writeCachedPosts(posts: Post[]) {
  writeCache(POSTS_CACHE_KEY, normalizePosts(posts));
}

export function readCachedPostControls(): Post[] {
  return readCachedPostControlsPayload()?.data || [];
}

export function readCachedPostControlsPayload(): CachePayload<Post[]> | null {
  const payload = readCachePayload<unknown>(POST_CONTROLS_CACHE_KEY);
  if (!payload) return null;
  return {
    savedAt: payload.savedAt,
    data: normalizePosts(payload.data)
  };
}

export function writeCachedPostControls(posts: Post[]) {
  const controls = normalizePosts(posts)
    .filter((post) => post.status !== 'published')
    .map((post) => ({
      id: post.id,
      title: '',
      body: '',
      tags: [],
      status: post.status,
      createdAt: post.updatedAt || post.createdAt,
      updatedAt: post.updatedAt || post.createdAt
    } satisfies Post));
  writeCache(POST_CONTROLS_CACHE_KEY, controls);
}

export function readCachedAssetOverridesPayload(): CachePayload<AssetOverride[]> | null {
  const payload = readCachePayload<unknown>(ASSET_OVERRIDES_CACHE_KEY);
  if (!payload) return null;
  return {
    savedAt: payload.savedAt,
    data: normalizeAssetOverrides(payload.data)
  };
}

export function writeCachedAssetOverrides(overrides: AssetOverride[]) {
  writeCache(ASSET_OVERRIDES_CACHE_KEY, normalizeAssetOverrides(overrides));
}

export function readCachedGuestbook(): GuestbookEntry[] {
  return readCache<GuestbookEntry[]>(GUESTBOOK_CACHE_KEY) || [];
}

export function readCachedGuestbookPayload(): CachePayload<GuestbookEntry[]> | null {
  const payload = readCachePayload<GuestbookEntry[]>(GUESTBOOK_CACHE_KEY);
  if (!payload) return null;
  return {
    savedAt: payload.savedAt,
    data: Array.isArray(payload.data) ? payload.data : []
  };
}

export function writeCachedGuestbook(entries: GuestbookEntry[]) {
  writeCache(GUESTBOOK_CACHE_KEY, entries);
}

export function readCachedThingsPayload(): CachePayload<Thing[]> | null {
  const payload = readCachePayload<unknown>(THINGS_CACHE_KEY);
  if (!payload) return null;
  return {
    savedAt: payload.savedAt,
    data: normalizeThings(payload.data).filter((thing) => thing.status === 'visible')
  };
}

export function writeCachedThings(things: Thing[]) {
  writeCache(THINGS_CACHE_KEY, normalizeThings(things).filter((thing) => thing.status === 'visible'));
}

export async function listPosts(): Promise<Post[]> {
  try {
    const posts = requireArrayResponse<Post>(await request<unknown>('post.listPublic'));
    const normalizedPosts = normalizePosts(posts);
    writeCachedPostControls(normalizedPosts);
    return normalizedPosts;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return getMockPosts();
    throw error;
  }
}

export async function listGuestbook(): Promise<GuestbookEntry[]> {
  try {
    const entries = requireArrayResponse<GuestbookEntry>(await request<unknown>('guestbook.listPublic'));
    const visibleEntries = entries.filter((entry) => entry.status === 'visible');
    writeCachedGuestbook(visibleEntries);
    return visibleEntries;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return getMockGuestbook();
    throw error;
  }
}

export async function listAssetOverrides(): Promise<AssetOverride[]> {
  try {
    const overrides = normalizeAssetOverrides(requireArrayResponse<AssetOverride>(await request<unknown>('assetOverride.listPublic')));
    writeCachedAssetOverrides(overrides);
    return overrides;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return [];
    throw error;
  }
}

export async function listThings(): Promise<Thing[]> {
  const things = normalizeThings(requireArrayResponse<Thing>(await request<unknown>('thing.listPublic')))
    .filter((thing) => thing.status === 'visible');
  writeCachedThings(things);
  return things;
}

export async function createGuestbookEntry(input: {
  name: string;
  message: string;
  deletePassword: string;
  turnstileToken: string;
  website?: string;
}): Promise<GuestbookEntry> {
  return request<GuestbookEntry>('guestbook.create', { ...input, clientId: getGuestbookClientId() });
}

export async function hideGuestbookEntry(input: { id: string; deletePassword: string }): Promise<{ id: string }> {
  return request<{ id: string }>('guestbook.hideByPassword', { ...input, clientId: getGuestbookClientId() });
}

export async function adminLogin(input: { password: string; turnstileToken: string }): Promise<AdminSession> {
  return request<AdminSession>('admin.login', input);
}

export async function adminRefreshSession(token: string): Promise<AdminSession> {
  return request<AdminSession>('admin.session.refresh', { token });
}

export async function adminListPosts(token: string): Promise<Post[]> {
  return normalizePosts(requireArrayResponse<unknown>(await request<unknown>('admin.post.list', { token })));
}

export async function adminSavePost(token: string, post: Partial<Post>): Promise<Post> {
  const saved = normalizePost(await request<unknown>('admin.post.save', { token, post }));
  if (!saved) throw new ApiRequestError(translate('errors.invalidApiResponse'), 502);
  return saved;
}

export async function adminBulkUpdatePosts(token: string, ids: string[], status: Exclude<Post['status'], 'deleted'>): Promise<{ updatedIds: string[]; missingIds?: string[] }> {
  return request<{ updatedIds: string[]; missingIds?: string[] }>('admin.post.bulkStatus', { token, ids, status });
}

export async function adminBulkDeletePosts(token: string, ids: string[]): Promise<{ deletedIds: string[]; alreadyMissingIds?: string[] }> {
  return request<{ deletedIds: string[]; alreadyMissingIds?: string[] }>('admin.post.bulkDelete', { token, ids });
}

export async function adminListGuestbook(token: string): Promise<GuestbookAdminEntry[]> {
  return requireArrayResponse<GuestbookAdminEntry>(await request<unknown>('admin.guestbook.list', { token }));
}

export async function adminListGuestbookIpBans(token: string): Promise<GuestbookIpBan[]> {
  const result = await request<{ bans: GuestbookIpBan[] }>('admin.guestbook.ip.bans.list', { token });
  return Array.isArray(result.bans) ? result.bans : [];
}

export async function adminHideGuestbook(token: string, id: string, hiddenReason: string): Promise<{ id: string }> {
  return request<{ id: string }>('admin.guestbook.hide', { token, id, hiddenReason });
}

export async function adminRestoreGuestbook(token: string, id: string): Promise<{ id: string }> {
  return request<{ id: string }>('admin.guestbook.restore', { token, id });
}

export async function adminBulkUpdateGuestbook(
  token: string,
  ids: string[],
  status: 'visible' | 'hidden',
  hiddenReason = ''
): Promise<{ updatedIds: string[]; missingIds?: string[] }> {
  return request<{ updatedIds: string[]; missingIds?: string[] }>('admin.guestbook.bulkStatus', { token, ids, status, hiddenReason });
}

export async function adminBulkDeleteGuestbook(token: string, ids: string[]): Promise<{ deletedIds: string[]; alreadyMissingIds?: string[] }> {
  return request<{ deletedIds: string[]; alreadyMissingIds?: string[] }>('admin.guestbook.bulkDelete', { token, ids });
}

export async function adminBanGuestbookIp(token: string, entryId: string): Promise<{ entryId: string; relatedEntryCount?: number }> {
  return request<{ entryId: string; relatedEntryCount?: number }>('admin.guestbook.ip.ban', {
    token,
    entryId,
    reason: '관리자 수동 차단'
  });
}

export async function adminUnbanGuestbookIp(token: string, entryId: string): Promise<{ entryId: string; relatedEntryCount?: number }> {
  return request<{ entryId: string; relatedEntryCount?: number }>('admin.guestbook.ip.unban', { token, entryId });
}

export async function adminListAssetOverrides(token: string): Promise<AssetOverride[]> {
  const overrides = normalizeAssetOverrides(requireArrayResponse<AssetOverride>(await request<unknown>('admin.assetOverride.list', { token })));
  writeCachedAssetOverrides(overrides);
  return overrides;
}

export async function adminSaveAssetOverride(token: string, override: AssetOverride): Promise<AssetOverride> {
  const saved = await request<AssetOverride>('admin.assetOverride.save', { token, override });
  const normalized = normalizeAssetOverride(saved);
  if (!normalized) throw new ApiRequestError(translate('errors.invalidApiResponse'), 502);
  const cached = readCachedAssetOverridesPayload()?.data || [];
  writeCachedAssetOverrides([normalized, ...cached.filter((item) => item.assetId !== normalized.assetId)]);
  return normalized;
}

export async function adminBulkUpdateAssetOverrides(
  token: string,
  ids: string[],
  status: NonNullable<AssetOverride['status']>
): Promise<{ updatedIds: string[]; missingIds?: string[] }> {
  const result = await request<{ updatedIds: string[]; missingIds?: string[] }>('admin.assetOverride.bulkStatus', { token, ids, status });
  const updatedIds = new Set(result.updatedIds || []);
  if (updatedIds.size) {
    const now = new Date().toISOString();
    const cached = new Map((readCachedAssetOverridesPayload()?.data || []).map((override) => [override.assetId, override]));
    updatedIds.forEach((assetId) => cached.set(assetId, { ...(cached.get(assetId) || { assetId }), status, updatedAt: now }));
    writeCachedAssetOverrides(Array.from(cached.values()));
  }
  return result;
}

export async function adminListThings(token: string): Promise<Thing[]> {
  return normalizeThings(requireArrayResponse<Thing>(await request<unknown>('admin.thing.list', { token })));
}

export async function adminSaveThing(token: string, thing: Partial<Thing>): Promise<Thing> {
  const saved = normalizeThing(await request<unknown>('admin.thing.save', { token, thing }));
  if (!saved) throw new ApiRequestError(translate('errors.invalidApiResponse'), 502);
  return saved;
}

export async function adminDeleteThings(token: string, ids: string[]): Promise<{ deletedIds: string[]; alreadyMissingIds?: string[] }> {
  return request<{ deletedIds: string[]; alreadyMissingIds?: string[] }>('admin.thing.delete', { token, ids });
}
