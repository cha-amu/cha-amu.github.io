import { useSyncExternalStore } from 'react';
import { loadArchiveManifest, mergeAssetOverrides, readCachedArchiveAssetsPayload, writeCachedArchiveAssets } from '../api/archiveManifestClient';
import { listAssetOverrides, listGuestbook, listPosts, readCachedGuestbookPayload, readCachedPostsPayload, writeCachedGuestbook, writeCachedPosts } from '../api/appsScriptClient';
import { listStoragePosts } from '../api/storageClient';
import type { ArchiveAsset, GuestbookEntry, Post } from '../types';

type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';
type ResourceKey = 'posts' | 'guestbook' | 'archive';

export interface PublicResource<T> {
  items: T[];
  status: ResourceStatus;
  refreshing: boolean;
  error: string;
  loadedAt: string;
}

interface PublicDataState {
  posts: PublicResource<Post>;
  guestbook: PublicResource<GuestbookEntry>;
  archive: PublicResource<ArchiveAsset>;
}

type ResourceMap = {
  posts: Post;
  guestbook: GuestbookEntry;
  archive: ArchiveAsset;
};

type PendingMap = Partial<Record<ResourceKey, Promise<unknown>>>;

const PUBLIC_REFRESH_COOLDOWN_MS = 60_000;

function emptyResource<T>(items: T[] = [], loadedAt = ''): PublicResource<T> {
  return {
    items,
    status: items.length ? 'ready' : 'idle',
    refreshing: false,
    error: '',
    loadedAt: items.length ? loadedAt : ''
  };
}

function byNewestPost(a: Post, b: Post) {
  return new Date(b.publishedAt || b.updatedAt || b.createdAt || '').getTime() - new Date(a.publishedAt || a.updatedAt || a.createdAt || '').getTime();
}

function byNewestGuestbook(a: GuestbookEntry, b: GuestbookEntry) {
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

function normalizePostList(posts: Post[]) {
  return posts.filter((post) => post.status === 'published').sort(byNewestPost);
}

function postFreshness(post: Post) {
  const value = post.updatedAt || post.publishedAt || post.createdAt || '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergePostPair(storagePost: Post, sheetPost: Post) {
  const storageIsCurrent = postFreshness(sheetPost) <= postFreshness(storagePost);
  const current = storageIsCurrent ? storagePost : sheetPost;
  const fallback = storageIsCurrent ? sheetPost : storagePost;

  return {
    ...fallback,
    ...current,
    body: current.body || fallback.body,
    excerpt: current.excerpt || fallback.excerpt,
    tags: current.tags.length ? current.tags : fallback.tags,
    source: current.source || fallback.source,
    storagePath: storagePost.storagePath || sheetPost.storagePath,
    bodyUrl: storagePost.bodyUrl || sheetPost.bodyUrl,
    markdownBaseUrl: storagePost.markdownBaseUrl || sheetPost.markdownBaseUrl,
    markdownRootUrl: storagePost.markdownRootUrl || sheetPost.markdownRootUrl
  };
}

function mergePosts(storagePosts: Post[], sheetPosts: Post[]) {
  const byId = new Map<string, Post>();
  for (const post of storagePosts) byId.set(post.id, { ...post, source: post.source || 'storage' });
  for (const post of sheetPosts) {
    const existing = byId.get(post.id);
    if (!existing) {
      byId.set(post.id, { ...post, source: post.source || 'sheets' });
      continue;
    }
    byId.set(post.id, mergePostPair(existing, { ...post, source: post.source || 'sheets' }));
  }
  return Array.from(byId.values());
}

function fulfilledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function isPendingGuestbookEntry(entry: GuestbookEntry) {
  return String(entry.id || '').startsWith('temp-');
}

function normalizeGuestbookList(entries: GuestbookEntry[]) {
  return entries
    .filter((entry) => entry.status === 'visible')
    .map((entry) => ({
      ...entry,
      id: String(entry.id),
      name: String(entry.name || ''),
      message: String(entry.message || ''),
      createdAt: String(entry.createdAt || new Date().toISOString())
    }))
    .sort(byNewestGuestbook);
}

const cachedPosts = readCachedPostsPayload();
const cachedGuestbook = readCachedGuestbookPayload();
const cachedArchive = readCachedArchiveAssetsPayload();

let state: PublicDataState = {
  posts: emptyResource(normalizePostList(cachedPosts?.data || []), cachedPosts?.savedAt || ''),
  guestbook: emptyResource(normalizeGuestbookList(cachedGuestbook?.data || []), cachedGuestbook?.savedAt || ''),
  archive: emptyResource(cachedArchive?.data || [], cachedArchive?.savedAt || '')
};

const listeners = new Set<() => void>();
const pending: PendingMap = {};
let didPreload = false;

function notify() {
  listeners.forEach((listener) => listener());
}

function updateResource<K extends ResourceKey>(key: K, next: Partial<PublicResource<ResourceMap[K]>>) {
  state = {
    ...state,
    [key]: {
      ...state[key],
      ...next
    }
  };
  notify();
}

function isFresh(resource: PublicResource<unknown>) {
  if (!resource.loadedAt) return false;
  return Date.now() - new Date(resource.loadedAt).getTime() < PUBLIC_REFRESH_COOLDOWN_MS;
}

function setLoading<K extends ResourceKey>(key: K, silent: boolean) {
  const resource = state[key];
  updateResource(key, {
    status: resource.items.length ? 'ready' : 'loading',
    refreshing: resource.items.length > 0 && (silent || resource.status === 'ready'),
    error: ''
  } as Partial<PublicResource<ResourceMap[K]>>);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function subscribePublicData(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPublicDataSnapshot() {
  return state;
}

export function usePublicResource<K extends ResourceKey>(key: K): PublicResource<ResourceMap[K]> {
  return useSyncExternalStore(
    subscribePublicData,
    () => getPublicDataSnapshot()[key],
    () => getPublicDataSnapshot()[key]
  ) as PublicResource<ResourceMap[K]>;
}

export function setPublicPosts(updater: Post[] | ((current: Post[]) => Post[])) {
  const nextPosts = normalizePostList(typeof updater === 'function' ? updater(state.posts.items) : updater);
  writeCachedPosts(nextPosts);
  updateResource('posts', { items: nextPosts, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
}

export function syncPublicPost(saved: Post) {
  setPublicPosts((current) => {
    const withoutSaved = current.filter((post) => post.id !== saved.id);
    return saved.status === 'published' ? [saved, ...withoutSaved] : withoutSaved;
  });
}

export function setPublicGuestbook(updater: GuestbookEntry[] | ((current: GuestbookEntry[]) => GuestbookEntry[])) {
  const nextEntries = normalizeGuestbookList(typeof updater === 'function' ? updater(state.guestbook.items) : updater);
  writeCachedGuestbook(nextEntries);
  updateResource('guestbook', { items: nextEntries, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
}

export function setPublicArchiveAssets(assets: ArchiveAsset[]) {
  const nextAssets = mergeAssetOverrides(assets, []);
  writeCachedArchiveAssets(nextAssets);
  updateResource('archive', { items: nextAssets, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
}

export function refreshPosts(options: { force?: boolean; silent?: boolean } = {}) {
  if (pending.posts && !options.force) return pending.posts as Promise<Post[]>;
  if (!options.force && state.posts.status === 'ready' && isFresh(state.posts)) return Promise.resolve(state.posts.items);
  setLoading('posts', Boolean(options.silent));
  const request = Promise.allSettled([listStoragePosts(), listPosts()])
    .then(([storageResult, sheetsResult]) => {
      const storagePosts = fulfilledValue(storageResult, []);
      const sheetPosts = fulfilledValue(sheetsResult, []);
      if (!storagePosts.length && !sheetPosts.length) {
        const firstError = storageResult.status === 'rejected' ? storageResult.reason : sheetsResult.status === 'rejected' ? sheetsResult.reason : null;
        if (firstError) throw firstError;
      }
      const nextPosts = normalizePostList(mergePosts(storagePosts, sheetPosts));
      writeCachedPosts(nextPosts);
      updateResource('posts', { items: nextPosts, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
      return nextPosts;
    })
    .catch((error: unknown) => {
      updateResource('posts', {
        status: state.posts.items.length ? 'ready' : 'error',
        refreshing: false,
        error: errorMessage(error, '아무 글을 불러오지 못했습니다.')
      });
      throw error;
    })
    .finally(() => { delete pending.posts; });
  pending.posts = request;
  return request;
}

export function refreshGuestbook(options: { force?: boolean; silent?: boolean } = {}) {
  if (pending.guestbook && !options.force) return pending.guestbook as Promise<GuestbookEntry[]>;
  if (!options.force && state.guestbook.status === 'ready' && isFresh(state.guestbook)) return Promise.resolve(state.guestbook.items);
  setLoading('guestbook', Boolean(options.silent));
  const request = listGuestbook()
    .then((entries) => {
      const pendingEntries = state.guestbook.items.filter(isPendingGuestbookEntry);
      const nextEntries = normalizeGuestbookList([...pendingEntries, ...entries]);
      writeCachedGuestbook(nextEntries);
      updateResource('guestbook', { items: nextEntries, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
      return nextEntries;
    })
    .catch((error: unknown) => {
      updateResource('guestbook', {
        status: state.guestbook.items.length ? 'ready' : 'error',
        refreshing: false,
        error: errorMessage(error, '방명록을 불러오지 못했습니다.')
      });
      throw error;
    })
    .finally(() => { delete pending.guestbook; });
  pending.guestbook = request;
  return request;
}

export function refreshArchive(options: { force?: boolean; silent?: boolean } = {}) {
  if (pending.archive && !options.force) return pending.archive as Promise<ArchiveAsset[]>;
  if (!options.force && state.archive.status === 'ready' && isFresh(state.archive)) return Promise.resolve(state.archive.items);
  setLoading('archive', Boolean(options.silent));
  const request = loadArchiveManifest()
    .then(async (manifest) => {
      const overrides = await listAssetOverrides().catch(() => []);
      const nextAssets = mergeAssetOverrides(manifest.assets, overrides);
      writeCachedArchiveAssets(nextAssets);
      updateResource('archive', { items: nextAssets, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
      return nextAssets;
    })
    .catch((error: unknown) => {
      updateResource('archive', {
        status: state.archive.items.length ? 'ready' : 'error',
        refreshing: false,
        error: errorMessage(error, '자료 목록을 불러오지 못했습니다.')
      });
      throw error;
    })
    .finally(() => { delete pending.archive; });
  pending.archive = request;
  return request;
}

export function preloadPublicData() {
  if (didPreload) return;
  didPreload = true;
  void refreshPosts({ silent: true }).catch(() => undefined);
  void refreshGuestbook({ silent: true }).catch(() => undefined);
  void refreshArchive({ silent: true }).catch(() => undefined);
}
