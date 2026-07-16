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

function compileAppsScriptClient() {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'cha-amu-thing-image-'));
  const compile = spawnSync(tscPath, [
    '--ignoreConfig',
    'src/api/appsScriptClient.ts',
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--types', 'vite/client',
    '--outDir', outputDirectory
  ], { cwd: repoRoot, encoding: 'utf8' });

  try {
    assert.equal(compile.status, 0, compile.stderr || compile.stdout || 'Failed to compile the Apps Script client.');
    let source = readFileSync(join(outputDirectory, 'api/appsScriptClient.js'), 'utf8');
    const replacements = [
      [/'\.\.\/config'/, dataModule(`
        export const config = { apiUrl: '', gatewayUrl: '' };
        export const isApiConfigured = false;
      `)],
      [/'\.\.\/data\/mockData'/, dataModule(`
        export const getMockGuestbook = () => [];
        export const getMockPosts = () => [];
      `)],
      [/'\.\.\/i18n'/, dataModule('export const translate = () => "";')],
      [/'\.\.\/utils\/localCache'/, dataModule(`
        export const readCache = () => null;
        export const readCachePayload = () => null;
        export const writeCache = () => undefined;
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

function thing(imageUrl) {
  return {
    id: 'thing-1',
    title: 'Thing',
    description: '',
    url: 'https://example.com/app',
    imageUrl,
    status: 'visible',
    sortOrder: 0,
    updatedAt: '2026-07-17T00:00:00.000Z'
  };
}

test('Thing normalization preserves only optional HTTP(S) representative images', async () => {
  const source = compileAppsScriptClient();
  const { normalizeThing } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  assert.equal(normalizeThing(thing(' https://images.example/cover.png ')).imageUrl, 'https://images.example/cover.png');
  assert.equal(normalizeThing(thing('http://images.example/cover.png')).imageUrl, 'http://images.example/cover.png');
  assert.equal(normalizeThing(thing('')).imageUrl, undefined);
  assert.equal(normalizeThing(thing('javascript:alert(1)')).imageUrl, undefined);
  assert.equal(normalizeThing(thing('https://user:password@images.example/cover.png')).imageUrl, undefined);
  assert.equal(normalizeThing(thing('/relative/cover.png')).imageUrl, undefined);
});
