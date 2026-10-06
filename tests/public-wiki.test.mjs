import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/public-wiki.json'), 'utf8'));
const output = mkdtempSync(join(tmpdir(), 'cha-amu-wiki-'));
const compiled = spawnSync(join(root, 'node_modules/.bin/tsc'), [
  '--ignoreConfig', 'src/utils/publicWiki.ts', 'src/api/publicWikiClient.ts', 'src/utils/router.ts', 'src/utils/search.ts',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--outDir', output
], { cwd: root, encoding: 'utf8' });
assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
const moduleUrl = (name) => {
  const source = readFileSync(join(output, name), 'utf8').replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => {
    if (specifier === 'react') return `from '${import.meta.resolve('react')}'`;
    if (!specifier.startsWith('.')) throw new Error(`Unexpected import: ${specifier}`);
    const dependency = resolve(output, dirname(name), `${specifier}.js`).slice(output.length + 1);
    return `from '${moduleUrl(dependency)}'`;
  });
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
};
let wiki, router, client, search, i18n;
try {
  [wiki, router, client, search, i18n] = await Promise.all([
    import(moduleUrl('utils/publicWiki.js')), import(moduleUrl('utils/router.js')),
    import(moduleUrl('api/publicWikiClient.js')), import(moduleUrl('utils/search.js')), import(moduleUrl('i18n.js'))
  ]);
} finally {
  rmSync(output, { recursive: true, force: true });
}

test('only exact kind/id resources with existing public document IDs enable a graph', () => {
  const index = wiki.parsePublicWikiIndex(fixture);
  assert.ok(index);
  assert.equal(wiki.connectedWikiResource(index, 'post', 'connected')?.id, 'connected');
  assert.equal(wiki.connectedWikiResource(index, 'asset', 'connected-asset')?.id, 'connected-asset');
  for (const id of ['unconnected', 'missing-document', 'missing-resource']) {
    assert.equal(wiki.connectedWikiResource(index, 'post', id), null);
  }
  assert.equal(wiki.connectedWikiResource(index, 'asset', 'connected'), null);
  assert.equal(wiki.connectedWikiResource(null, 'post', 'connected'), null);
  assert.equal(wiki.parsePublicWikiIndex({ ...fixture, version: 2 }), null);
  assert.deepEqual(wiki.parsePublicWikiIndex({ ...fixture, documents: [], resources: [] }).documents, []);
  // A shared tag must not add a relationship.
  assert.deepEqual(index.documents[1].links, []);
});

test('public resource paths over 240 characters survive parsing, exact connection lookup and both embed scopes up to 512', () => {
  const pathPrefix = 'assets/images/2026/';
  const pathSuffix = '/자료 그림 &참고#1.png';
  for (const length of [241, 512]) {
    const id = pathPrefix + 'long-path/'.repeat(52).slice(0, length - pathPrefix.length - pathSuffix.length) + pathSuffix;
    assert.equal(id.length, length);
    for (const kind of ['post', 'asset']) {
      const resource = {
        kind, id, title: 'Long public resource path',
        url: `https://cha-amu.github.io/${kind === 'post' ? 'posts' : 'archive'}/#${encodeURIComponent(id)}`,
        documentIds: ['wiki-one']
      };
      const index = wiki.parsePublicWikiIndex({ ...fixture, resources: [resource] });
      assert.deepEqual(index.resources, [resource]);
      assert.equal(wiki.connectedWikiResource(index, kind, id)?.id, id);
      assert.equal(wiki.connectedWikiResource(index, kind, id.slice(0, 240)), null);
      assert.equal(wiki.connectedWikiResource(index, kind === 'post' ? 'asset' : 'post', id), null);
      for (const scope of ['local', 'all']) {
        const url = new URL(wiki.wikiGraphUrl('http://localhost:5186/amuwiki/', kind, id, scope));
        assert.equal(url.searchParams.get('focus'), `${kind}:${id}`);
        assert.equal(url.searchParams.get('scope'), scope);
        assert.equal(url.hash, '');
      }
    }
  }
});

test('resource IDs over 512 are rejected without widening the separate 80-character document contract', () => {
  const documentId = 'd'.repeat(80);
  const tooLongDocumentId = `${documentId}x`;
  const tooLongResourceId = 'a'.repeat(513);
  const index = wiki.parsePublicWikiIndex({
    ...fixture,
    documents: [
      { ...fixture.documents[0], links: [{ target: `doc:${documentId}`, type: 'related' }, { target: tooLongDocumentId, type: 'related' }] },
      { ...fixture.documents[1], id: documentId },
      { ...fixture.documents[1], id: tooLongDocumentId }
    ],
    resources: [
      { ...fixture.resources[0], documentIds: [documentId, tooLongDocumentId] },
      { ...fixture.resources[0], kind: 'asset', id: tooLongResourceId }
    ]
  });
  assert.deepEqual(index.documents.map((document) => document.id), ['wiki-one', documentId]);
  assert.deepEqual(index.documents[0].links, [{ target: `doc:${documentId}`, type: 'related' }]);
  assert.deepEqual(index.resources[0].documentIds, [documentId]);
  assert.equal(index.resources.length, 1);
  assert.equal(wiki.connectedWikiResource(index, 'post', 'connected')?.id, 'connected');
  assert.equal(wiki.connectedWikiResource({ ...index, resources: [{ ...fixture.resources[0], id: tooLongResourceId }] }, 'post', tooLongResourceId), null);
  assert.equal(wiki.wikiGraphUrl(wiki.DEFAULT_WIKI_BASE_URL, 'asset', tooLongResourceId, 'local'), '');
  assert.equal(new URL(wiki.wikiDocumentUrl(wiki.DEFAULT_WIKI_BASE_URL, documentId)).hash, `#${documentId}`);
  assert.equal(wiki.wikiDocumentUrl(wiki.DEFAULT_WIKI_BASE_URL, tooLongDocumentId), wiki.DEFAULT_WIKI_BASE_URL);
});

test('invalid metadata, URLs and private extensions never become public graph/search records', () => {
  const input = structuredClone(fixture);
  input.documents.push({ ...input.documents[0], id: 'private-doc', private: true, title: 'Do not expose' });
  input.documents.push({ ...input.documents[0], id: '\ud800' });
  input.documents.push({ ...input.documents[0], id: 'bad-title', title: 'x'.repeat(301) });
  input.documents[0].links.push({ target: 'private-doc', type: 'related' });
  input.documents[0].sources.push({ label: 'Unsafe', url: 'javascript:alert(1)' });
  input.resources.push({ ...input.resources[0], id: 'unsafe', url: 'javascript:alert(1)' });
  input.resources.push({ ...input.resources[0], id: 'private-resource', private: true });
  input.resources[0].documentIds.push('private-doc');
  const index = wiki.parsePublicWikiIndex(input);
  assert.equal(index.documents.length, 2);
  assert.deepEqual(index.documents[0].links, fixture.documents[0].links);
  assert.deepEqual(index.documents[0].sources, fixture.documents[0].sources);
  assert.deepEqual(index.resources[0].documentIds, ['wiki-one']);
  assert.equal(index.resources.length, 4);
  assert.doesNotMatch(JSON.stringify(index), /private|Do not expose|javascript/);
  assert.equal(wiki.parsePublicWikiIndex({ ...fixture, hiddenCount: 4 }), null);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://a:b@example.com/', 'https://exam\nple.com']) {
    assert.equal(wiki.safeWikiUrl(url), null);
  }
});

test('iframe and document URLs encode punctuation, Unicode and existing kind prefixes exactly once', () => {
  const id = 'post:그림 /a?b&c=#😀';
  const url = new URL(wiki.wikiGraphUrl('http://localhost:5186/amuwiki/?old=1#old', 'post', id, 'local'));
  assert.equal(url.origin, 'http://localhost:5186');
  assert.equal(url.pathname, '/amuwiki/');
  assert.deepEqual([...url.searchParams], [['embed', 'graph'], ['focus', `post:${id}`], ['scope', 'local']]);
  assert.equal(url.hash, '');
  const full = new URL(wiki.wikiGraphUrl('http://localhost:5186/amuwiki/', 'asset', id, 'all'));
  assert.equal(full.searchParams.get('focus'), `asset:${id}`);
  assert.equal(full.searchParams.get('scope'), 'all');
  assert.equal(decodeURIComponent(new URL(wiki.wikiDocumentUrl(url.href, id)).hash.slice(1)), id);
  assert.equal(wiki.wikiGraphUrl(url.href, 'post', '\ud800', 'local'), '');
  assert.equal(wiki.wikiBaseUrl('javascript:alert(1)'), wiki.DEFAULT_WIKI_BASE_URL);
});

test('SPA navigation keeps wiki documents inside the blog and leaves only legacy/embed endpoints external', () => {
  const previous = globalThis.window;
  globalThis.window = { location: { href: 'https://cha-amu.github.io/posts/', origin: 'https://cha-amu.github.io' } };
  const event = { button: 0, defaultPrevented: false };
  const anchor = (href, attributes = []) => ({ href, target: '', hasAttribute: (key) => attributes.includes(key) });
  try {
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/posts/#connected')), true);
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/wiki/#wiki-one')), true);
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/wiki?view=graph')), true);
    assert.equal(router.canonicalizeUrl('/wiki', '?q=fixture', '#wiki-one'), '/wiki/?q=fixture#wiki-one');
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/amuwiki/#wiki-one')), false);
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/amuwiki?view=graph')), false);
    assert.equal(router.isPlainInternalNavigation(event, anchor('http://localhost:5186/amuwiki/')), false);
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/', ['data-native-navigation'])), false);
    assert.equal(router.isPlainInternalNavigation(event, anchor('https://cha-amu.github.io/posts/', ['download'])), false);
    router.navigateTo('/amuwiki/#wiki-one');
    assert.equal(globalThis.window.location.href, 'https://cha-amu.github.io/amuwiki/#wiki-one');
  } finally { globalThis.window = previous; }
});

test('document and overview maps use the separate embed endpoint while reading links use the blog', () => {
  const document = new URL(wiki.wikiGraphUrl(wiki.DEFAULT_WIKI_EMBED_URL, 'doc', 'wiki-one', 'local'));
  assert.equal(document.pathname, '/amuwiki/');
  assert.equal(document.searchParams.get('focus'), 'doc:wiki-one');
  const overview = new URL(wiki.wikiGraphUrl(wiki.DEFAULT_WIKI_EMBED_URL, 'all', '', 'local'));
  assert.equal(overview.searchParams.has('focus'), false);
  assert.equal(overview.searchParams.get('scope'), 'all');
  assert.equal(wiki.wikiDocumentUrl(wiki.DEFAULT_WIKI_BASE_URL, 'wiki-one'), 'https://cha-amu.github.io/wiki/#wiki-one');
  assert.equal(wiki.wikiGraphUrl(wiki.DEFAULT_WIKI_EMBED_URL, 'doc', 'x'.repeat(81), 'local'), '');
});

test('concurrent consumers share one public fetch and a failed refresh clears previous data', async () => {
  let calls = 0;
  let resolveResponse;
  const pendingResponse = new Promise((resolve) => { resolveResponse = resolve; });
  const resource = client.createPublicWikiClient('https://example.com/wiki.json', async (_url, options) => {
    calls += 1;
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    if (calls === 1) return pendingResponse;
    throw new Error('Offline');
  });
  const first = resource.load();
  assert.equal(resource.load(true), first);
  assert.equal(resource.getSnapshot().status, 'loading');
  assert.equal(resource.getSnapshot().index, null);
  resolveResponse(new Response(JSON.stringify(fixture)));
  await first;
  assert.equal(calls, 1);
  assert.equal(resource.getSnapshot().status, 'ready');
  await resource.load();
  assert.equal(calls, 1);
  const refresh = resource.load(true);
  assert.equal(resource.getSnapshot().index, null);
  await refresh;
  assert.deepEqual(resource.getSnapshot(), { status: 'error', index: null });
});

test('HTTP failures and malformed index are errors; a valid empty index succeeds', async () => {
  for (const response of [new Response('', { status: 404 }), new Response('not JSON'), new Response('{"version":2}')]) {
    const resource = client.createPublicWikiClient('https://example.com/wiki.json', async () => response);
    await resource.load();
    assert.deepEqual(resource.getSnapshot(), { status: 'error', index: null });
  }
  const resource = client.createPublicWikiClient('https://example.com/wiki.json', async () => new Response(JSON.stringify({ ...fixture, documents: [], resources: [] })));
  await resource.load();
  assert.equal(resource.getSnapshot().status, 'ready');
  assert.deepEqual(resource.getSnapshot().index.documents, []);
});

test('only the active iframe at the configured wiki origin can request Escape dismissal', () => {
  const source = {};
  const event = { origin: 'http://localhost:5187', source, data: { type: 'amuwiki:escape' } };
  assert.equal(wiki.isWikiEscapeMessage(event, source, 'http://localhost:5187/amuwiki/'), true);
  assert.equal(wiki.isWikiEscapeMessage({ ...event, origin: 'https://example.com' }, source, 'http://localhost:5187/amuwiki/'), false);
  assert.equal(wiki.isWikiEscapeMessage(event, {}, 'http://localhost:5187/amuwiki/'), false);
  assert.equal(wiki.isWikiEscapeMessage({ ...event, data: null }, source, 'http://localhost:5187/amuwiki/'), false);
  assert.equal(wiki.isWikiEscapeMessage({ ...event, data: { type: 'other' } }, source, 'http://localhost:5187/amuwiki/'), false);
});

test('integrated search retains posts/assets and links wiki matches to the blog reading route', () => {
  const index = wiki.parsePublicWikiIndex(fixture);
  const posts = [{ id: 'post', title: 'Fixture post', body: 'body', tags: [], createdAt: '2026-10-07' }];
  const assets = [{ id: 'asset', title: 'Fixture asset', path: 'asset.png', fileName: 'asset.png', tags: [] }];
  const results = search.buildSearchResults(posts, assets, 'fixture', index.documents, 'http://localhost:5186/wiki/');
  assert.deepEqual(results.map((result) => result.type), ['post', 'asset', 'wiki', 'wiki']);
  assert.equal(results[2].href, 'http://localhost:5186/wiki/#wiki-one');
  assert.equal(search.buildSearchResults([], [], 'needle', index.documents)[0].href, 'https://cha-amu.github.io/wiki/#wiki-one');
  assert.equal(search.buildSearchResults([], [], 'needle', index.documents).length, 1);
  assert.equal(search.buildSearchResults([], [], 'Fixture source', index.documents).length, 1);
  assert.equal(search.buildSearchResults(posts, assets, '', index.documents).length, 0);
});

test('wiki controls and search states have Korean, English and Japanese translations', () => {
  assert.equal(i18n.translateFor('ko', 'nav.wiki'), '아무위키');
  assert.equal(i18n.translateFor('en', 'nav.wiki'), 'Wiki');
  assert.equal(i18n.translateFor('ja', 'wiki.expand'), '拡大');
  for (const language of ['ko', 'en', 'ja']) {
    for (const key of ['wiki.related', 'wiki.closeGraph', 'wiki.graphFor', 'wiki.localGraphTitle', 'wiki.fullGraphTitle', 'search.partialTotal', 'search.sourceFailed', 'search.wikiGroup', 'search.loadMoreWiki']) {
      const translation = i18n.translateFor(language, key, { title: 'Title', count: 2, source: 'Wiki' });
      assert.ok(translation && !translation.includes('{'), `${language}: ${key}`);
    }
  }
});
