#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT_TABLES, storedRecord } from '../src/content-schema.js';

export const MAX_STATEMENT_BYTES = 64 * 1024;
const byteLength = (value) => Buffer.byteLength(value, 'utf8');

function literal(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numeric cell.');
    return String(value);
  }
  const text = String(value);
  // SQLite literals accept newlines and doubled quotes. NUL needs a hex literal.
  return text.includes('\0') ? `CAST(X'${Buffer.from(text).toString('hex')}' AS TEXT)` : `'${text.replace(/'/g, "''")}'`;
}

function textChunks(value) {
  const chunks = [];
  let chunk = '', bytes = 0;
  for (const char of value) {
    const size = byteLength(char);
    if (bytes + size > 8192) { chunks.push(chunk); chunk = ''; bytes = 0; }
    chunk += char; bytes += size;
  }
  chunks.push(chunk);
  return chunks;
}

export function generateImport(exported) {
  if (!exported || !exported.sheets || typeof exported.sheets !== 'object') {
    throw new Error('Expected { exportedAt, sheets: { guestbook, things, assetOverrides, auditLog } }.');
  }
  const statements = [];
  const counts = {};
  const records = new Map();
  // Only the remaining content sheets are imported; other sheets are ignored.
  // Validate the complete input before writing any output. Missing columns are
  // blank cells; a missing sheet is an incomplete export, not permission to erase it.
  for (const [name, definition] of Object.entries(CONTENT_TABLES)) {
    const rows = exported.sheets[name];
    if (!Array.isArray(rows)) throw new Error(`Missing sheet array: ${name}`);
    const seen = new Set();
    records.set(name, rows.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${name}[${index}] is not a row object.`);
      const key = String(row[definition.key] ?? '');
      if (!key.trim() || seen.has(key)) throw new Error(`${name}[${index}] has a missing or duplicate ${definition.key}.`);
      seen.add(key);
      return storedRecord(definition, { ...row, [definition.key]: key });
    }));
    counts[definition.table] = rows.length;
  }
  // No security tables or rate windows are touched. Re-running replaces, never appends.
  for (const { table } of Object.values(CONTENT_TABLES)) statements.push(`DELETE FROM ${table};`);
  let staged = false;
  for (const [name, definition] of Object.entries(CONTENT_TABLES)) {
    const rows = records.get(name);
    if (!rows.length) continue;
    const columns = rows[0].columns;
    const prefix = `INSERT INTO ${definition.table} (${columns.join(',')}) VALUES\n`;
    let tuples = [], bytes = byteLength(prefix) + 1;
    const flush = () => {
      if (tuples.length) statements.push(prefix + tuples.join(',\n') + ';');
      tuples = []; bytes = byteLength(prefix) + 1;
    };
    for (const { values } of rows) {
      const tuple = `(${values.map(literal).join(',')})`;
      const size = byteLength(tuple);
      if (byteLength(prefix) + size + 1 > MAX_STATEMENT_BYTES) {
        flush();
        // A single large text row can exceed the SQL statement limit. Assemble
        // its text cells from small chunks, then insert the complete row with SELECT.
        // This also keeps JSON CHECK constraints valid for tags/extra at every step.
        if (!staged) {
          statements.push('CREATE TABLE IF NOT EXISTS content_import_chunks (field INTEGER NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (field, part));');
          staged = true;
        }
        statements.push('DELETE FROM content_import_chunks;');
        const expressions = values.map((value, field) => {
          if (typeof value === 'number') return literal(value);
          textChunks(String(value)).forEach((chunk, part) => {
            statements.push(`INSERT INTO content_import_chunks (field, part, value) VALUES (${field},${part},${literal(chunk)});`);
          });
          return `(SELECT group_concat(value, '') FROM (SELECT value FROM content_import_chunks WHERE field = ${field} ORDER BY part))`;
        });
        statements.push(`INSERT INTO ${definition.table} (${columns.join(',')}) SELECT ${expressions.join(',')};`);
      } else {
        if (bytes + size + (tuples.length ? 2 : 0) > MAX_STATEMENT_BYTES) flush();
        bytes += size + (tuples.length ? 2 : 0);
        tuples.push(tuple);
      }
    }
    flush();
  }
  if (staged) statements.push('DROP TABLE content_import_chunks;');
  for (const { table } of Object.values(CONTENT_TABLES)) {
    statements.push(`SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM ${table};`);
  }
  for (const statement of statements) {
    if (byteLength(statement) > MAX_STATEMENT_BYTES) throw new Error('Internal error: generated SQL exceeds the statement limit.');
  }
  return { statements, counts, sql: '-- Generated content snapshot. Freeze writers before applying. Contains password hashes; keep private.\n' + statements.join('\n') + '\n' };
}

async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Usage: node worker/scripts/import-sheets-export.mjs <export.json> <output.sql>');
  if (resolve(input) === resolve(output)) throw new Error('Input and output must be different files.');
  const generated = generateImport(JSON.parse(await readFile(input, 'utf8')));
  await writeFile(output, generated.sql, { mode: 0o600 });
  for (const [table, count] of Object.entries(generated.counts)) console.log(`${table}: ${count}`);
  console.log(`Wrote ${generated.statements.length} statements (each <= ${MAX_STATEMENT_BYTES} UTF-8 bytes) to ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
