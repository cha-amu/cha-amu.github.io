// Undici 7 (bundled with Miniflare 4) uses these ES2024 string methods.
// Node 20.18 lacks them; keep the compatibility shim in the test process only.
import { toUSVString } from 'node:util';
import { readFile } from 'node:fs/promises';
if (!String.prototype.toWellFormed) {
  Object.defineProperty(String.prototype, 'toWellFormed', {
    value() { return toUSVString(String(this)); }, configurable: true, writable: true
  });
}
if (!String.prototype.isWellFormed) {
  Object.defineProperty(String.prototype, 'isWellFormed', {
    value() { return toUSVString(String(this)) === String(this); }, configurable: true, writable: true
  });
}
const { Miniflare } = await import('../../worker/node_modules/miniflare/dist/src/index.js');

export async function createD1(t, options = {}, migrations = ['0001_security.sql', '0002_content.sql', '0003_drop_post_tables.sql']) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    compatibilityDate: '2026-07-11',
    d1Databases: { SECURITY_DB: 'test-content' },
    ...options
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('SECURITY_DB');
  for (const name of migrations) {
    const sql = await readFile(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8');
    // D1 exec expects one statement per line. Migrations contain no SQL literals
    // with semicolons or triggers; the importer has its own statement API.
    await db.exec(sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean).join(';\n') + ';');
  }
  return { db, mf };
}
