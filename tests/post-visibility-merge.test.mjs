import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = mkdtempSync(join(tmpdir(), 'cha-amu-post-merge-'));
const compile = spawnSync(resolve(repoRoot, 'node_modules/.bin/tsc'), [
  '--ignoreConfig',
  'src/stores/postMerge.ts',
  'src/stores/controlSnapshot.ts',
  '--target', 'ES2022',
  '--module', 'ESNext',
  '--moduleResolution', 'Bundler',
  '--outDir', outputDirectory
], { cwd: repoRoot, encoding: 'utf8' });
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout || 'Failed to compile post merge helpers.');
const compiledSource = readFileSync(join(outputDirectory, 'stores/postMerge.js'), 'utf8');
const compiledModuleUrl = `data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`;
const controlsSource = readFileSync(join(outputDirectory, 'stores/controlSnapshot.js'), 'utf8');
const controlsModuleUrl = `data:text/javascript;base64,${Buffer.from(controlsSource).toString('base64')}`;
const { mergePosts, normalizePostList } = await import(compiledModuleUrl);
const { resolveControlSnapshot } = await import(controlsModuleUrl);
rmSync(outputDirectory, { recursive: true, force: true });

function post(id, status, updatedAt, overrides = {}) {
  return {
    id,
    title: `${status}-${id}`,
    body: `${status}-body`,
    tags: [],
    status,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt,
    ...overrides
  };
}

test('Sheet visibility controls suppress newer storage posts', () => {
  const storagePosts = [
    post('hidden-post', 'published', '2026-07-12T10:00:00.000Z'),
    post('deleted-post', 'published', '2026-07-12T10:00:00.000Z'),
    post('visible-post', 'published', '2026-07-12T10:00:00.000Z')
  ];
  const sheetControls = [
    post('hidden-post', 'hidden', '2026-07-11T10:00:00.000Z'),
    post('deleted-post', 'deleted', '2026-07-11T10:00:00.000Z')
  ];

  const visibleIds = normalizePostList(mergePosts(storagePosts, sheetControls)).map((item) => item.id);
  assert.deepEqual(visibleIds, ['visible-post']);
});

test('newer published storage content remains visible when Sheet also says published', () => {
  const merged = normalizePostList(mergePosts(
    [post('current', 'published', '2026-07-12T10:00:00.000Z', { body: 'new storage body' })],
    [post('current', 'published', '2026-07-11T10:00:00.000Z', { body: 'old sheet body' })]
  ));

  assert.equal(merged.length, 1);
  assert.equal(merged[0].body, 'new storage body');
});

test('cached controls are used when the Sheet request fails, including a known empty set', () => {
  const cached = [post('hidden-post', 'hidden', '2026-07-11T10:00:00.000Z')];
  const failure = { status: 'rejected', reason: new Error('Sheet unavailable') };

  assert.equal(resolveControlSnapshot(failure, cached), cached);
  assert.deepEqual(resolveControlSnapshot(failure, []), []);
  assert.throws(() => resolveControlSnapshot(failure, null), /Sheet unavailable/);
});

test('asset visibility controls also require a live or cached snapshot', () => {
  const cached = [{ assetId: 'asset:hidden', status: 'hidden' }];
  const failure = { status: 'rejected', reason: new Error('Override API unavailable') };

  assert.equal(resolveControlSnapshot(failure, cached), cached);
  assert.deepEqual(resolveControlSnapshot(failure, []), []);
  assert.throws(() => resolveControlSnapshot(failure, null), /Override API unavailable/);
});
