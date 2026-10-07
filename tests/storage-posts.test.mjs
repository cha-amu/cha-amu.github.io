import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: {
    contents: `
      export * from './src/stores/publicDataStore';
      export * from './src/utils/search';
      export * from './src/stores/controlSnapshot';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url))
  },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }
});
let instance = 0;

async function setup(t, cache = new Map()) {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = {
    location: { origin: 'https://blog.test' },
    addEventListener() {},
    localStorage: {
      getItem: (key) => cache.get(key) ?? null,
      setItem: (key, value) => cache.set(key, value)
    }
  };
  const manifest = { posts: [] };
  const bodies = new Map();
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    assert.equal(options.method, 'GET', 'post refresh must only read storage files');
    assert.equal(options.cache, 'no-cache');
    if (url === 'https://cha-amu.github.io/storage/manifests/posts.json') return Response.json(manifest);
    assert.ok(bodies.has(url), `Unexpected request: ${url}`);
    return new Response(bodies.get(url));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const source = `${outputFiles[0].text}\n// instance ${instance++}`;
  const store = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return { store, manifest, bodies, requests, cache };
}

const cachedPost = (id, status = 'published', source = 'storage') => ({
  id, title: id, body: 'Cached body', tags: [], status, source, createdAt: '2026-01-01'
});
const payload = (data) => JSON.stringify({ savedAt: '2999-01-01', data });

test('the public post list reads storage only, follows frontmatter status and keeps newest-first ordering', async (t) => {
  const f = await setup(t, new Map([
    ['cha-amu:posts:v1', payload([cachedPost('api-only', 'published', 'sheets')])],
    ['cha-amu:posts-control:v1', payload([cachedPost('newest', 'hidden', 'sheets')])]
  ]));
  assert.deepEqual(f.store.getPublicDataSnapshot().posts.items, [], 'old combined caches cannot hydrate');
  const entries = [
    ['older', 'published', '2026-01-01', 'published'],
    ['draft', 'draft', '2026-12-01', 'published'],
    ['hidden', 'hidden', '2026-12-01', 'published'],
    ['newest', 'published', '2026-03-01', 'hidden'],
    ['middle', 'published', '2026-02-01', 'published'],
    ['missing-status', undefined, '2026-12-01', 'published'],
    ['invalid-status', 'unknown', '2026-12-01', 'published']
  ];
  for (const [id, status, updatedAt, manifestStatus] of entries) {
    const path = `posts/2026/${id}.md`;
    f.manifest.posts.push({ id, path, status: manifestStatus, updatedAt, publishedAt: '2025-01-01' });
    f.bodies.set(`https://cha-amu.github.io/storage/${path}`, [
      '---', `title: ${id}`, ...(status ? [`status: ${status}`] : []), 'tags: [fixture]', '---', `Body ${id}`
    ].join('\n'));
  }
  const posts = await f.store.refreshPosts();
  assert.deepEqual(posts.map((post) => post.id), ['newest', 'middle', 'older']);
  assert.equal(posts[0].body, 'Body newest');
  assert.equal(posts[0].markdownBaseUrl, 'https://cha-amu.github.io/storage/posts/2026/');
  assert.ok(posts.every((post) => post.source === 'storage' && post.status === 'published'));
  assert.deepEqual(f.store.getPublicDataSnapshot().posts.items, posts);
  assert.deepEqual(f.store.buildSearchResults(posts, [], 'Body').map((result) => result.id), ['newest', 'middle', 'older']);
  assert.equal(f.requests.length, entries.length + 1);
  assert.deepEqual(JSON.parse(f.cache.get('cha-amu:posts:v2')).data.map((post) => post.id), ['newest', 'middle', 'older']);

  f.manifest.posts = [];
  await f.store.refreshPosts({ force: true });
  assert.deepEqual(f.store.getPublicDataSnapshot().posts.items, [], 'deleting storage files removes cached posts too');
  assert.deepEqual(JSON.parse(f.cache.get('cha-amu:posts:v2')).data, []);
});

test('storage cache hydration excludes draft, hidden and non-storage rows and still revalidates', async (t) => {
  const f = await setup(t, new Map([['cha-amu:posts:v2', payload([
    cachedPost('published'), cachedPost('draft', 'draft'), cachedPost('hidden', 'hidden'),
    cachedPost('api-only', 'published', 'sheets'), null
  ])]]));
  assert.deepEqual(f.store.getPublicDataSnapshot().posts.items.map((post) => post.id), ['published']);
  await f.store.refreshPosts();
  assert.equal(f.requests.length, 1, 'persisted timestamps cannot skip storage validation');
  assert.deepEqual(f.store.getPublicDataSnapshot().posts.items, []);
});

test('asset visibility still requires a live or cached control snapshot', async (t) => {
  const { store } = await setup(t);
  const cached = [{ assetId: 'asset:hidden', status: 'hidden' }];
  const failure = { status: 'rejected', reason: new Error('Override API unavailable') };
  assert.equal(store.resolveControlSnapshot(failure, cached), cached);
  assert.deepEqual(store.resolveControlSnapshot(failure, []), []);
  assert.throws(() => store.resolveControlSnapshot(failure, null), /Override API unavailable/);
});

test('a failed storage refresh retains the last storage snapshot and reports the error', async (t) => {
  const { store } = await setup(t, new Map([['cha-amu:posts:v2', payload([cachedPost('last-storage-post')])]]));
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('', { status: 503 }); };
  await assert.rejects(store.refreshPosts(), /Storage manifest request failed: 503/);
  assert.equal(requests, 1);
  const resource = store.getPublicDataSnapshot().posts;
  assert.deepEqual(resource.items.map((post) => post.id), ['last-storage-post']);
  assert.match(resource.error, /503/);
  assert.equal(resource.refreshing, false);
});
