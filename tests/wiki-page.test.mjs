import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = mkdtempSync(join(tmpdir(), 'cha-amu-native-wiki-'));
const modules = new Map();
function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(join(output, name), 'utf8').replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => {
    if (specifier === 'react' || specifier === 'katex') return `from '${import.meta.resolve(specifier)}'`;
    assert.ok(specifier.startsWith('.'), `Unexpected import: ${specifier}`);
    const dependency = resolve(output, dirname(name), `${specifier}.js`).slice(output.length + 1);
    return `from '${moduleUrl(dependency)}'`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(name, url);
  return url;
}

let content, publicWiki, markdown, i18n;
try {
  const compiled = spawnSync(join(root, 'node_modules/.bin/tsc'), [
    '--ignoreConfig', 'src/utils/wikiContent.ts', 'src/utils/markdown.ts',
    '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler',
    '--esModuleInterop', '--outDir', output
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  [content, publicWiki, markdown, i18n] = await Promise.all([
    import(moduleUrl('utils/wikiContent.js')), import(moduleUrl('utils/publicWiki.js')),
    import(moduleUrl('utils/markdown.js')), import(moduleUrl('i18n.js'))
  ]);
} finally {
  rmSync(output, { recursive: true, force: true });
}

const document = (id, changes = {}) => ({
  id, title: id, kind: 'concept', tags: [], body: '', links: [], sources: [], updated: '', ...changes
});
const index = (documents, resources = []) => ({ version: 1, generatedAt: '2026-10-07', documents, resources });
const resource = (kind, id, documentIds) => ({
  kind, id, documentIds, title: id, url: `https://cha-amu.github.io/${kind === 'post' ? 'posts' : 'archive'}/#${encodeURIComponent(id)}`
});

test('wiki search preserves public order and intersects the query with every selected tag', () => {
  const documents = [
    document('typed', { title: 'TypeScript notes', tags: ['code', 'learning'], body: 'Narrowing types' }),
    document('한국어 문서', { title: '독서', tags: ['learning'], body: '본문에만 있는 검색어' }),
    document('source', { tags: ['code'], sources: [{ label: 'Original Evidence', url: 'https://example.com/reference' }] })
  ];
  const before = structuredClone(documents);
  const ids = (query, tags = []) => content.filterWikiDocuments(documents, query, tags).map((item) => item.id);
  assert.deepEqual(ids(''), ['typed', '한국어 문서', 'source']);
  assert.deepEqual(ids('  TYPESCRIPT  '), ['typed']);
  assert.deepEqual(ids('NARROWING'), ['typed']);
  assert.deepEqual(ids('검색어'), ['한국어 문서']);
  assert.deepEqual(ids('한국어 문서'), ['한국어 문서']);
  assert.deepEqual(ids('original evidence'), ['source']);
  assert.deepEqual(ids('example.com/reference'), ['source']);
  assert.deepEqual(ids('', ['code', 'learning']), ['typed']);
  assert.deepEqual(ids('evidence', ['learning']), []);
  assert.deepEqual(ids('', ['CODE']), []);
  assert.deepEqual(documents, before);
});

test('only the validated public index supplies searchable documents and connected resources', () => {
  const parsed = publicWiki.parsePublicWikiIndex(index([
    document('public', { body: 'Published needle', tags: ['shared'] }),
    document('private', { body: 'Secret needle', private: true })
  ], [resource('post', 'visible', ['public']), { ...resource('post', 'hidden', ['public']), private: true }]));
  assert.ok(parsed);
  assert.deepEqual(content.filterWikiDocuments(parsed.documents, 'needle').map((item) => item.id), ['public']);
  assert.deepEqual(content.wikiDocumentRelations(parsed, 'public').resources.map((item) => item.id), ['visible']);
  assert.equal(content.findWikiDocument(parsed.documents, 'private'), null);
  assert.equal(content.createWikiLinkResolver(parsed.documents)('/wiki/#private'), null);
  const empty = publicWiki.parsePublicWikiIndex(index([]));
  assert.deepEqual(content.filterWikiDocuments(empty.documents, ''), []);
  assert.deepEqual(content.wikiDocumentRelations(empty, 'public'), { outgoing: [], backlinks: [], resources: [] });
});

test('direct hashes decode exactly once and resolve only exact public IDs beyond the initial list batch', () => {
  const specialIds = ['한글 /&?=#😀', 'doc:literal-id', 'literal%2Fid', 'percent%id', 'd'.repeat(80)];
  const documents = [
    ...Array.from({ length: 15 }, (_, i) => document(`document-${i}`)),
    ...specialIds.map((id) => document(id))
  ];
  for (const id of ['document-14', ...specialIds]) {
    const href = content.nativeWikiDocumentUrl(id);
    assert.equal(href, `/wiki/#${encodeURIComponent(id)}`);
    const decoded = content.wikiDocumentIdFromHash(new URL(href, 'https://cha-amu.github.io').hash);
    assert.equal(decoded, id);
    assert.equal(content.findWikiDocument(documents, decoded)?.id, id);
  }
  assert.equal(content.findWikiDocument(documents, 'literal/id'), null);
  assert.equal(content.findWikiDocument(documents, 'literal-id'), null);
  assert.equal(content.findWikiDocument(documents, 'document-140'), null);
  for (const hash of ['', '#', 'document-14', '#%E0%A4%A', '#%ZZ', '#%00', '#%20trimmed', '#trimmed%20', '#\ud800', `#${'x'.repeat(81)}`]) {
    assert.equal(content.wikiDocumentIdFromHash(hash), '', hash);
  }
  for (const id of ['', ' leading', '\ud800', 'x'.repeat(81)]) assert.equal(content.nativeWikiDocumentUrl(id), '');
});

test('old and native wiki document links resolve to the current blog, with no guessed or unknown targets', () => {
  const id = '한글 /&?=#😀';
  const encoded = encodeURIComponent(id);
  const resolveLink = content.createWikiLinkResolver([document(id)], 'http://localhost:5186');
  for (const href of [
    `https://cha-amu.github.io/amuwiki/#${encoded}`,
    `https://cha-amu.github.io/wiki/#${encoded}`,
    `http://localhost:5186/wiki/#${encoded}`,
    `/amuwiki/#${encoded}`, `/wiki/#${encoded}`, `/wiki#${encoded}`, `#${encoded}`,
    `/wiki/?from=source#${encoded}`
  ]) {
    assert.deepEqual(resolveLink(href), { href: `/wiki/#${encoded}`, target: '_self' }, href);
  }
  for (const href of [
    '/wiki/#missing', '/amuwiki/#missing', 'https://cha-amu.github.io/amuwiki/#missing',
    'https://cha-amu.github.io/wiki/#missing', '#missing', '/wiki/#%ZZ', '/wiki/#%20trimmed'
  ]) assert.equal(resolveLink(href), null, href);
  assert.deepEqual(resolveLink('https://cha-amu.github.io/amuwiki/'), { href: '/wiki/', target: '_self' });
  assert.deepEqual(resolveLink('/wiki/'), { href: '/wiki/', target: '_self' });
  assert.deepEqual(resolveLink('https://example.com/wiki/#missing'), { href: 'https://example.com/wiki/#missing', target: '_blank' });
  assert.deepEqual(resolveLink('https://cha-amu.github.io.example.com/amuwiki/#missing'), {
    href: 'https://cha-amu.github.io.example.com/amuwiki/#missing', target: '_blank'
  });
  assert.deepEqual(resolveLink('/posts/#connected'), { href: '/posts/#connected', target: '_self' });
  for (const href of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.com/', 'https://exam\nple.com/', '\\wiki\\#missing']) {
    assert.equal(resolveLink(href), null, href);
  }
});

test('Markdown link resolution preserves fenced and inline code, images, and ordinary external references', () => {
  const old = 'https://cha-amu.github.io/amuwiki/#alpha';
  const source = [
    `[Old](${old}) and [Native](/wiki/#alpha)`,
    '[Unavailable document](/wiki/#missing)',
    `Inline \`[Code](${old})\``,
    '```md', `[Fenced](${old})`, '[Fenced missing](/wiki/#missing)', '```',
    '~~~md', `[Tilde fence](${old})`, '~~~',
    `![Image](${old})`,
    '[External](https://example.com/source?a=1&b=2)',
    '[Punctuation](https://cha-amu.github.io/amuwiki/#a&b)'
  ].join('\n');
  const resolveLink = content.createWikiLinkResolver([document('alpha'), document('a&b')]);
  const calls = [];
  const html = markdown.renderMarkdown(source, { resolveLink: (href) => { calls.push(href); return resolveLink(href); } });
  assert.equal((html.match(/<a href="\/wiki\/#alpha"/g) || []).length, 2);
  assert.doesNotMatch(html, /Unavailable document/);
  assert.ok(html.includes(`<code>[Code](${old})</code>`));
  assert.ok(html.includes(`[Fenced](${old})\n[Fenced missing](/wiki/#missing)</code></pre>`));
  assert.ok(html.includes(`[Tilde fence](${old})</code></pre>`));
  assert.match(html, /<img src="https:\/\/cha-amu\.github\.io\/amuwiki\/#alpha"/);
  assert.match(html, /<a href="https:\/\/example\.com\/source\?a=1&amp;b=2" target="_blank"/);
  assert.match(html, /<a href="\/wiki\/#a%26b"[^>]*>Punctuation<\/a>/);
  assert.ok(!html.includes('<a href="/wiki/#alpha" target="_blank"'));
  assert.deepEqual(calls, [old, '/wiki/#alpha', '/wiki/#missing', 'https://example.com/source?a=1&b=2', 'https://cha-amu.github.io/amuwiki/#a&b']);
  assert.ok(source.includes(`[Old](${old})`));
});

test('outgoing links, backlinks, and resource links follow explicit public edges only', () => {
  const data = index([
    document('alpha', { tags: ['shared'], body: '[Mention](/wiki/#tag-only)', links: [
      { target: 'doc:beta', type: 'uses' }, { target: 'beta', type: 'uses' },
      { target: 'beta', type: 'supports' }, { target: 'unknown', type: 'related' }
    ] }),
    document('beta', { links: [{ target: 'doc:alpha', type: 'related' }] }),
    document('replacement', { links: [{ target: 'alpha', type: 'supersedes' }] }),
    document('tag-only', { tags: ['shared'] })
  ], [resource('post', 'connected', ['alpha']), resource('asset', 'image.png', ['alpha']), resource('post', 'other', ['beta'])]);
  const before = structuredClone(data);
  const relations = content.wikiDocumentRelations(data, 'alpha');
  assert.deepEqual(relations.outgoing.map((link) => [link.document.id, link.types]), [['beta', ['uses', 'supports']]]);
  assert.deepEqual(relations.backlinks.map((link) => [link.document.id, link.types]), [
    ['beta', ['related']], ['replacement', ['supersedes']]
  ]);
  assert.deepEqual(relations.resources.map((item) => [item.kind, item.id]), [['post', 'connected'], ['asset', 'image.png']]);
  assert.deepEqual(content.wikiDocumentRelations(data, 'unknown'), { outgoing: [], backlinks: [], resources: [] });
  assert.deepEqual(data, before);
});

test('wiki summaries show Markdown link labels without leaking old or native hrefs', () => {
  const resolveLink = content.createWikiLinkResolver([document('rigid-body')]);
  const summary = content.wikiExcerpt([
    '[강체 물리](https://cha-amu.github.io/amuwiki/#rigid-body)',
    '[**운동 법칙**](/wiki/#rigid-body)',
    '[없는 문서](/wiki/#missing)',
    'Type**Script**와 <literal> & 기호'
  ].join('\n'), { resolveLink });
  assert.equal(summary, '강체 물리 운동 법칙 TypeScript와 <literal> & 기호');
  assert.doesNotMatch(summary, /https:|cha-amu|amuwiki|rigid-body|없는 문서/);
});

test('wiki summaries preserve literal inline and fenced code after stripping rendered tags', () => {
  const source = [
    '# Examples',
    '`[literal](https://example.com/path) &amp; <b>`',
    '```md', '[code](/wiki/#missing) **not bold** <tag>', '```',
    '~~~html', '<math>x</math>', '~~~'
  ].join('\n');
  const summary = content.wikiExcerpt(source, { maxLength: 300, resolveLink: content.createWikiLinkResolver([]) });
  assert.equal(summary, 'Examples [literal](https://example.com/path) &amp; <b> [code](/wiki/#missing) **not bold** <tag> <math>x</math>');
  assert.equal(content.wikiExcerpt('😀😀다음', { maxLength: 2 }), '😀😀…');
  assert.equal(content.wikiExcerpt(' \n '), '');
});

test('public resource detail links use the current blog and retain long, punctuated IDs exactly once', () => {
  const id = `assets/${'folder/'.repeat(40)}자료 &그림#1.png`;
  assert.ok(id.length > 240 && id.length <= 512);
  for (const kind of ['post', 'asset']) {
    const item = resource(kind, id, ['alpha']);
    const href = content.wikiResourceUrl(item);
    assert.equal(href, `/${kind === 'post' ? 'posts' : 'archive'}/#${encodeURIComponent(id)}`);
    const url = new URL(href, 'http://localhost:5186');
    assert.equal(url.origin, 'http://localhost:5186');
    assert.equal(decodeURIComponent(url.hash.slice(1)), id);
    assert.equal(content.wikiResourceUrl({ ...item, id: 'x'.repeat(513) }), null);
    assert.equal(content.wikiResourceUrl({ ...item, url: 'javascript:alert(1)' }), null);
  }
});

test('source links matching public blog resources open their native detail routes', () => {
  const resources = [resource('post', 'public post', ['alpha']), resource('asset', 'assets/image &1.png', ['alpha'])];
  const resolveLink = content.createWikiLinkResolver([document('alpha')], 'http://localhost:5186', resources);
  for (const item of resources) {
    assert.deepEqual(resolveLink(item.url), { href: content.wikiResourceUrl(item), target: '_self' });
  }
  // Only an explicit public resource record can map a canonical source URL.
  assert.deepEqual(resolveLink('https://cha-amu.github.io/posts/#unlisted'), {
    href: 'https://cha-amu.github.io/posts/#unlisted', target: '_blank'
  });
});

test('native wiki UI and global graph titles have Korean, English, and Japanese translations', () => {
  const keys = [
    'wiki.allGraphTitle', 'wiki.allGraphFrameTitle',
    ...[
      'title', 'failed', 'empty', 'search', 'searchQuery', 'searchPlaceholder', 'list', 'noMatch', 'loadMore',
      'notFound', 'backToList', 'outgoing', 'backlinks', 'sources', 'resources', 'updated',
      'kind.concept', 'kind.project', 'kind.decision', 'kind.question',
      'relation.related', 'relation.uses', 'relation.supports', 'relation.supersedes'
    ].map((key) => `nativewiki.${key}`)
  ];
  for (const language of ['ko', 'en', 'ja']) {
    for (const key of keys) {
      const translated = i18n.translateFor(language, key, { count: 12, date: '2026-10-07' });
      assert.equal(typeof translated, 'string', `${language}: ${key}`);
      assert.ok(translated.length && !translated.includes('{'), `${language}: ${key}`);
    }
  }
  assert.equal(i18n.translateFor('ja', 'nativewiki.backToList'), '文書一覧へ');
  assert.equal(i18n.translateFor('ko', 'nativewiki.kind.concept'), '개념');
  assert.equal(i18n.translateFor('en', 'nativewiki.kind.concept'), 'Concept');
});
