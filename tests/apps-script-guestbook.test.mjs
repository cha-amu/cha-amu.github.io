import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');

function bytes(value) {
  return Array.from(value);
}

function loadAppsScript() {
  const appended = [];
  const cacheValues = new Map();
  let uuid = 0;

  const cache = {
    get(key) {
      const item = cacheValues.get(key);
      if (!item) return null;
      if (item.expiresAt <= Date.now()) {
        cacheValues.delete(key);
        return null;
      }
      return item.value;
    },
    put(key, value, ttlSeconds) {
      cacheValues.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    remove(key) {
      cacheValues.delete(key);
    }
  };

  const properties = new Map([
    ['GUESTBOOK_SERVER_PEPPER', 'guestbook-test-pepper-00000000000000000000000000000000']
  ]);

  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: (key) => properties.get(key) || null };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => `test-uuid-${++uuid}`,
      computeDigest: (_algorithm, value) => bytes(createHash('sha256').update(String(value)).digest()),
      computeHmacSha256Signature: (value, secret) => bytes(createHmac('sha256', String(secret)).update(String(value)).digest()),
      newBlob: (value) => ({ getBytes: () => bytes(Buffer.from(String(value))) })
    },
    CacheService: { getScriptCache: () => cache },
    LockService: {
      getScriptLock() {
        return { waitLock() {}, releaseLock() {} };
      }
    },
    __captureAppend: (sheetName, object) => appended.push({ sheetName, object: { ...object } })
  });

  vm.runInContext(`${source}\nappendObject_ = function (sheetName, object) { __captureAppend(sheetName, object); };`, context);

  return {
    appended,
    cacheValues,
    createGuestbook: vm.runInContext('createGuestbook_', context)
  };
}

function input(overrides = {}) {
  return {
    name: '',
    message: '안녕하세요',
    deletePassword: 'delete-password',
    clientId: 'guestbook-client-0001',
    turnstileToken: '',
    website: '',
    ...overrides
  };
}

test('빈 이름은 ㅇㅁ으로 저장하고 메시지 공백은 정리한다', () => {
  const app = loadAppsScript();
  const result = app.createGuestbook(input({ name: '   ', message: '  안녕하세요  ' }));

  assert.equal(result.name, 'ㅇㅁ');
  assert.equal(result.message, '안녕하세요');
  assert.equal(app.appended.length, 1);
  assert.equal(app.appended[0].object.name, 'ㅇㅁ');
  assert.equal('clientId' in app.appended[0].object, false);
  assert.equal('website' in app.appended[0].object, false);
});

test('입력한 이름은 공백만 정리해 유지한다', () => {
  const app = loadAppsScript();
  const result = app.createGuestbook(input({ name: '  이름  ' }));

  assert.equal(result.name, '이름');
});

test('메시지와 비밀번호는 계속 필수다', () => {
  assert.throws(
    () => loadAppsScript().createGuestbook(input({ message: '   ' })),
    /메시지와 비밀번호/
  );
  assert.throws(
    () => loadAppsScript().createGuestbook(input({ deletePassword: '' })),
    /메시지와 비밀번호/
  );
});

test('작성 속도 제한은 사이트 전체가 아니라 브라우저별로 적용한다', () => {
  const app = loadAppsScript();

  app.createGuestbook(input({ clientId: 'guestbook-client-0001', message: '첫 번째' }));
  app.createGuestbook(input({ clientId: 'guestbook-client-0002', message: '두 번째' }));
  assert.throws(
    () => app.createGuestbook(input({ clientId: 'guestbook-client-0001', message: '세 번째' })),
    /작성이 너무 빠릅니다/
  );
});

test('같은 브라우저의 동일 메시지 반복을 막는다', () => {
  const app = loadAppsScript();

  app.createGuestbook(input({ clientId: 'guestbook-client-0001', message: 'Same   Message' }));
  for (const key of app.cacheValues.keys()) {
    if (key.startsWith('guestbook-create-burst:')) app.cacheValues.delete(key);
  }
  assert.throws(
    () => app.createGuestbook(input({ clientId: 'guestbook-client-0001', message: ' same message ' })),
    /같은 메시지가 반복/
  );
});

test('짧은 인사말은 여러 방문자가 같게 남겨도 허용한다', () => {
  const app = loadAppsScript();

  app.createGuestbook(input({ clientId: 'guestbook-client-0001', message: '안녕' }));
  app.createGuestbook(input({ clientId: 'guestbook-client-0002', message: '안녕' }));
  app.createGuestbook(input({ clientId: 'guestbook-client-0003', message: '안녕' }));
  assert.equal(app.appended.length, 3);
});

test('공백과 대소문자만 다른 같은 긴 메시지는 세 번째부터 막는다', () => {
  const app = loadAppsScript();
  const message = 'This is the same long guestbook message';

  app.createGuestbook(input({ clientId: 'guestbook-client-0001', message }));
  app.createGuestbook(input({ clientId: 'guestbook-client-0002', message: ' this  is the same long guestbook message ' }));
  assert.throws(
    () => app.createGuestbook(input({ clientId: 'guestbook-client-0003', message: message.toUpperCase() })),
    /같은 긴 메시지가 반복/
  );
});

test('1,000자 이후의 다른 접미사로 동일 메시지 제한을 우회할 수 없다', () => {
  const app = loadAppsScript();
  const prefix = '가'.repeat(1000);

  const first = app.createGuestbook(input({ clientId: 'guestbook-client-0001', message: `${prefix}A` }));
  const second = app.createGuestbook(input({ clientId: 'guestbook-client-0002', message: `${prefix}B` }));
  assert.equal(first.message.length, 1000);
  assert.equal(second.message, first.message);
  assert.throws(
    () => app.createGuestbook(input({ clientId: 'guestbook-client-0003', message: `${prefix}C` })),
    /같은 긴 메시지가 반복/
  );
});

test('브라우저 ID와 메시지를 바꿔도 전체 비상 상한을 넘을 수 없다', () => {
  const app = loadAppsScript();

  for (let index = 0; index < 120; index += 1) {
    app.createGuestbook(input({
      clientId: `emergency-client-${String(index).padStart(4, '0')}`,
      message: `m-${index}`
    }));
  }
  assert.throws(
    () => app.createGuestbook(input({ clientId: 'emergency-client-0120', message: 'm-120' })),
    /요청이 일시적으로 많습니다/
  );
});

test('허니팟을 채운 요청은 저장과 제한 카운트 전에 거부한다', () => {
  const app = loadAppsScript();

  assert.throws(
    () => app.createGuestbook(input({ website: 'https://spam.example' })),
    /요청을 처리할 수 없습니다/
  );
  assert.equal(app.appended.length, 0);
  assert.equal(app.cacheValues.size, 0);
});
