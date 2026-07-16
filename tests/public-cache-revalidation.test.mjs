import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscPath = resolve(repoRoot, 'node_modules/.bin/tsc');

function dataModule(source) {
  return JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function compilePublicDataStore() {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'cha-amu-public-cache-'));
  const compile = spawnSync(tscPath, [
    '--ignoreConfig',
    'src/stores/publicDataStore.ts',
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--types', 'vite/client',
    '--outDir', outputDirectory
  ], { cwd: repoRoot, encoding: 'utf8' });

  try {
    assert.equal(compile.status, 0, compile.stderr || compile.stdout || 'Failed to compile public data store.');
    let source = readFileSync(join(outputDirectory, 'stores/publicDataStore.js'), 'utf8');
    const replacements = [
      [/'react'/, dataModule('export const useSyncExternalStore = () => undefined;')],
      [/'\.\.\/i18n'/, dataModule('export const translate = () => "";')],
      [/'\.\.\/api\/archiveManifestClient'/, dataModule(`
        const cachedAt = '2999-01-01T00:00:00.000Z';
        export async function loadArchiveManifest() {
          globalThis.__publicRevalidationCalls.archiveManifest += 1;
          return { assets: [{ id: 'fresh-asset' }] };
        }
        export const mergeAssetOverrides = (assets) => assets;
        export const readCachedArchiveAssetsPayload = () => ({ savedAt: cachedAt, data: [{ id: 'cached-asset' }] });
        export const writeCachedArchiveAssets = () => undefined;
      `)],
      [/'\.\.\/api\/appsScriptClient'/, dataModule(`
        const cachedAt = '2999-01-01T00:00:00.000Z';
        const cachedPost = { id: 'cached-post', title: 'Cached', body: '', tags: [], status: 'published', createdAt: cachedAt };
        export async function listAssetOverrides() {
          globalThis.__publicRevalidationCalls.assetOverrides += 1;
          return [];
        }
        export async function listGuestbook() {
          globalThis.__publicRevalidationCalls.guestbook += 1;
          return [{ id: 'fresh-guestbook', name: 'Fresh', message: 'Fresh', status: 'visible', createdAt: cachedAt }];
        }
        export async function listPosts() {
          globalThis.__publicRevalidationCalls.postsApi += 1;
          return [{ ...cachedPost, id: 'fresh-api-post' }];
        }
        export async function listThings() {
          globalThis.__publicRevalidationCalls.things += 1;
          return [{ id: 'fresh-thing', title: 'Fresh thing', description: '', url: 'https://example.com/', status: 'visible', sortOrder: 0, updatedAt: cachedAt }];
        }
        export const readCachedAssetOverridesPayload = () => ({ savedAt: cachedAt, data: [] });
        export const readCachedGuestbookPayload = () => ({ savedAt: cachedAt, data: [{ id: 'cached-guestbook', name: 'Cached', message: 'Cached', status: 'visible', createdAt: cachedAt }] });
        export const readCachedPostControls = () => [];
        export const readCachedPostControlsPayload = () => ({ savedAt: cachedAt, data: [] });
        export const readCachedPostsPayload = () => ({ savedAt: cachedAt, data: [cachedPost] });
        export const readCachedThingsPayload = () => ({ savedAt: cachedAt, data: [{ id: 'cached-thing', title: 'Cached thing', description: '', url: 'https://example.com/', status: 'visible', sortOrder: 0, updatedAt: cachedAt }] });
        export const writeCachedGuestbook = () => undefined;
        export const writeCachedPostControls = () => undefined;
        export const writeCachedPosts = () => undefined;
        export const writeCachedThings = () => undefined;
      `)],
      [/'\.\.\/api\/storageClient'/, dataModule(`
        export async function listStoragePosts() {
          globalThis.__publicRevalidationCalls.postsStorage += 1;
          return [];
        }
      `)],
      [/'\.\/controlSnapshot'/, dataModule(`
        export const resolveControlSnapshot = (result, fallback) => result.status === 'fulfilled' ? result.value : fallback;
      `)],
      [/'\.\/postMerge'/, dataModule(`
        export const mergePosts = (storagePosts, sheetPosts) => [...storagePosts, ...sheetPosts];
        export const normalizePostList = (posts) => posts.filter((post) => post.status === 'published');
      `)]
    ];

    for (const [pattern, replacement] of replacements) {
      const next = source.replace(pattern, replacement);
      assert.notEqual(next, source, `Missing compiled import replacement: ${pattern}`);
      source = next;
    }
    return source;
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

test('a new document revalidates posts, guestbook, archive, and things even when persisted caches look fresh', async () => {
  globalThis.__publicRevalidationCalls = {
    archiveManifest: 0,
    assetOverrides: 0,
    guestbook: 0,
    postsApi: 0,
    postsStorage: 0,
    things: 0
  };

  try {
    const source = compilePublicDataStore();
    const store = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await Promise.all([
      store.refreshPosts(),
      store.refreshGuestbook(),
      store.refreshArchive(),
      store.refreshThings()
    ]);

    assert.deepEqual(globalThis.__publicRevalidationCalls, {
      archiveManifest: 1,
      assetOverrides: 1,
      guestbook: 1,
      postsApi: 1,
      postsStorage: 1,
      things: 1
    });

    await Promise.all([
      store.refreshPosts(),
      store.refreshGuestbook(),
      store.refreshArchive(),
      store.refreshThings()
    ]);
    assert.deepEqual(globalThis.__publicRevalidationCalls, {
      archiveManifest: 1,
      assetOverrides: 1,
      guestbook: 1,
      postsApi: 1,
      postsStorage: 1,
      things: 1
    });
  } finally {
    delete globalThis.__publicRevalidationCalls;
  }
});
