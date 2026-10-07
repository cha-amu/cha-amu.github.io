import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';
import { generateImport, MAX_STATEMENT_BYTES } from '../worker/scripts/import-sheets-export.mjs';
// This is the parser used by `wrangler d1 execute --file`. Parsing the emitted
// file catches quoting/newline mistakes that testing only an array of SQL misses.
const { unstable_splitSqlQuery: splitSql } = await import('../worker/node_modules/wrangler/wrangler-dist/cli.js');
const exec = promisify(execFile);
const emptyExport = () => ({ exportedAt: '2026-10-07T00:00:00.000Z', sheets: { guestbook: [], things: [], assetOverrides: [], auditLog: [] } });

async function applyFile(db, sql) {
  const statements = splitSql(sql);
  for (let offset = 0; offset < statements.length; offset += 30) {
    await db.batch(statements.slice(offset, offset + 30).map((statement) => db.prepare(statement)));
  }
}

test('import CLI generates replayable SQL, preserves every real column/type and never touches security tables', async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'cha-amu-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'export.json'); const output = join(directory, 'content.sql');
  const exported = emptyExport();
  const body = "첫 줄 '따옴표';\n둘째 줄 -- not a comment\n\r\nemoji 😀 \\ path\n'); DROP TABLE ip_bans; --";
  exported.sheets.guestbook = [{ id: 'entry', name: '이름', message: 'nul\0value', status: 'hidden', createdAt: '2026-01-01', passwordSalt: 'salt', passwordHash: 'hash', passwordHashAlgorithm: 'PBKDF2-HMAC-SHA256+pepper', passwordHashIterations: 50000, hiddenReason: 'reason' }];
  exported.sheets.things = [{ id: 'thing', title: '앱', description: '', url: 'https://app.test/', status: 'visible', sortOrder: -2, updatedAt: '', imageUrl: 'https://image.test/a.png' }];
  exported.sheets.assetOverrides = [{ assetId: 'asset', displayName: '', description: body, tags: ['가', '나'], sourceUrl: '', status: 'deleted', sortOrder: 4.5, updatedAt: '' }, { assetId: 'blank', tags: '', sortOrder: '' }];
  exported.sheets.auditLog = [{ id: 'audit', action: 'admin.login', targetType: 'admin', targetId: '', createdAt: '2026-01-01T00:00:00.000Z' }];
  await f.mapping('entry', 'hash-security', 'pending');
  await f.db.prepare("INSERT INTO ip_bans VALUES ('guestbook.create', 'hash-security', 'reason', 'entry', 'date', NULL)").run();
  await f.db.prepare("INSERT INTO ip_ban_events (scope, ip_hash, action, source_entry_id, reason, created_at) VALUES ('guestbook.create', 'hash-security', 'ban', 'entry', 'reason', 'date')").run();
  await f.db.prepare("INSERT INTO rate_limit_windows VALUES ('existing-counter', 7, 9999999999999)").run();
  const protectedTables = ['guestbook_entry_ips', 'ip_bans', 'ip_ban_events', 'rate_limit_windows'];
  const before = await Promise.all(protectedTables.map((table) => f.rows(table)));
  await f.seed('assetOverrides', [{ assetId: 'old-content' }]);
  await writeFile(input, JSON.stringify(exported));
  const result = await exec(process.execPath, ['worker/scripts/import-sheets-export.mjs', input, output], { cwd: new URL('..', import.meta.url) });
  for (const [table, count] of Object.entries({ guestbook_entries: 1, things: 1, asset_overrides: 2, audit_log: 1 })) assert.match(result.stdout, new RegExp(`${table}: ${count}`));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const sql = await readFile(output, 'utf8');
  await applyFile(f.db, sql);
  const first = await Promise.all(['guestbook_entries', 'things', 'asset_overrides', 'audit_log'].map((table) => f.rows(table)));
  await applyFile(f.db, sql);
  assert.deepEqual(await Promise.all(['guestbook_entries', 'things', 'asset_overrides', 'audit_log'].map((table) => f.rows(table))), first);
  assert.deepEqual(await Promise.all(protectedTables.map((table) => f.rows(table))), before);
  assert.equal((await f.rows('guestbook_entries'))[0].passwordHashIterations, 50000);
  assert.equal((await f.rows('guestbook_entries'))[0].message, 'nul\0value');
  const assets = await f.call('assetOverride.listPublic');
  assert.equal(assets[0].description, body);
  assert.deepEqual(assets[0].tags, ['가', '나']); assert.equal(assets[0].sortOrder, 4.5); assert.equal(assets[1].sortOrder, ''); assert.equal(assets[1].tags, '');
  assert.equal((await f.call('thing.listPublic'))[0].imageUrl, 'https://image.test/a.png');
  assert.equal((await f.admin('admin.guestbook.list'))[0].ipBanAvailable, true);
});

test('large imports use multi-row INSERTs below 64KiB, including an 8307-row audit snapshot and oversized Unicode descriptions', async (t) => {
  const f = await fixture(t);
  const exported = emptyExport();
  const body = "본문 한글😀 'quote'\n".repeat(8000);
  exported.sheets.assetOverrides = [{ assetId: 'large', description: body, status: 'visible', tags: ['태그'] }];
  exported.sheets.auditLog = Array.from({ length: 8307 }, (_, i) => ({ id: `audit-${i}`, action: 'assetOverride.update', targetType: 'asset', targetId: `자료-${i}`, createdAt: '2026-10-07T00:00:00.000Z' }));
  const generated = generateImport(exported);
  assert.equal(generated.counts.audit_log, 8307);
  assert.ok(generated.statements.every((sql) => Buffer.byteLength(sql) <= MAX_STATEMENT_BYTES));
  const auditInserts = generated.statements.filter((sql) => sql.startsWith('INSERT INTO audit_log'));
  assert.ok(auditInserts.length > 1 && auditInserts.length < 30, 'audit rows are batched, not one statement per row');
  await applyFile(f.db, generated.sql);
  assert.equal((await f.rows('audit_log')).length, 8307);
  assert.equal((await f.call('assetOverride.listPublic'))[0].description, body);
  assert.equal(await f.db.prepare("SELECT name FROM sqlite_master WHERE name = 'content_import_chunks'").first(), null);
  await applyFile(f.db, generated.sql);
  assert.equal((await f.rows('audit_log')).length, 8307);
  assert.equal((await f.call('assetOverride.listPublic'))[0].description, body);
});

test('incomplete exports, duplicate ids and malformed rows fail before producing a destructive SQL file', async (t) => {
  for (const value of [{}, { sheets: { guestbook: [] } }, { ...emptyExport(), sheets: { ...emptyExport().sheets, guestbook: [null] } }, { ...emptyExport(), sheets: { ...emptyExport().sheets, guestbook: [{ message: 'no id' }] } }, { ...emptyExport(), sheets: { ...emptyExport().sheets, guestbook: [{ id: 'a' }, { id: 'a' }] } }]) {
    assert.throws(() => generateImport(value), /Expected|Missing|row object|missing or duplicate/);
  }
  const directory = await mkdtemp(join(tmpdir(), 'cha-amu-invalid-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'bad.json'); const output = join(directory, 'existing.sql');
  await writeFile(input, '{}'); await writeFile(output, 'must stay');
  await assert.rejects(exec(process.execPath, ['worker/scripts/import-sheets-export.mjs', input, output], { cwd: new URL('..', import.meta.url) }));
  assert.equal(await readFile(output, 'utf8'), 'must stay');
});

test('retired sheets are optional and ignored even when they contain malformed rows', () => {
  const exported = emptyExport();
  const expected = generateImport(exported);
  exported.sheets.posts = [null, { body: 'ignored' }];
  exported.sheets.postDeletions = { ignored: true };
  assert.deepEqual(generateImport(exported), expected);
  assert.deepEqual(Object.keys(expected.counts), ['guestbook_entries', 'things', 'asset_overrides', 'audit_log']);
  assert.doesNotMatch(expected.sql, /\bposts\b|post_deletions/);
});
