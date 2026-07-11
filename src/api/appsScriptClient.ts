import { config, isApiConfigured } from '../config';
import { mockGuestbook, mockPosts } from '../data/mockData';
import type { AdminSession, ApiEnvelope, AssetOverride, GuestbookAdminEntry, GuestbookEntry, GuestbookIpBan, Post } from '../types';
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

async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isApiConfigured) throw new ApiNotConfiguredError();

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
    if (!response.ok) throw new ApiRequestError(`API 요청에 실패했습니다. (${response.status})`, response.status);
    throw new ApiRequestError('API 응답 형식이 올바르지 않습니다.', response.status);
  }

  if (!response.ok || !envelope.ok) {
    throw new ApiRequestError(envelope.error || `API 요청에 실패했습니다. (${response.status})`, response.status, envelope.code);
  }
  return envelope.data as T;
}

const POSTS_CACHE_KEY = 'posts:v1';
const GUESTBOOK_CACHE_KEY = 'guestbook:v1';
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
  return value === 'published' || value === 'hidden' || value === 'draft' ? value : 'draft';
}

export function normalizePost(value: unknown): Post | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id || record.slug).trim();
  if (!id) return null;
  return {
    id,
    slug: asString(record.slug).trim() || undefined,
    title: asString(record.title).trim() || '(제목 없음)',
    excerpt: asString(record.excerpt).trim(),
    body: asString(record.body || record.bodyMarkdown),
    tags: normalizeTags(record.tags),
    status: normalizePostStatus(record.status),
    createdAt: asString(record.createdAt || record.updatedAt || new Date().toISOString()),
    updatedAt: asString(record.updatedAt).trim() || undefined,
    publishedAt: asString(record.publishedAt).trim() || undefined,
    source: record.source === 'storage' ? 'storage' : 'sheets',
    storagePath: asString(record.storagePath).trim() || undefined,
    bodyUrl: asString(record.bodyUrl).trim() || undefined
  };
}

export function normalizePosts(values: unknown): Post[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalizePost).filter((post): post is Post => Boolean(post));
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

export async function listPosts(): Promise<Post[]> {
  try {
    const posts = await request<Post[]>('post.listPublic');
    const publicPosts = normalizePosts(posts).filter((post) => post.status === 'published');
    writeCachedPosts(publicPosts);
    return publicPosts;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return mockPosts;
    throw error;
  }
}

export async function listGuestbook(): Promise<GuestbookEntry[]> {
  try {
    const entries = await request<GuestbookEntry[]>('guestbook.listPublic');
    const visibleEntries = entries.filter((entry) => entry.status === 'visible');
    writeCachedGuestbook(visibleEntries);
    return visibleEntries;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return mockGuestbook;
    throw error;
  }
}

export async function listAssetOverrides(): Promise<AssetOverride[]> {
  try {
    return await request<AssetOverride[]>('assetOverride.listPublic');
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return [];
    throw error;
  }
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
  return request<Post[]>('admin.post.list', { token });
}

export async function adminSavePost(token: string, post: Partial<Post>): Promise<Post> {
  return request<Post>('admin.post.save', { token, post });
}

export async function adminListGuestbook(token: string): Promise<GuestbookAdminEntry[]> {
  return request<GuestbookAdminEntry[]>('admin.guestbook.list', { token });
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
  return request<AssetOverride[]>('admin.assetOverride.list', { token });
}

export async function adminSaveAssetOverride(token: string, override: AssetOverride): Promise<AssetOverride> {
  return request<AssetOverride>('admin.assetOverride.save', { token, override });
}
