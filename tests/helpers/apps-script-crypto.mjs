// Run the unchanged production algorithm as an independent migration oracle.
// Utilities byte[] are signed in Apps Script; model that rather than only comparing
// two implementations using WebCrypto or unsigned Node buffers.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../apps-script/Code.js', import.meta.url), 'utf8');
const input = (value) => Buffer.from(Array.isArray(value) ? value : String(value), 'utf8');
const signed = (buffer) => Array.from(buffer, (byte) => byte > 127 ? byte - 256 : byte);
export function appsScriptHash(password, salt, algorithm, iterations, pepper, fallback = '1') {
  const properties = { GUESTBOOK_SERVER_PEPPER: pepper, GUESTBOOK_PASSWORD_ITERATIONS: fallback };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || null }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, value) => signed(createHash('sha256').update(input(value)).digest()),
      computeHmacSha256Signature: (value, key) => signed(createHmac('sha256', input(key)).update(input(value)).digest()),
      newBlob: (value) => ({ getBytes: () => signed(input(value)) })
    }
  });
  vm.runInContext(source, context);
  return context.hashPasswordForEntry_(password, salt, algorithm, iterations);
}
