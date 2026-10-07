#!/usr/bin/env node
// Sets the gateway Worker's admin password. Asks for the new password twice in the
// terminal without echoing it. The Worker stores only sha256(password + ADMIN_PASSWORD_PEPPER).
// The pepper lives in the local .env and is used for nothing else, so a missing one is
// generated, uploaded and saved too. Values go to wrangler through stdin and are never printed.
// ADMIN_PASSWORD in .env is deliberately not read: it may be an old password.
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

function askHidden(question) {
  return new Promise((resolve) => {
    const input = process.stdin;
    let value = '';
    process.stdout.write(question);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          input.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (character === '\r' || character === '\n') {
          input.off('data', onData);
          input.setRawMode(false);
          input.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
        else value += character;
      }
    };
    input.on('data', onData);
  });
}

if (!process.stdin.isTTY) {
  console.error('Run this in a terminal. It asks for the new admin password.');
  process.exit(1);
}
const password = await askHidden('New admin password: ');
if (!password) {
  console.error('The password is empty. Nothing changed.');
  process.exit(1);
}
if (password !== await askHidden('Type it again: ')) {
  console.error('The two entries differ. Nothing changed.');
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
