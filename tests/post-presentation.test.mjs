import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('fenced code, tables, and ordered lists render as block Markdown', async () => {
  const source = compileSource('src/utils/markdown.ts', 'markdown.js');
  const { renderMarkdown } = await importSource(source);
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
