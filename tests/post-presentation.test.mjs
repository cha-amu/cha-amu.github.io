import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscPath = resolve(repoRoot, 'node_modules/.bin/tsc');

function compileSource(sourcePath, outputPath) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'cha-amu-post-presentation-'));
  const compile = spawnSync(tscPath, [
    '--ignoreConfig',
    sourcePath,
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--outDir', outputDirectory
  ], { cwd: repoRoot, encoding: 'utf8' });

  try {
    assert.equal(compile.status, 0, compile.stderr || compile.stdout || `Failed to compile ${sourcePath}.`);
    return readFileSync(join(outputDirectory, outputPath), 'utf8');
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

async function importSource(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function importCompiledSource(sourcePath, outputPath) {
  const outputDirectory = mkdtempSync(join(repoRoot, '.test-post-presentation-'));
  const compile = spawnSync(tscPath, [
    '--ignoreConfig',
    sourcePath,
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--esModuleInterop',
    '--outDir', outputDirectory
  ], { cwd: repoRoot, encoding: 'utf8' });

  try {
    assert.equal(compile.status, 0, compile.stderr || compile.stdout || `Failed to compile ${sourcePath}.`);
    return await import(`${pathToFileURL(join(outputDirectory, outputPath)).href}?test=${Date.now()}`);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

test('fenced code, tables, and ordered lists render as block Markdown', async () => {
  const { renderMarkdown } = await importCompiledSource('src/utils/markdown.ts', 'markdown.js');
  const html = renderMarkdown([
    '## 구조',
    '',
    '```text',
    '정적 <사이트>',
    '    ↓',
    'API',
    '```',
    '',
    '| 이름 | 상태 |',
    '| --- | :---: |',
    '| 글 | 공개 |',
    '',
    '1. 첫째',
    '2. 둘째'
  ].join('\n'));

  assert.match(html, /<pre><code class="language-text">정적 &lt;사이트&gt;\n    ↓\nAPI<\/code><\/pre>/);
  assert.match(html, /<table>/);
  assert.match(html, /<thead><tr><th>이름<\/th><th class="markdown-align-center">상태<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>글<\/td><td class="markdown-align-center">공개<\/td><\/tr><\/tbody>/);
  assert.match(html, /<ol>\n<li>첫째<\/li>\n<li>둘째<\/li>\n<\/ol>/);
  assert.doesNotMatch(html, /```/);
});

test('inline and display math render with KaTeX without changing code spans', async () => {
  const { renderMarkdown } = await importCompiledSource('src/utils/markdown.ts', 'markdown.js');
  const html = renderMarkdown([
    '섭식량은 $C = 0.375 \\times \\frac{F}{F + 0.02}$로 계산한다.',
    '',
    '$$',
    'r_{\\mathrm{net}} = P_{\\mathrm{gross}} - R - S',
    '$$',
    '',
    '`$not_math$`, \\$10, 가격 $10와 $20은 수식이 아니다.',
    '',
    '```text',
    '$still_not_math$',
    '```'
  ].join('\n'));

  assert.match(html, /class="markdown-math markdown-math--inline"/);
  assert.match(html, /class="markdown-math markdown-math--block"/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<mfrac>/);
  assert.ok(html.includes('<code>$not_math$</code>, $10, 가격 $10와 $20은 수식이 아니다.'));
  assert.ok(html.includes('<pre><code class="language-text">$still_not_math$</code></pre>'));
  assert.doesNotMatch(html, /katex-error/);
});

test('date-only metadata renders without inventing a clock time', async () => {
  const compiled = compileSource('src/utils/date.ts', 'utils/date.js');
  const source = compiled.replace(
    "import { getLanguageLocale } from '../i18n';",
    "const getLanguageLocale = () => 'ko-KR';"
  );
  const { formatDate } = await importSource(source);

  assert.equal(formatDate('2026-07-12'), '2026. 7. 12.');
  assert.match(formatDate('2026-07-12T11:34:38.256Z'), /(오전|오후) \d{1,2}:\d{2}/);
});

test('post activity timestamp prefers the latest edit over publication time', async () => {
  const source = compileSource('src/utils/postTimestamp.ts', 'postTimestamp.js');
  const { postTimestamp } = await importSource(source);

  assert.equal(postTimestamp({
    createdAt: '2026-07-12T10:00:00.000Z',
    publishedAt: '2026-07-12T10:30:00.000Z',
    updatedAt: '2026-07-12T11:34:38.256Z'
  }), '2026-07-12T11:34:38.256Z');
});
