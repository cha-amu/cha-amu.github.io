import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createD1 } from './helpers/d1.mjs';

test('the third migration drops only the two post tables and can be reapplied', async (t) => {
  const { db } = await createD1(t, {}, ['0001_security.sql', '0002_content.sql']);
  await db.batch([
    db.prepare("INSERT INTO posts (id, body) VALUES ('post', 'old body')"),
    db.prepare("INSERT INTO post_deletions (id, nonce) VALUES ('deleted', 'nonce')"),
    db.prepare("INSERT INTO guestbook_entries (id, message, passwordHash) VALUES ('g', 'message', 'hash')"),
    db.prepare("INSERT INTO things (id, title) VALUES ('t', 'thing')"),
    db.prepare("INSERT INTO asset_overrides (assetId, status) VALUES ('a', 'hidden')"),
    db.prepare("INSERT INTO audit_log (id, action) VALUES ('audit', 'admin.login')"),
    db.prepare("INSERT INTO rate_limit_windows VALUES ('counter', 3, 9999999999999)"),
    db.prepare("INSERT INTO guestbook_entry_ips VALUES ('g', 'hash', 'v1', 'active', 'date', 'date')"),
    db.prepare("INSERT INTO ip_bans VALUES ('guestbook.create', 'hash', 'reason', 'g', 'date', NULL)"),
    db.prepare("INSERT INTO ip_ban_events (scope, ip_hash, action, created_at) VALUES ('guestbook.create', 'hash', 'ban', 'date')")
  ]);
  const tables = ['guestbook_entries', 'things', 'asset_overrides', 'audit_log', 'rate_limit_windows', 'guestbook_entry_ips', 'ip_bans', 'ip_ban_events'];
  const snapshot = () => Promise.all(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()));
  const before = (await snapshot()).map(({ results }) => results);
  const schema = async () => (await db.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name NOT IN ('posts', 'post_deletions') ORDER BY name").all()).results;
  const beforeSchema = await schema();
  const sql = await readFile(new URL('../worker/migrations/0003_drop_post_tables.sql', import.meta.url), 'utf8');
  assert.deepEqual(sql.trim().split('\n'), ['DROP TABLE IF EXISTS post_deletions;', 'DROP TABLE IF EXISTS posts;']);
  for (let run = 0; run < 2; run++) {
    await db.exec(sql);
    assert.deepEqual((await snapshot()).map(({ results }) => results), before);
    assert.deepEqual(await schema(), beforeSchema);
    assert.deepEqual((await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('posts', 'post_deletions')").all()).results, []);
  }
});
