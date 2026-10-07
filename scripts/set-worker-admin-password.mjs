#!/usr/bin/env node
// Sets the gateway Worker's admin password from ADMIN_PASSWORD in the local .env.
// The Worker stores only sha256(ADMIN_PASSWORD + ADMIN_PASSWORD_PEPPER). The pepper is
// used for nothing else, so a missing one is generated, saved to .env and uploaded too.
// Values go to wrangler through stdin and are never printed.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = new URL('../.env', import.meta.url);
let envText = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
const env = Object.fromEntries(envText.split('\n')
  .filter((line) => /^[A-Z0-9_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));

const password = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || '';
if (!password) {
  console.error('Put the new admin password in .env as ADMIN_PASSWORD=..., then run this again.');
  process.exit(1);
}

let pepper = env.ADMIN_PASSWORD_PEPPER || '';
const newPepper = pepper.length < 32;
if (newPepper) pepper = randomBytes(32).toString('hex');

function putSecret(name, value) {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    cwd: `${root}worker`, input: value, stdio: ['pipe', 'inherit', 'inherit']
  });
  if (result.status !== 0) {
    console.error(`Setting ${name} failed.`);
    process.exit(result.status || 1);
  }
}

// Upload the pepper before the hash, and save it locally only after both are in place,
// so a failed run never leaves .env and the Worker with different peppers.
if (newPepper) putSecret('ADMIN_PASSWORD_PEPPER', pepper);
putSecret('ADMIN_PASSWORD_HASH', createHash('sha256').update(password + pepper).digest('hex'));
if (newPepper) {
  envText = /^ADMIN_PASSWORD_PEPPER=.*$/m.test(envText)
    ? envText.replace(/^ADMIN_PASSWORD_PEPPER=.*$/m, `ADMIN_PASSWORD_PEPPER=${pepper}`)
    : `${envText.replace(/\n?$/, '\n')}ADMIN_PASSWORD_PEPPER=${pepper}\n`;
  await writeFile(envPath, envText, { mode: 0o600 });
}
console.log('Updated the Worker admin password. Sessions already open stay valid until they expire.');
