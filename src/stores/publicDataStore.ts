import { useSyncExternalStore } from 'react';
import { translate } from '../i18n';
import { loadArchiveManifest, mergeAssetOverrides, readCachedArchiveAssetsPayload, writeCachedArchiveAssets } from '../api/archiveManifestClient';
import { listAssetOverrides, listGuestbook, listPosts, listThings, readCachedAssetOverridesPayload, readCachedGuestbookPayload, readCachedPostControls, readCachedPostControlsPayload, readCachedPostsPayload, readCachedThingsPayload, writeCachedGuestbook, writeCachedPostControls, writeCachedPosts, writeCachedThings } from '../api/appsScriptClient';
import { listStoragePosts } from '../api/storageClient';
import type { ArchiveAsset, AssetOverride, GuestbookEntry, Post, Thing } from '../types';
import { resolveControlSnapshot } from './controlSnapshot';
import { mergePosts, normalizePostList } from './postMerge';

type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';
type ResourceKey = 'posts' | 'guestbook' | 'archive' | 'things';

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
  things: PublicResource<Thing>;
}

type ResourceMap = {
  posts: Post;
  guestbook: GuestbookEntry;
  archive: ArchiveAsset;
  things: Thing;
};

type PendingMap = Partial<Record<ResourceKey, Promise<unknown>>>;

const PUBLIC_REFRESH_COOLDOWN_MS = 60_000;

function hydratedResource<T>(items: T[] = []): PublicResource<T> {
  return {
    items,
    status: items.length ? 'ready' : 'idle',
    refreshing: false,
    error: '',
    // Persisted data can paint immediately, but only this document's network
    // validation may start the in-memory refresh cooldown.
    loadedAt: ''
  };
}

function byNewestGuestbook(a: GuestbookEntry, b: GuestbookEntry) {
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
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

function normalizeThingList(things: Thing[]) {
  return things
    .filter((thing) => thing.status === 'visible')
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

const cachedPosts = readCachedPostsPayload();
const cachedPostControls = readCachedPostControlsPayload();
const cachedGuestbook = readCachedGuestbookPayload();
const cachedArchive = readCachedArchiveAssetsPayload();
const cachedAssetOverrides = readCachedAssetOverridesPayload();
const cachedThings = readCachedThingsPayload();

let state: PublicDataState = {
  posts: hydratedResource(
    cachedPostControls ? normalizePostList(mergePosts(cachedPosts?.data || [], cachedPostControls.data)) : []
  ),
  guestbook: hydratedResource(normalizeGuestbookList(cachedGuestbook?.data || [])),
  archive: hydratedResource(cachedAssetOverrides ? cachedArchive?.data || [] : []),
  things: hydratedResource(normalizeThingList(cachedThings?.data || []))
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
  const controls = readCachedPostControls();
  writeCachedPostControls([saved, ...controls.filter((post) => post.id !== saved.id)]);
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

export function syncPublicArchiveOverrides(assets: ArchiveAsset[], overrides: AssetOverride[]) {
  const nextAssets = mergeAssetOverrides(assets, overrides);
  writeCachedArchiveAssets(nextAssets);
  updateResource('archive', { items: nextAssets, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
}

export function setPublicThings(updater: Thing[] | ((current: Thing[]) => Thing[])) {
  const nextThings = normalizeThingList(typeof updater === 'function' ? updater(state.things.items) : updater);
  writeCachedThings(nextThings);
  updateResource('things', { items: nextThings, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
}

export function syncPublicThing(saved: Thing) {
  setPublicThings((current) => {
    const withoutSaved = current.filter((thing) => thing.id !== saved.id);
    return saved.status === 'visible' ? [...withoutSaved, saved] : withoutSaved;
  });
}

export function refreshPosts(options: { force?: boolean; silent?: boolean } = {}) {
  if (pending.posts) return pending.posts as Promise<Post[]>;
  if (!options.force && state.posts.status === 'ready' && isFresh(state.posts)) return Promise.resolve(state.posts.items);
  setLoading('posts', Boolean(options.silent));
  const request = Promise.allSettled([listStoragePosts(), listPosts()])
    .then(([storageResult, sheetsResult]) => {
      const storagePosts = fulfilledValue(storageResult, []);
      const cachedControls = readCachedPostControlsPayload();
      const sheetPosts = resolveControlSnapshot(sheetsResult, cachedControls?.data ?? null);
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
        error: errorMessage(error, translate('errors.postsLoad'))
      });
      throw error;
    })
    .finally(() => { delete pending.posts; });
  pending.posts = request;
  return request;
}

export function refreshGuestbook(options: { force?: boolean; silent?: boolean } = {}) {
  if (pending.guestbook) return pending.guestbook as Promise<GuestbookEntry[]>;
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
        error: errorMessage(error, translate('errors.guestbookLoad'))
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
  const request = Promise.allSettled([loadArchiveManifest(), listAssetOverrides()])
    .then(([manifestResult, overridesResult]) => {
      if (manifestResult.status === 'rejected') throw manifestResult.reason;
      const manifest = manifestResult.value;
      const cachedOverrides = readCachedAssetOverridesPayload();
      const overrides = resolveControlSnapshot(overridesResult, cachedOverrides?.data ?? null);
      const nextAssets = mergeAssetOverrides(manifest.assets, overrides);
      writeCachedArchiveAssets(nextAssets);
      updateResource('archive', { items: nextAssets, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
      return nextAssets;
    })
    .catch((error: unknown) => {
      updateResource('archive', {
        status: state.archive.items.length ? 'ready' : 'error',
        refreshing: false,
        error: errorMessage(error, translate('errors.archiveLoad'))
      });
      throw error;
    })
    .finally(() => { delete pending.archive; });
  pending.archive = request;
  return request;
}

export function refreshThings(options: { force?: boolean; silent?: boolean } = {}) {
  if (pending.things) return pending.things as Promise<Thing[]>;
  if (!options.force && state.things.status === 'ready' && isFresh(state.things)) return Promise.resolve(state.things.items);
  setLoading('things', Boolean(options.silent));
  const request = listThings()
    .then((things) => {
      const nextThings = normalizeThingList(things);
      writeCachedThings(nextThings);
      updateResource('things', { items: nextThings, status: 'ready', refreshing: false, error: '', loadedAt: new Date().toISOString() });
      return nextThings;
    })
    .catch((error: unknown) => {
      updateResource('things', {
        status: state.things.items.length ? 'ready' : 'error',
        refreshing: false,
        error: errorMessage(error, translate('errors.thingsLoad'))
      });
      throw error;
    })
    .finally(() => { delete pending.things; });
  pending.things = request;
  return request;
}

export function preloadPublicData() {
  if (didPreload) return;
  didPreload = true;
  void refreshPosts({ silent: true }).catch(() => undefined);
  void refreshGuestbook({ silent: true }).catch(() => undefined);
  void refreshArchive({ silent: true }).catch(() => undefined);
  void refreshThings({ silent: true }).catch(() => undefined);
}
