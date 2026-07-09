import { config, isAppsScriptConfigured } from '../config';
import { mockGuestbook, mockPosts } from '../data/mockData';
import type { AdminSession, ApiEnvelope, AssetOverride, GuestbookEntry, Post } from '../types';
import { readCache, readCachePayload, writeCache, type CachePayload } from '../utils/localCache';

export class ApiNotConfiguredError extends Error {
  constructor() {
    super('Apps Script URL is not configured. Set VITE_APPS_SCRIPT_URL.');
    this.name = 'ApiNotConfiguredError';
  }
}

async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isAppsScriptConfigured) throw new ApiNotConfiguredError();

  const response = await fetch(config.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  });

  if (!response.ok) {
    throw new Error(`Apps Script request failed: ${response.status}`);
  }

  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!envelope.ok) {
    throw new Error(envelope.error || 'Apps Script returned an error.');
  }
  return envelope.data as T;
}

const POSTS_CACHE_KEY = 'posts:v1';
const GUESTBOOK_CACHE_KEY = 'guestbook:v1';

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
}): Promise<GuestbookEntry> {
  return request<GuestbookEntry>('guestbook.create', input);
}

export async function hideGuestbookEntry(input: { id: string; deletePassword: string }): Promise<{ id: string }> {
  return request<{ id: string }>('guestbook.hideByPassword', input);
}

export async function adminLogin(input: { password: string }): Promise<AdminSession> {
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

export async function adminHideGuestbook(token: string, id: string, hiddenReason: string): Promise<{ id: string }> {
  return request<{ id: string }>('admin.guestbook.hide', { token, id, hiddenReason });
}

export async function adminListAssetOverrides(token: string): Promise<AssetOverride[]> {
  return request<AssetOverride[]>('admin.assetOverride.list', { token });
}

export async function adminSaveAssetOverride(token: string, override: AssetOverride): Promise<AssetOverride> {
  return request<AssetOverride>('admin.assetOverride.save', { token, override });
}
