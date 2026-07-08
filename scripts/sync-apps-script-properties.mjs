import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const execFileAsync = promisify(execFile);
const ENV_PATH = '.env';
const CODE_PATH = 'apps-script/Code.js';
const DEPLOYMENT_ID = process.env.APPS_SCRIPT_DEPLOYMENT_ID || 'AKfycbwn-qQpt3j2bxyzNtQeKSodJdo0Apvust80TPAxlp7U0jg2bZ0GI0FoJF3c4ZOTnQjt';
const WEBAPP_URL = `https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec`;

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
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

async function readAdminPassword(env) {
  if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD;
  const rl = createInterface({ input, output });
  const value = await rl.question('관리자 비밀번호 하나만 입력: ');
  rl.close();
  if (!value) throw new Error('관리자 비밀번호가 필요합니다.');
  return value;
}

async function clasp(args) {
  const result = await execFileAsync('npx', ['@google/clasp', ...args], { cwd: process.cwd() });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (/Unable to|not found|permission|denied|error:/i.test(output)) {
    throw new Error(`clasp ${args.join(' ')} failed: ${output}`);
  }
  return output;
}

function versionFrom(output) {
  const match = output.match(/Created version\s+(\d+)/i);
  if (!match) throw new Error(`Could not parse Apps Script version from: ${output}`);
  return match[1];
}

function withTemporaryEndpoint(source, setupToken) {
  if (source.includes("case 'setup.properties'")) throw new Error('Temporary setup endpoint already exists in Code.js.');
  const routed = source.replace(
    "case 'admin.login': return adminLogin_(body);",
    "case 'admin.login': return adminLogin_(body);\n    case 'setup.properties': return setupProperties_(body);"
  );
  if (routed === source) throw new Error('Could not patch route_ for temporary setup endpoint.');
  const setupFunction = `\nfunction setupProperties_(body) {\n  const expected = '${setupToken}';\n  assert_(body.setupToken === expected, 'Invalid setup token.');\n  const properties = body.properties || {};\n  PropertiesService.getScriptProperties().setProperties(properties, false);\n  return { keys: Object.keys(properties) };\n}\n`;
  const patched = routed.replace('\nfunction listPublicPosts_() {', `${setupFunction}\nfunction listPublicPosts_() {`);
  if (patched === routed) throw new Error('Could not insert temporary setup function.');
  return patched;
}

async function deployCurrentCode(description) {
  await clasp(['push', '--force']);
  const output = await clasp(['create-version', description]);
  const version = versionFrom(output);
  await clasp(['update-deployment', DEPLOYMENT_ID, '--versionNumber', version, '--description', description]);
  return version;
}

let envText = existsSync(ENV_PATH) ? await readFile(ENV_PATH, 'utf8') : '';
const env = { ...parseEnv(envText), ...process.env };
const adminPassword = await readAdminPassword(env);

const valuesForEnv = {
  SPREADSHEET_ID: env.SPREADSHEET_ID || '1pztnlU8M1ioKFBlDeTstAnuhnXDsiTij_V7P5_M1MG4',
  ADMIN_PASSWORD: adminPassword,
  ADMIN_PASSWORD_PEPPER: env.ADMIN_PASSWORD_PEPPER || randomHex(),
  ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET || randomHex(),
  GUESTBOOK_SERVER_PEPPER: env.GUESTBOOK_SERVER_PEPPER || randomHex(),
  GUESTBOOK_PASSWORD_ITERATIONS: env.GUESTBOOK_PASSWORD_ITERATIONS || '1',
  ADMIN_SESSION_TTL_MS: env.ADMIN_SESSION_TTL_MS || '60000',
  TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY || ''
};
valuesForEnv.ADMIN_PASSWORD_HASH = createHash('sha256')
  .update(valuesForEnv.ADMIN_PASSWORD + valuesForEnv.ADMIN_PASSWORD_PEPPER)
  .digest('hex');

const properties = {
  SPREADSHEET_ID: valuesForEnv.SPREADSHEET_ID,
  ADMIN_PASSWORD_HASH: valuesForEnv.ADMIN_PASSWORD_HASH,
  ADMIN_PASSWORD_PEPPER: valuesForEnv.ADMIN_PASSWORD_PEPPER,
  ADMIN_SESSION_SECRET: valuesForEnv.ADMIN_SESSION_SECRET,
  GUESTBOOK_SERVER_PEPPER: valuesForEnv.GUESTBOOK_SERVER_PEPPER,
  GUESTBOOK_PASSWORD_ITERATIONS: valuesForEnv.GUESTBOOK_PASSWORD_ITERATIONS,
  ADMIN_SESSION_TTL_MS: valuesForEnv.ADMIN_SESSION_TTL_MS,
  TURNSTILE_SECRET_KEY: valuesForEnv.TURNSTILE_SECRET_KEY
};

await writeFile(ENV_PATH, serializeEnv(envText, valuesForEnv));

const originalCode = await readFile(CODE_PATH, 'utf8');
const setupToken = randomBytes(48).toString('base64url');
try {
  await writeFile(CODE_PATH, withTemporaryEndpoint(originalCode, setupToken));
  await deployCurrentCode('Temporary property sync endpoint');

  const response = await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'setup.properties', setupToken, properties })
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`Apps Script property sync failed: ${json.error || JSON.stringify(json)}`);
} finally {
  await writeFile(CODE_PATH, originalCode);
  await deployCurrentCode('Remove temporary property sync endpoint');
}

console.log('관리자 비밀번호 기반 Apps Script Properties 동기화 완료.');
console.log('직접 입력한 값: ADMIN_PASSWORD 하나');
console.log('자동 생성/반영된 값: ADMIN_PASSWORD_HASH, ADMIN_PASSWORD_PEPPER, ADMIN_SESSION_SECRET, GUESTBOOK_SERVER_PEPPER');
