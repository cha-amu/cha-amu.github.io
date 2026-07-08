import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const ENV_PATH = '.env';
const WRITE_ENV = process.argv.includes('--write-env');

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    env[key] = value;
  }
  return env;
}

function serializeEnv(baseText, values) {
  const hiddenKeys = new Set(['ADMIN_PASSWORD_HASH']);
  const lines = baseText.split(/\r?\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) return line;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!(key in values)) return line;
    seen.add(key);
    if (hiddenKeys.has(key)) return line;
    return `${key}=${values[key]}`;
  });
  const missing = Object.keys(values).filter((key) => !seen.has(key) && !hiddenKeys.has(key));
  if (missing.length) {
    if (next.length && next[next.length - 1] !== '') next.push('');
    next.push('# Apps Script server-side config. Real secrets stay local only.');
    for (const key of missing) next.push(`${key}=${values[key]}`);
  }
  return next.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function randomHex() {
  return randomBytes(32).toString('hex');
}

let envText = existsSync(ENV_PATH) ? await readFile(ENV_PATH, 'utf8') : '';
let env = { ...parseEnv(envText), ...process.env };

let adminPassword = env.ADMIN_PASSWORD || '';
if (!adminPassword) {
  const rl = createInterface({ input, output });
  adminPassword = await rl.question('관리자 비밀번호 하나만 입력: ');
  rl.close();
}

if (!adminPassword) {
  throw new Error('ADMIN_PASSWORD is required. Put only ADMIN_PASSWORD in .env or enter it when prompted.');
}

const values = {
  SPREADSHEET_ID: env.SPREADSHEET_ID || '1pztnlU8M1ioKFBlDeTstAnuhnXDsiTij_V7P5_M1MG4',
  ADMIN_PASSWORD: adminPassword,
  ADMIN_PASSWORD_PEPPER: env.ADMIN_PASSWORD_PEPPER || randomHex(),
  ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET || randomHex(),
  GUESTBOOK_SERVER_PEPPER: env.GUESTBOOK_SERVER_PEPPER || randomHex(),
  GUESTBOOK_PASSWORD_ITERATIONS: env.GUESTBOOK_PASSWORD_ITERATIONS || '1',
  ADMIN_SESSION_TTL_MS: env.ADMIN_SESSION_TTL_MS || '60000',
  TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY || ''
};

values.ADMIN_PASSWORD_HASH = createHash('sha256')
  .update(values.ADMIN_PASSWORD + values.ADMIN_PASSWORD_PEPPER)
  .digest('hex');

if (WRITE_ENV) {
  envText = serializeEnv(envText, values);
  await writeFile(ENV_PATH, envText);
  console.log(`Updated ${ENV_PATH}`);
}

console.log('\nApps Script Properties에 넣을 값:\n');
for (const key of [
  'SPREADSHEET_ID',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_PASSWORD_PEPPER',
  'ADMIN_SESSION_SECRET',
  'GUESTBOOK_SERVER_PEPPER',
  'GUESTBOOK_PASSWORD_ITERATIONS',
  'ADMIN_SESSION_TTL_MS',
  'TURNSTILE_SECRET_KEY'
]) {
  console.log(`${key}=${values[key]}`);
}

console.log('\n네가 직접 정할 값은 ADMIN_PASSWORD 하나뿐입니다. 나머지는 자동 생성값입니다.');
