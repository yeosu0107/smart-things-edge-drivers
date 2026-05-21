# Seoul Bus TTS — API_ONLY (OAuth-In) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WEBHOOK_SMART_APP을 폐기하고 SmartThings API_ONLY (OAuth-In) 패턴으로 전환해, 모바일 앱 install / Developer Workspace 의존 없이 가상 버튼 push로 버스 도착 정보를 갤럭시 홈 미니 TTS + busmessage capability로 출력한다.

**Architecture:** Netlify Function 한 개가 (a) 1회용 OAuth flow (`/` + `/oauth/callback`), (b) SmartThings lifecycle (PING / CONFIRMATION / EVENT), (c) subscription register를 모두 처리. `refresh_token`은 Netlify Blobs에 저장하고 access_token은 만료 시 자동 갱신. 가상 버튼 push 이벤트가 들어오면 token 로드 → 서울 버스 API → 메시지 빌드 → `/devices/{id}/commands`로 busmessage + speechSynthesis 전송.

**Tech Stack:** Node.js 18+, Netlify Functions, `@netlify/blobs`, raw `fetch` for SmartThings REST API, `node --test` for unit tests. 기존 `@smartthings/smartapp` SDK 의존은 제거.

**Spec:** [`docs/superpowers/specs/2026-05-20-bus-tts-api-only-design.md`](../specs/2026-05-20-bus-tts-api-only-design.md)

---

## File Structure

```
bus-tts-smartapp/
├─ package.json                       (modify: drop @smartthings/smartapp, add @netlify/blobs)
├─ public/
│  └─ index.html                       (modify: OAuth 시작 페이지로 교체)
├─ netlify/functions/
│  └─ smartapp.js                      (rewrite: GET/POST router + 3개 lifecycle 핸들러)
├─ src/
│  ├─ bus.js                           (unchanged)
│  ├─ oauth.js                         (new: URL builder, code exchange, token refresh, getValidAccessToken)
│  ├─ storage.js                       (new: Netlify Blobs wrapper — interface로 모킹 가능)
│  ├─ subscription.js                  (new: subscription register payload + HTTP)
│  └─ smartthings.js                   (new: device command sender — busmessage / TTS)
└─ test/
   ├─ bus.test.js                      (unchanged)
   ├─ oauth.test.js                    (new)
   ├─ storage.test.js                  (new — in-memory store roundtrip)
   ├─ subscription.test.js             (new)
   ├─ smartthings.test.js              (new)
   └─ smartapp.test.js                 (rewrite — lifecycle dispatch)
```

각 `src/*.js`는 순수 함수 + injected dependencies (fetch, store) 구조로 작성해 테스트에서 의존을 주입한다.

---

## Task 1: 사전 정리 & 의존성 교체

**Files:**
- Modify: `bus-tts-smartapp/package.json`
- Delete: `bus-tts-smartapp/src/smartapp.js` (이전 SDK 기반 코드 제거)
- Modify: `bus-tts-smartapp/test/smartapp.test.js` (한번 빈 placeholder로 → 나중에 재작성)

- [ ] **Step 1: package.json에서 SDK 빼고 Blobs 추가**

Edit `bus-tts-smartapp/package.json` to:

```json
{
  "name": "bus-tts-smartapp",
  "version": "2.0.0",
  "private": true,
  "description": "Seoul Bus TTS — API_ONLY (OAuth-In) Netlify app.",
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test 'test/*.test.js'" },
  "dependencies": {
    "@netlify/blobs": "^8.0.0"
  }
}
```

- [ ] **Step 2: lock 갱신 및 SDK 제거**

Run:
```bash
cd bus-tts-smartapp && rm -rf node_modules package-lock.json && npm install
```
Expected: `@netlify/blobs` 만 dependency에 남고 install 성공.

- [ ] **Step 3: 구 SmartApp SDK 코드 삭제 + 테스트 임시 placeholder**

```bash
rm bus-tts-smartapp/src/smartapp.js
```

Replace `bus-tts-smartapp/test/smartapp.test.js` body with:
```js
const test = require('node:test');
test.skip('rewritten in later tasks', () => {});
```

- [ ] **Step 4: 기존 테스트 통과 확인**

Run:
```bash
cd bus-tts-smartapp && npm test
```
Expected: `bus.test.js` 전부 PASS, `smartapp.test.js`는 skip. 실패 0.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/package.json bus-tts-smartapp/package-lock.json bus-tts-smartapp/src/smartapp.js bus-tts-smartapp/test/smartapp.test.js
git commit -m "refactor(bus-tts-smartapp): drop @smartthings/smartapp SDK, prep API_ONLY rewrite"
```

---

## Task 2: storage.js — Netlify Blobs wrapper (모킹 가능 interface)

**Files:**
- Create: `bus-tts-smartapp/src/storage.js`
- Create: `bus-tts-smartapp/test/storage.test.js`

`storage.js`는 두 가지 backend를 제공한다: 실제 Netlify Blobs (`createBlobStorage`)와 메모리(`createMemoryStorage`). 모든 호출자는 동일 interface (`{ load(), save(value) }`)를 사용 — Lifecycle 함수 안에서 production 인스턴스를, 테스트에서 메모리 인스턴스를 주입한다.

- [ ] **Step 1: 실패 테스트 작성**

Create `bus-tts-smartapp/test/storage.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStorage } = require('../src/storage');

test('memory storage load returns null when empty', async () => {
  const s = createMemoryStorage();
  assert.equal(await s.load(), null);
});

test('memory storage save then load returns saved value', async () => {
  const s = createMemoryStorage();
  await s.save({ access_token: 'a', refresh_token: 'r', expires_at: 1 });
  assert.deepEqual(await s.load(), { access_token: 'a', refresh_token: 'r', expires_at: 1 });
});

test('memory storage save overwrites previous value', async () => {
  const s = createMemoryStorage();
  await s.save({ v: 1 });
  await s.save({ v: 2 });
  assert.deepEqual(await s.load(), { v: 2 });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/storage.test.js`
Expected: FAIL — Cannot find module `../src/storage`.

- [ ] **Step 3: 구현 작성**

Create `bus-tts-smartapp/src/storage.js`:
```js
function createMemoryStorage() {
  let value = null;
  return {
    async load() { return value; },
    async save(v) { value = v; },
  };
}

function createBlobStorage({ getStore }) {
  const store = getStore('st-tokens');
  return {
    async load() { return await store.get('default', { type: 'json' }); },
    async save(v) { await store.setJSON('default', v); },
  };
}

module.exports = { createMemoryStorage, createBlobStorage };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/storage.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/storage.js bus-tts-smartapp/test/storage.test.js
git commit -m "feat(bus-tts-smartapp): add storage abstraction for OAuth tokens"
```

---

## Task 3: oauth.js — Authorize URL builder

**Files:**
- Create: `bus-tts-smartapp/src/oauth.js`
- Create: `bus-tts-smartapp/test/oauth.test.js`

- [ ] **Step 1: 실패 테스트 작성**

Create `bus-tts-smartapp/test/oauth.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthorizeUrl } = require('../src/oauth');

test('buildAuthorizeUrl encodes all required params', () => {
  const url = buildAuthorizeUrl({
    clientId: 'cid',
    redirectUri: 'https://example.com/oauth/callback',
    scopes: ['r:devices:*', 'x:devices:*'],
    state: 'abc123',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.smartthings.com/oauth/authorize');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('client_id'), 'cid');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://example.com/oauth/callback');
  assert.equal(parsed.searchParams.get('scope'), 'r:devices:* x:devices:*');
  assert.equal(parsed.searchParams.get('state'), 'abc123');
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: FAIL — Cannot find module `../src/oauth`.

- [ ] **Step 3: 구현 작성**

Create `bus-tts-smartapp/src/oauth.js`:
```js
function buildAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
  const u = new URL('https://api.smartthings.com/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', state);
  return u.toString();
}

module.exports = { buildAuthorizeUrl };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/oauth.js bus-tts-smartapp/test/oauth.test.js
git commit -m "feat(bus-tts-smartapp): add SmartThings OAuth authorize URL builder"
```

---

## Task 4: oauth.js — exchangeCode (authorization_code grant)

**Files:**
- Modify: `bus-tts-smartapp/src/oauth.js`
- Modify: `bus-tts-smartapp/test/oauth.test.js`

`exchangeCode`는 SmartThings token endpoint에 POST하고 응답을 정규화된 token 객체로 반환. 외부 HTTP은 `fetch` 인자로 주입해 모킹 가능하게.

- [ ] **Step 1: 실패 테스트 추가**

Append to `bus-tts-smartapp/test/oauth.test.js`:
```js
const { exchangeCode } = require('../src/oauth');

test('exchangeCode POSTs to token endpoint and normalizes response', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      async json() {
        return { access_token: 'at', refresh_token: 'rt', expires_in: 86400, installed_app_id: 'iap1' };
      },
    };
  };
  const now = 1_700_000_000_000;
  const tokens = await exchangeCode({
    code: 'xyz',
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUri: 'https://example.com/oauth/callback',
    fetch: fakeFetch,
    now: () => now,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/oauth/token');
  assert.equal(captured.init.method, 'POST');
  const body = new URLSearchParams(captured.init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'xyz');
  assert.equal(body.get('client_id'), 'cid');
  assert.equal(body.get('client_secret'), 'csec');
  assert.equal(body.get('redirect_uri'), 'https://example.com/oauth/callback');
  assert.equal(captured.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(tokens.access_token, 'at');
  assert.equal(tokens.refresh_token, 'rt');
  assert.equal(tokens.installed_app_id, 'iap1');
  assert.equal(tokens.expires_at, now + 86400 * 1000);
});

test('exchangeCode throws when response not ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, async text() { return 'bad'; } });
  await assert.rejects(
    () => exchangeCode({ code: 'x', clientId: 'c', clientSecret: 's', redirectUri: 'r', fetch: fakeFetch, now: () => 0 }),
    (e) => e.code === 'OAUTH_EXCHANGE_FAILED' && /400/.test(e.message)
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: FAIL — `exchangeCode is not a function`.

- [ ] **Step 3: 구현 추가**

Append to `bus-tts-smartapp/src/oauth.js`:
```js
async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetch, now }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const resp = await fetch('https://api.smartthings.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
    err.code = 'OAUTH_EXCHANGE_FAILED';
    throw err;
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    installed_app_id: data.installed_app_id,
    expires_at: now() + data.expires_in * 1000,
  };
}

module.exports = { buildAuthorizeUrl, exchangeCode };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/oauth.js bus-tts-smartapp/test/oauth.test.js
git commit -m "feat(bus-tts-smartapp): implement OAuth code exchange"
```

---

## Task 5: oauth.js — refreshAccessToken (refresh grant)

**Files:**
- Modify: `bus-tts-smartapp/src/oauth.js`
- Modify: `bus-tts-smartapp/test/oauth.test.js`

- [ ] **Step 1: 실패 테스트 추가**

Append to `bus-tts-smartapp/test/oauth.test.js`:
```js
const { refreshAccessToken } = require('../src/oauth');

test('refreshAccessToken sends refresh_token grant and returns normalized tokens', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, async json() { return { access_token: 'at2', refresh_token: 'rt2', expires_in: 86400 }; } };
  };
  const now = 1_700_000_000_000;
  const t = await refreshAccessToken({
    refreshToken: 'rt-old',
    clientId: 'cid',
    clientSecret: 'csec',
    fetch: fakeFetch,
    now: () => now,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/oauth/token');
  const body = new URLSearchParams(captured.init.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'rt-old');
  assert.equal(body.get('client_id'), 'cid');
  assert.equal(body.get('client_secret'), 'csec');
  assert.equal(t.access_token, 'at2');
  assert.equal(t.refresh_token, 'rt2');
  assert.equal(t.expires_at, now + 86400 * 1000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: FAIL — `refreshAccessToken is not a function`.

- [ ] **Step 3: 구현 추가**

Append to `bus-tts-smartapp/src/oauth.js` (and update module.exports):
```js
async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetch, now }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch('https://api.smartthings.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = new Error(`token refresh failed: ${resp.status} ${await resp.text()}`);
    err.code = 'OAUTH_REFRESH_FAILED';
    throw err;
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now() + data.expires_in * 1000,
  };
}

module.exports = { buildAuthorizeUrl, exchangeCode, refreshAccessToken };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/oauth.js bus-tts-smartapp/test/oauth.test.js
git commit -m "feat(bus-tts-smartapp): implement OAuth token refresh"
```

---

## Task 6: oauth.js — getValidAccessToken (만료 자동 갱신)

**Files:**
- Modify: `bus-tts-smartapp/src/oauth.js`
- Modify: `bus-tts-smartapp/test/oauth.test.js`

`getValidAccessToken`은 storage에서 token 로드 → 만료 60초 전이면 refresh → storage 갱신 → access_token 반환.

- [ ] **Step 1: 실패 테스트 추가**

Append to `bus-tts-smartapp/test/oauth.test.js`:
```js
const { getValidAccessToken } = require('../src/oauth');
const { createMemoryStorage } = require('../src/storage');

test('getValidAccessToken returns existing token when not expiring', async () => {
  const now = 1_700_000_000_000;
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'at', refresh_token: 'rt', expires_at: now + 3_600_000 });
  const token = await getValidAccessToken({
    storage,
    clientId: 'cid', clientSecret: 'csec',
    fetch: async () => { throw new Error('should not refresh'); },
    now: () => now,
  });
  assert.equal(token, 'at');
});

test('getValidAccessToken refreshes when token expires within 60s', async () => {
  const now = 1_700_000_000_000;
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'old', refresh_token: 'rt-old', expires_at: now + 30_000 });
  const fakeFetch = async () => ({
    ok: true,
    async json() { return { access_token: 'new', refresh_token: 'rt-new', expires_in: 86400 }; },
  });
  const token = await getValidAccessToken({
    storage,
    clientId: 'cid', clientSecret: 'csec',
    fetch: fakeFetch,
    now: () => now,
  });
  assert.equal(token, 'new');
  assert.equal((await storage.load()).refresh_token, 'rt-new');
});

test('getValidAccessToken throws NOT_AUTHORIZED when storage empty', async () => {
  const storage = createMemoryStorage();
  await assert.rejects(
    () => getValidAccessToken({
      storage, clientId: 'c', clientSecret: 's',
      fetch: async () => {}, now: () => 0,
    }),
    (e) => e.code === 'NOT_AUTHORIZED'
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: FAIL — `getValidAccessToken is not a function`.

- [ ] **Step 3: 구현 추가**

Append to `bus-tts-smartapp/src/oauth.js` (update module.exports):
```js
async function getValidAccessToken({ storage, clientId, clientSecret, fetch, now }) {
  const t = await storage.load();
  if (!t) {
    const err = new Error('no tokens — authorize via / first');
    err.code = 'NOT_AUTHORIZED';
    throw err;
  }
  if (now() >= t.expires_at - 60_000) {
    const refreshed = await refreshAccessToken({
      refreshToken: t.refresh_token,
      clientId, clientSecret, fetch, now,
    });
    const merged = { ...t, ...refreshed };
    await storage.save(merged);
    return merged.access_token;
  }
  return t.access_token;
}

module.exports = { buildAuthorizeUrl, exchangeCode, refreshAccessToken, getValidAccessToken };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/oauth.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/oauth.js bus-tts-smartapp/test/oauth.test.js
git commit -m "feat(bus-tts-smartapp): add getValidAccessToken with auto refresh"
```

---

## Task 7: subscription.js — subscription register (button.button)

**Files:**
- Create: `bus-tts-smartapp/src/subscription.js`
- Create: `bus-tts-smartapp/test/subscription.test.js`

- [ ] **Step 1: 실패 테스트 작성**

Create `bus-tts-smartapp/test/subscription.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSubscriptionPayload, registerSubscription } = require('../src/subscription');

test('buildSubscriptionPayload returns DEVICE subscription for button capability', () => {
  const p = buildSubscriptionPayload({ deviceId: 'd1', subscriptionName: 'busTrigger' });
  assert.deepEqual(p, {
    sourceType: 'DEVICE',
    device: {
      deviceId: 'd1',
      componentId: 'main',
      capability: 'button',
      attribute: 'button',
      stateChangeOnly: true,
      subscriptionName: 'busTrigger',
      value: '*',
    },
  });
});

test('registerSubscription POSTs to installedapps subscriptions endpoint with Bearer auth', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, async json() { return { id: 'sub1' }; } };
  };
  const out = await registerSubscription({
    accessToken: 'AT',
    installedAppId: 'IAP1',
    deviceId: 'd1',
    fetch: fakeFetch,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/installedapps/IAP1/subscriptions');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Authorization'], 'Bearer AT');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.device.deviceId, 'd1');
  assert.equal(body.device.capability, 'button');
  assert.deepEqual(out, { id: 'sub1' });
});

test('registerSubscription throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, async text() { return 'unauth'; } });
  await assert.rejects(
    () => registerSubscription({ accessToken: 'X', installedAppId: 'I', deviceId: 'd', fetch: fakeFetch }),
    (e) => e.code === 'SUBSCRIPTION_REGISTER_FAILED' && /401/.test(e.message)
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/subscription.test.js`
Expected: FAIL — Cannot find module `../src/subscription`.

- [ ] **Step 3: 구현 작성**

Create `bus-tts-smartapp/src/subscription.js`:
```js
function buildSubscriptionPayload({ deviceId, subscriptionName }) {
  return {
    sourceType: 'DEVICE',
    device: {
      deviceId,
      componentId: 'main',
      capability: 'button',
      attribute: 'button',
      stateChangeOnly: true,
      subscriptionName,
      value: '*',
    },
  };
}

async function registerSubscription({ accessToken, installedAppId, deviceId, fetch }) {
  const payload = buildSubscriptionPayload({ deviceId, subscriptionName: 'busTrigger' });
  const resp = await fetch(`https://api.smartthings.com/installedapps/${installedAppId}/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = new Error(`subscription register failed: ${resp.status} ${await resp.text()}`);
    err.code = 'SUBSCRIPTION_REGISTER_FAILED';
    throw err;
  }
  return await resp.json();
}

module.exports = { buildSubscriptionPayload, registerSubscription };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/subscription.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/subscription.js bus-tts-smartapp/test/subscription.test.js
git commit -m "feat(bus-tts-smartapp): add device subscription register"
```

---

## Task 8: smartthings.js — device command sender

**Files:**
- Create: `bus-tts-smartapp/src/smartthings.js`
- Create: `bus-tts-smartapp/test/smartthings.test.js`

`sendDeviceCommand(accessToken, deviceId, commands)` 으로 `/devices/{id}/commands`에 POST. 단일 함수에 capability/command/arguments를 받는다.

- [ ] **Step 1: 실패 테스트 작성**

Create `bus-tts-smartapp/test/smartthings.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendDeviceCommand } = require('../src/smartthings');

test('sendDeviceCommand POSTs commands to device endpoint with Bearer auth', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, async json() { return { results: [] }; } };
  };
  await sendDeviceCommand({
    accessToken: 'AT',
    deviceId: 'd1',
    commands: [{ capability: 'speechSynthesis', command: 'speak', arguments: ['hello'] }],
    fetch: fakeFetch,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/devices/d1/commands');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Authorization'], 'Bearer AT');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body, {
    commands: [{ component: 'main', capability: 'speechSynthesis', command: 'speak', arguments: ['hello'] }],
  });
});

test('sendDeviceCommand throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, async text() { return 'forbidden'; } });
  await assert.rejects(
    () => sendDeviceCommand({ accessToken: 'X', deviceId: 'd', commands: [], fetch: fakeFetch }),
    (e) => e.code === 'DEVICE_COMMAND_FAILED' && /403/.test(e.message)
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/smartthings.test.js`
Expected: FAIL — Cannot find module `../src/smartthings`.

- [ ] **Step 3: 구현 작성**

Create `bus-tts-smartapp/src/smartthings.js`:
```js
async function sendDeviceCommand({ accessToken, deviceId, commands, fetch }) {
  const body = {
    commands: commands.map(c => ({
      component: c.component || 'main',
      capability: c.capability,
      command: c.command,
      arguments: c.arguments || [],
    })),
  };
  const resp = await fetch(`https://api.smartthings.com/devices/${deviceId}/commands`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = new Error(`device command failed: ${resp.status} ${await resp.text()}`);
    err.code = 'DEVICE_COMMAND_FAILED';
    throw err;
  }
  return await resp.json();
}

module.exports = { sendDeviceCommand };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/smartthings.test.js`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/smartthings.js bus-tts-smartapp/test/smartthings.test.js
git commit -m "feat(bus-tts-smartapp): add device command sender"
```

---

## Task 9: public/index.html — Authorize 페이지

**Files:**
- Modify: `bus-tts-smartapp/public/index.html`

서버에서 OAuth state/URL을 사용자에게 노출하지 않는 단순한 방식: 페이지에 "Authorize" 링크가 있고, 링크는 `/.netlify/functions/smartapp/authorize`로 향한다 (다음 task에서 구현). 그 함수가 server-side state 생성 + SmartThings authorize로 redirect.

- [ ] **Step 1: index.html 교체**

Replace `bus-tts-smartapp/public/index.html` content with:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Seoul Bus TTS — 설정</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        max-width: 520px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6;
      }
      h1 { font-size: 1.5rem; }
      .btn {
        display: inline-block; padding: 0.6rem 1.2rem; background: #1976d2; color: #fff;
        text-decoration: none; border-radius: 0.4rem; font-weight: 600;
      }
      ol li { margin-bottom: 0.4rem; }
      code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
    </style>
  </head>
  <body>
    <h1>Seoul Bus TTS — 1회 설정</h1>
    <p>가상 버튼 push 이벤트 구독을 위해 SmartThings 계정 권한을 1회 위임해야 합니다.</p>
    <ol>
      <li>아래 버튼을 누르면 SmartThings 로그인 페이지로 이동합니다.</li>
      <li>로그인 + 권한 동의 후 자동으로 돌아옵니다.</li>
      <li>토큰이 저장되고 가상 디바이스의 button push subscription이 등록됩니다.</li>
    </ol>
    <p><a class="btn" href="/.netlify/functions/smartapp/authorize">SmartThings로 인증</a></p>
    <p style="margin-top:2rem;color:#666;font-size:0.9rem">
      이후 가상 디바이스 <code>버스 TTS</code>의 button push로 동작합니다.
    </p>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add bus-tts-smartapp/public/index.html
git commit -m "feat(bus-tts-smartapp): replace landing page with OAuth authorize entry"
```

---

## Task 10: netlify/functions/smartapp.js — router + GET handlers (/authorize, /oauth/callback)

**Files:**
- Modify: `bus-tts-smartapp/netlify/functions/smartapp.js`

function을 `event.path`/`event.httpMethod` 기준으로 분기. 4개 경로: `GET /authorize`, `GET /oauth/callback`, `POST` (lifecycle), `GET *` (404). Netlify 함수 경로 매핑: `/.netlify/functions/smartapp/authorize` 들어오면 `event.path`가 `/.netlify/functions/smartapp/authorize`.

이 task는 GET 2개만. POST lifecycle은 task 11/12에서.

- [ ] **Step 1: 실패 테스트 작성**

Create `bus-tts-smartapp/test/smartapp.test.js` (전체 교체):
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../src/smartapp');
const { createMemoryStorage } = require('../src/storage');

function makeEvent(method, path, body) {
  return {
    httpMethod: method,
    path,
    body: typeof body === 'string' ? body : (body ? JSON.stringify(body) : ''),
    isBase64Encoded: false,
  };
}

test('GET /authorize redirects to SmartThings OAuth authorize URL', async () => {
  const handler = createHandler({
    config: {
      clientId: 'cid', clientSecret: 'csec',
      redirectUri: 'https://example.com/.netlify/functions/smartapp/oauth/callback',
      busDeviceId: 'd1', busArsId: '12345',
    },
    storage: createMemoryStorage(),
    fetch: async () => { throw new Error('no fetch'); },
    now: () => 1_700_000_000_000,
  });
  const res = await handler(makeEvent('GET', '/.netlify/functions/smartapp/authorize'));
  assert.equal(res.statusCode, 302);
  const loc = res.headers.Location;
  assert.match(loc, /^https:\/\/api\.smartthings\.com\/oauth\/authorize\?/);
  const u = new URL(loc);
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://example.com/.netlify/functions/smartapp/oauth/callback');
});

test('GET /oauth/callback exchanges code, saves tokens, registers subscription', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://api.smartthings.com/oauth/token') {
      return { ok: true, async json() { return { access_token: 'AT', refresh_token: 'RT', expires_in: 86400, installed_app_id: 'IAP' }; } };
    }
    if (url.endsWith('/installedapps/IAP/subscriptions')) {
      return { ok: true, async json() { return { id: 'sub1' }; } };
    }
    throw new Error('unexpected ' + url);
  };
  const storage = createMemoryStorage();
  const handler = createHandler({
    config: {
      clientId: 'cid', clientSecret: 'csec',
      redirectUri: 'https://example.com/cb', busDeviceId: 'd1', busArsId: '12345',
    },
    storage, fetch: fakeFetch, now: () => 1_700_000_000_000,
  });
  const res = await handler(makeEvent('GET', '/.netlify/functions/smartapp/oauth/callback?code=xyz&state=s'));
  assert.equal(res.statusCode, 200);
  const saved = await storage.load();
  assert.equal(saved.access_token, 'AT');
  assert.equal(saved.refresh_token, 'RT');
  assert.equal(saved.installed_app_id, 'IAP');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.smartthings.com/installedapps/IAP/subscriptions');
});

test('GET /oauth/callback returns 400 when code missing', async () => {
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd', busArsId: '1' },
    storage: createMemoryStorage(),
    fetch: async () => {}, now: () => 0,
  });
  const res = await handler(makeEvent('GET', '/.netlify/functions/smartapp/oauth/callback'));
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/smartapp.test.js`
Expected: FAIL — Cannot find module `../src/smartapp` (we deleted it in Task 1).

- [ ] **Step 3: createHandler skeleton + GET routes 구현**

Create `bus-tts-smartapp/src/smartapp.js`:
```js
const { buildAuthorizeUrl, exchangeCode } = require('./oauth');
const { registerSubscription } = require('./subscription');

function createHandler({ config, storage, fetch, now }) {
  return async function handler(event) {
    const method = event.httpMethod;
    const path = event.path || '';
    const last = path.split('/').filter(Boolean).pop() || '';

    if (method === 'GET' && path.endsWith('/authorize')) {
      const url = buildAuthorizeUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        scopes: ['r:devices:*', 'x:devices:*'],
        state: String(now()),
      });
      return { statusCode: 302, headers: { Location: url }, body: '' };
    }

    if (method === 'GET' && path.endsWith('/oauth/callback')) {
      const q = new URL('http://x' + (path.includes('?') ? path.slice(path.indexOf('?')) : '') + (event.rawQuery ? '?' + event.rawQuery : '')).searchParams;
      // Netlify provides queryStringParameters; prefer that
      const code = (event.queryStringParameters && event.queryStringParameters.code) || q.get('code');
      if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'missing code' };
      const tokens = await exchangeCode({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        fetch, now,
      });
      await storage.save(tokens);
      await registerSubscription({
        accessToken: tokens.access_token,
        installedAppId: tokens.installed_app_id,
        deviceId: config.busDeviceId,
        fetch,
      });
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<p>설정 완료. 가상 디바이스 button을 눌러보세요.</p>' };
    }

    return { statusCode: 404, body: 'not found' };
  };
}

module.exports = { createHandler };
```

Also update the test to parse code via `queryStringParameters`. Adjust test helper:
```js
function makeEvent(method, path, body) {
  const qsi = path.indexOf('?');
  const queryStringParameters = {};
  if (qsi >= 0) {
    const params = new URLSearchParams(path.slice(qsi + 1));
    for (const [k, v] of params) queryStringParameters[k] = v;
  }
  return {
    httpMethod: method,
    path: qsi >= 0 ? path.slice(0, qsi) : path,
    queryStringParameters,
    body: typeof body === 'string' ? body : (body ? JSON.stringify(body) : ''),
    isBase64Encoded: false,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/smartapp.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/smartapp.js bus-tts-smartapp/test/smartapp.test.js
git commit -m "feat(bus-tts-smartapp): add OAuth authorize/callback routes"
```

---

## Task 11: POST lifecycle — PING / CONFIRMATION

**Files:**
- Modify: `bus-tts-smartapp/src/smartapp.js`
- Modify: `bus-tts-smartapp/test/smartapp.test.js`

API_ONLY 앱도 webhook smartapp과 동일한 PING/CONFIRMATION lifecycle을 따른다 (target URL 등록 시 발생). 핸들러는 lifecycle 종류별 분기.

- [ ] **Step 1: 실패 테스트 추가**

Append to `bus-tts-smartapp/test/smartapp.test.js`:
```js
test('POST PING returns same challenge', async () => {
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd', busArsId: '1' },
    storage: createMemoryStorage(),
    fetch: async () => {}, now: () => 0,
  });
  const res = await handler(makeEvent('POST', '/.netlify/functions/smartapp', {
    lifecycle: 'PING',
    pingData: { challenge: 'C1' },
  }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { statusCode: 200, pingData: { challenge: 'C1' } });
});

test('POST CONFIRMATION fetches confirmationUrl and returns targetUrl', async () => {
  let fetched;
  const fakeFetch = async (url) => { fetched = url; return { ok: true, async text() { return ''; } }; };
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd', busArsId: '1' },
    storage: createMemoryStorage(),
    fetch: fakeFetch, now: () => 0,
  });
  const res = await handler(makeEvent('POST', '/.netlify/functions/smartapp', {
    lifecycle: 'CONFIRMATION',
    confirmationData: { confirmationUrl: 'https://api.smartthings.com/confirm?t=xx' },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(fetched, 'https://api.smartthings.com/confirm?t=xx');
  assert.deepEqual(JSON.parse(res.body), { targetUrl: 'https://api.smartthings.com/confirm?t=xx' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/smartapp.test.js`
Expected: FAIL — POST returns 404.

- [ ] **Step 3: POST 분기 추가**

Inside `createHandler` in `bus-tts-smartapp/src/smartapp.js`, before the 404 return add:
```js
    if (method === 'POST') {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf-8')
        : (event.body || '');
      const body = raw ? JSON.parse(raw) : {};

      if (body.lifecycle === 'PING') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statusCode: 200, pingData: body.pingData }),
        };
      }

      if (body.lifecycle === 'CONFIRMATION') {
        const url = body.confirmationData && body.confirmationData.confirmationUrl;
        if (url) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) console.error('confirmation fetch non-2xx', resp.status);
          } catch (e) {
            console.error('confirmation fetch failed', e && e.message);
          }
        }
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUrl: url }),
        };
      }

      // EVENT handler added in Task 12
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && node --test test/smartapp.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/smartapp.js bus-tts-smartapp/test/smartapp.test.js
git commit -m "feat(bus-tts-smartapp): handle PING and CONFIRMATION lifecycles"
```

---

## Task 12: POST lifecycle — EVENT (button.pushed → bus → TTS)

**Files:**
- Modify: `bus-tts-smartapp/src/smartapp.js`
- Modify: `bus-tts-smartapp/test/smartapp.test.js`

EVENT 페이로드 안의 deviceEvent.value === 'pushed'를 필터. token 로드 → 갱신 → 버스 API → 메시지 → busmessage 명령 (+ speaker 있으면 TTS).

- [ ] **Step 1: 실패 테스트 추가**

Append to `bus-tts-smartapp/test/smartapp.test.js`:
```js
test('POST EVENT with pushed value calls bus API and sends busmessage command', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init && init.method, body: init && init.body });
    if (url.startsWith('http://ws.bus.go.kr/')) {
      return { ok: true, async json() { return { msgBody: { itemList: [{ rtNm: '143', arrmsg1: '곧 도착', arrmsg2: '5분 후' }] } }; } };
    }
    if (url === 'https://api.smartthings.com/devices/d1/commands') {
      return { ok: true, async json() { return { results: [] }; } };
    }
    throw new Error('unexpected ' + url);
  };
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'AT', refresh_token: 'RT', expires_at: 9_999_999_999_999, installed_app_id: 'IAP' });
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd1', busArsId: '12345', openDataApiKey: 'BUSKEY' },
    storage, fetch: fakeFetch, now: () => 1_700_000_000_000,
  });
  const res = await handler(makeEvent('POST', '/.netlify/functions/smartapp', {
    lifecycle: 'EVENT',
    eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'pushed' } }] },
  }));
  assert.equal(res.statusCode, 200);
  const busCall = calls.find(c => c.url.startsWith('http://ws.bus.go.kr/'));
  assert(busCall, 'bus API should be called');
  assert.match(busCall.url, /arsId=12345/);
  const cmdCall = calls.find(c => c.url === 'https://api.smartthings.com/devices/d1/commands');
  assert(cmdCall, 'device command should be sent');
  const cmdBody = JSON.parse(cmdCall.body);
  assert.equal(cmdBody.commands[0].capability, 'waterabout01957.busmessage');
});

test('POST EVENT without pushed value is ignored', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true, async json() { return {}; } }; };
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'AT', refresh_token: 'RT', expires_at: 9_999_999_999_999, installed_app_id: 'IAP' });
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd1', busArsId: '1', openDataApiKey: 'K' },
    storage, fetch: fakeFetch, now: () => 0,
  });
  const res = await handler(makeEvent('POST', '/.netlify/functions/smartapp', {
    lifecycle: 'EVENT',
    eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'held' } }] },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(called, false);
});

test('POST EVENT also speaks via speaker device when configured', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init && init.body });
    if (url.startsWith('http://ws.bus.go.kr/')) {
      return { ok: true, async json() { return { msgBody: { itemList: [{ rtNm: '143', arrmsg1: '곧 도착' }] } }; } };
    }
    return { ok: true, async json() { return { results: [] }; } };
  };
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'AT', refresh_token: 'RT', expires_at: 9_999_999_999_999, installed_app_id: 'IAP' });
  const handler = createHandler({
    config: {
      clientId: 'c', clientSecret: 's', redirectUri: 'r',
      busDeviceId: 'd1', busArsId: '1', openDataApiKey: 'K',
      speakerDeviceId: 'spk1',
    },
    storage, fetch: fakeFetch, now: () => 0,
  });
  await handler(makeEvent('POST', '/.netlify/functions/smartapp', {
    lifecycle: 'EVENT',
    eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'pushed' } }] },
  }));
  const speakerCall = calls.find(c => c.url === 'https://api.smartthings.com/devices/spk1/commands');
  assert(speakerCall, 'speaker command should be sent');
  const body = JSON.parse(speakerCall.body);
  assert.equal(body.commands[0].capability, 'speechSynthesis');
  assert.equal(body.commands[0].command, 'speak');
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd bus-tts-smartapp && node --test test/smartapp.test.js`
Expected: FAIL — assertion `bus API should be called` fails because EVENT branch returns 200 without action.

- [ ] **Step 3: EVENT 핸들러 구현**

In `bus-tts-smartapp/src/smartapp.js`:
- Add at top of file:
```js
const { getValidAccessToken } = require('./oauth');
const { sendDeviceCommand } = require('./smartthings');
const { fetchSeoulBus, buildMessage, mapErrorToMessage } = require('./bus');
```

- Replace the `// EVENT handler added in Task 12` placeholder with:
```js
      if (body.lifecycle === 'EVENT') {
        const events = (body.eventData && body.eventData.events) || [];
        const pushed = events.some(e =>
          e.eventType === 'DEVICE_EVENT' && e.deviceEvent && e.deviceEvent.value === 'pushed'
        );
        if (!pushed) {
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        let message;
        try {
          const items = await fetchSeoulBus(config.openDataApiKey, config.busArsId);
          message = buildMessage(items);
        } catch (err) {
          message = mapErrorToMessage(err);
          console.error('bus fetch failed', { code: err && err.code, msg: err && err.message });
        }

        const accessToken = await getValidAccessToken({
          storage,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          fetch, now,
        });

        const tasks = [
          sendDeviceCommand({
            accessToken,
            deviceId: config.busDeviceId,
            commands: [{ capability: 'waterabout01957.busmessage', command: 'setBusMessage', arguments: [message] }],
            fetch,
          }),
        ];
        if (config.speakerDeviceId) {
          tasks.push(sendDeviceCommand({
            accessToken,
            deviceId: config.speakerDeviceId,
            commands: [{ capability: 'speechSynthesis', command: 'speak', arguments: [message] }],
            fetch,
          }));
        }
        const results = await Promise.allSettled(tasks);
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error('command channel failed', { idx: i, reason: r.reason && r.reason.message });
          }
        });

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
      }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd bus-tts-smartapp && npm test`
Expected: 모든 파일 PASS, 총 18개 이상.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/src/smartapp.js bus-tts-smartapp/test/smartapp.test.js
git commit -m "feat(bus-tts-smartapp): handle EVENT lifecycle button push → bus → TTS"
```

---

## Task 13: netlify/functions/smartapp.js — wire createHandler with real deps

**Files:**
- Modify: `bus-tts-smartapp/netlify/functions/smartapp.js`

Lambda wrapper에서 `createHandler`에 production 의존성을 주입.

- [ ] **Step 1: Wrapper 재작성**

Replace `bus-tts-smartapp/netlify/functions/smartapp.js` with:
```js
const { getStore } = require('@netlify/blobs');
const { createHandler } = require('../../src/smartapp');
const { createBlobStorage } = require('../../src/storage');

const config = {
  clientId: process.env.ST_CLIENT_ID,
  clientSecret: process.env.ST_CLIENT_SECRET,
  redirectUri: process.env.ST_REDIRECT_URI,
  busDeviceId: process.env.BUS_DEVICE_ID,
  busArsId: process.env.BUS_ARS_ID,
  speakerDeviceId: process.env.SPEAKER_DEVICE_ID || undefined,
  openDataApiKey: process.env.OPEN_DATA_API_KEY,
};

const storage = createBlobStorage({ getStore });
const handler = createHandler({ config, storage, fetch, now: () => Date.now() });

exports.handler = handler;
```

- [ ] **Step 2: package.json `main` 확인 (선택)**

Optional sanity — package.json `main` 필요 없으나, `node -e "require('./netlify/functions/smartapp')"`로 require 깨지지 않는지 확인:
```bash
cd bus-tts-smartapp && node -e "require('./netlify/functions/smartapp')"
```
Expected: 출력 없음 (정상 require).

- [ ] **Step 3: 전체 테스트 회귀 확인**

Run: `cd bus-tts-smartapp && npm test`
Expected: 모든 테스트 PASS.

- [ ] **Step 4: Commit**

```bash
git add bus-tts-smartapp/netlify/functions/smartapp.js
git commit -m "feat(bus-tts-smartapp): wire Netlify function with Blobs storage"
```

---

## Task 14: SmartThings API_ONLY 앱 등록 + Netlify env 세팅

**Files:**
- (no code changes — interactive setup)

이 task는 외부 시스템 설정. 정확한 command/응답을 명시.

- [ ] **Step 1: 가상 디바이스 id 확인**

Run:
```bash
smartthings virtualdevices | grep -A1 "버스 TTS"
```
Expected: 한 줄에 device id (이전 작업의 결과 `<your-device-id>`).

- [ ] **Step 2: SmartThings API_ONLY 앱 인터랙티브 등록**

Run:
```bash
cd bus-tts-smartapp
smartthings apps:create
```
Answer interactive prompts:
- App Type → **API_ONLY (OAuth-In)**
- Display Name → `Seoul Bus TTS`
- Description → `서울 버스 도착 정보 → 가상 디바이스 busmessage + 갤럭시 홈 미니 TTS`
- App Name → `bus-tts-api`
- Target URL → `https://<your-worker-host>.netlify.app/.netlify/functions/smartapp`
- Redirect URI → `https://<your-worker-host>.netlify.app/.netlify/functions/smartapp/oauth/callback`
- Scopes → `r:devices:*`, `x:devices:*`

기록할 값: `appId`, `oauthClientId`, `oauthClientSecret`.

(만약 CONFIRMATION 핸드셰이크가 들어와 `targetStatus: PENDING`이면, Task 13 코드가 배포된 상태여야 통과. 따라서 Task 15 배포를 먼저 한 뒤 다시 등록해도 무방.)

- [ ] **Step 3: Netlify env 등록**

Replace placeholders with actual values from Step 2:
```bash
cd bus-tts-smartapp
netlify env:set ST_CLIENT_ID '<oauthClientId from step 2>' --context production
netlify env:set ST_CLIENT_SECRET '<oauthClientSecret from step 2>' --context production
netlify env:set ST_REDIRECT_URI 'https://<your-worker-host>.netlify.app/.netlify/functions/smartapp/oauth/callback' --context production
netlify env:set BUS_DEVICE_ID '<your-device-id>' --context production
netlify env:set BUS_ARS_ID '<서울버스 정류소 ARS-ID>' --context production
# SPEAKER_DEVICE_ID는 옵션 — 갤럭시 홈 미니 device id 확인 후 설정 가능
```

- [ ] **Step 4: env 확인**

Run:
```bash
netlify env:list --context production 2>&1 | grep -E 'ST_CLIENT_ID|ST_CLIENT_SECRET|ST_REDIRECT_URI|BUS_DEVICE_ID|BUS_ARS_ID|OPEN_DATA_API_KEY'
```
Expected: 6개 키 모두 존재.

- [ ] **Step 5: 작업 노트 (no commit)**

이 task는 코드 변경 없음. 작업 노트만 남길 거면 README 업데이트:

Edit `bus-tts-smartapp/README.md` minor section — but skip if README already accurate. (Task 18에서 일괄 정리.)

---

## Task 15: 배포 + endpoint smoke test

**Files:**
- (no code changes — deployment)

- [ ] **Step 1: Netlify production deploy**

```bash
cd bus-tts-smartapp && netlify deploy --prod 2>&1 | tail -10
```
Expected: `Deploy is live!` + production URL 출력.

- [ ] **Step 2: PING smoke test**

```bash
curl -s https://<your-worker-host>.netlify.app/.netlify/functions/smartapp \
  -X POST -H 'Content-Type: application/json' \
  -d '{"lifecycle":"PING","pingData":{"challenge":"plan-task15"}}'
```
Expected output:
```json
{"statusCode":200,"pingData":{"challenge":"plan-task15"}}
```

- [ ] **Step 3: GET / (landing page) 확인**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<your-worker-host>.netlify.app/
```
Expected: `200`.

- [ ] **Step 4: GET /authorize redirect 확인**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  https://<your-worker-host>.netlify.app/.netlify/functions/smartapp/authorize
```
Expected: `302 https://api.smartthings.com/oauth/authorize?...` (client_id 등 포함).

- [ ] **Step 5: app `targetStatus` 확인**

If Task 14 Step 2를 배포 전에 진행했다면:
```bash
smartthings apps:register <appId from task 14> 2>&1 | tail -10
smartthings apps <appId> 2>&1 | grep targetStatus
```
Expected: `targetStatus: CONFIRMED`.

If still PENDING → CONFIRMATION 응답이 잘못된 것. `netlify functions:log smartapp --tail`로 함수 로그 확인.

---

## Task 16: 실 OAuth flow + subscription 등록 E2E

**Files:**
- (no code changes — user interaction)

- [ ] **Step 1: Authorize 페이지에서 OAuth 시작**

브라우저로 https://<your-worker-host>.netlify.app/ 접속 → "SmartThings로 인증" 클릭.
Expected: SmartThings 로그인 페이지 → 권한 동의 화면 → `/.netlify/functions/smartapp/oauth/callback?code=...&state=...`로 redirect → "설정 완료" 메시지.

- [ ] **Step 2: token 저장 확인**

```bash
netlify functions:log smartapp --tail
```
별도 터미널에서 Step 1 재실행. log에 `confirmation fetch` 또는 errors 없어야 함.

Netlify Blobs에 저장됐는지 확인 (Netlify dashboard → Blobs 또는 함수 로그):
함수에 `console.log('saved tokens for', tokens.installed_app_id)` 같은 디버그 라인 임시 추가했다면 그걸로 확인. (운영용 코드에는 token을 로그에 찍지 말 것.)

- [ ] **Step 3: subscription 등록 확인**

```bash
smartthings installedapps 2>&1 | tail -20
```
Expected: `Seoul Bus TTS` (또는 displayName)가 installed app 리스트에 등장.

```bash
smartthings api get '/installedapps/<installedAppId>/subscriptions' 2>&1 | head -40
```
Expected: subscription 1개 — `device.capability: button`, `device.deviceId: <your-device-id>`.

(만약 CLI api 호출이 깨지면 SmartThings 모바일 앱 → 설정 → installed apps에서 확인.)

---

## Task 17: 실제 button push E2E 검증

**Files:**
- (no code changes — manual verification)

- [ ] **Step 1: 모바일 앱에서 가상 디바이스 push**

SmartThings 모바일 앱 → 거실 → "버스 TTS" 디바이스 → button push.

- [ ] **Step 2: 함수 로그 확인**

```bash
netlify functions:log smartapp --tail
```
Expected log entries:
- EVENT lifecycle 수신 (button.pushed)
- `(NO error log)` — bus fetch + device command 모두 성공
- (또는 bus API 일시 장애 시 `bus fetch failed` 후 에러 메시지 출력)

- [ ] **Step 3: busmessage attribute 확인**

```bash
smartthings devices:status <your-device-id> 2>&1 | grep -A2 busmessage
```
Expected: `busmessage` attribute 값이 빌드된 메시지 (예: "현재 정류장의 버스 도착 정보입니다. 143번 버스는 곧 도착입니다.").

- [ ] **Step 4: (옵션) 갤럭시 홈 미니 TTS 확인**

If `SPEAKER_DEVICE_ID` set, 실제 스피커에서 음성 출력 확인.

- [ ] **Step 5: 에러 케이스 확인 (선택)**

Bus API 에러 시뮬레이션: `BUS_ARS_ID`를 일시적으로 잘못된 값 (`netlify env:set BUS_ARS_ID 99999999 --context production && netlify deploy --prod`)으로 변경 → button push → busmessage에 "버스 정보 조회에 실패했습니다." 또는 "해당 정류장의 버스 정보가 없습니다." 출력 확인 → 원래 값으로 복원.

---

## Task 18: 정리 (README, 구 자산 삭제)

**Files:**
- Modify: `bus-tts-smartapp/README.md`
- Delete: `bus-tts-smartapp/.smartapp-create.yaml` (webhook smartapp용, 더 이상 안 쓰임)
- Delete: `bus-tts-smartapp/.smartapp-oauth.yaml` (동상)

- [ ] **Step 1: README 갱신**

Replace `bus-tts-smartapp/README.md` body with:
```markdown
# bus-tts-smartapp

SmartThings 가상 버튼 push → 서울시 버스 도착 정보 조회 → busmessage capability 갱신 + 갤럭시 홈 미니 TTS. **API_ONLY (OAuth-In)** 패턴. Netlify 단일 Function.

설계: [`docs/superpowers/specs/2026-05-20-bus-tts-api-only-design.md`](../docs/superpowers/specs/2026-05-20-bus-tts-api-only-design.md)
구현 plan: [`docs/superpowers/plans/2026-05-20-bus-tts-api-only.md`](../docs/superpowers/plans/2026-05-20-bus-tts-api-only.md)

## 디렉터리

- `netlify/functions/smartapp.js` — Netlify 함수 entry (env 주입 + createHandler)
- `src/smartapp.js` — HTTP router + lifecycle 핸들러
- `src/oauth.js` — OAuth URL builder, code exchange, refresh, getValidAccessToken
- `src/storage.js` — Netlify Blobs wrapper (+ memory mock)
- `src/subscription.js` — device subscription register
- `src/smartthings.js` — device command sender
- `src/bus.js` — 서울 버스 API + 메시지 빌드
- `public/index.html` — 최초 OAuth 시작 페이지
- `test/*.test.js` — node --test

## 로컬 테스트

```bash
npm install
npm test
```

## 1회 셋업

1. `smartthings apps:create` (API_ONLY) — `oauthClientId`, `oauthClientSecret` 발급
2. `netlify env:set ST_CLIENT_ID '<id>'` (+ ST_CLIENT_SECRET, ST_REDIRECT_URI, BUS_DEVICE_ID, BUS_ARS_ID, OPEN_DATA_API_KEY, 선택 SPEAKER_DEVICE_ID)
3. `netlify deploy --prod`
4. 브라우저로 `https://<your-worker-host>.netlify.app/` 접속 → "SmartThings로 인증" → 1회 권한 동의 → 자동 subscription 등록

## 사용

SmartThings 모바일 앱에서 가상 디바이스 "버스 TTS"의 button을 누르면 동작.

## 디버깅

- 함수 로그: `netlify functions:log smartapp --tail`
- subscription 확인: `smartthings api get '/installedapps/<id>/subscriptions'`
- 디바이스 상태: `smartthings devices:status <busDeviceId>`
```

- [ ] **Step 2: 구 yaml 삭제**

```bash
rm -f bus-tts-smartapp/.smartapp-create.yaml bus-tts-smartapp/.smartapp-oauth.yaml
```

- [ ] **Step 3: 구 Workspace 프로젝트 정리 (사용자가 수동으로)**

사용자에게 안내: developer.smartthings.com/workspace/projects → `bus-tts-smart-app` 프로젝트 삭제 (May 2026 이후 어차피 사라지지만 사전 정리).

- [ ] **Step 4: 전체 테스트 회귀**

```bash
cd bus-tts-smartapp && npm test
```
Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add bus-tts-smartapp/README.md bus-tts-smartapp/.smartapp-create.yaml bus-tts-smartapp/.smartapp-oauth.yaml
git commit -m "docs(bus-tts-smartapp): rewrite README for API_ONLY pattern, drop legacy yaml"
```

---

## Self-Review (작성자 자체 점검 결과)

1. **Spec coverage** — spec §2 아키텍처는 Task 10–13, §4 시크릿은 Task 13–14, §5 App 등록은 Task 14, §6 OAuth flow는 Task 3–6 + Task 10, §7 EVENT 처리는 Task 12, §8 token 관리는 Task 2/5/6, §9 ARS_ID는 Task 14 (env BUS_ARS_ID), §10 검증 가정은 Task 16–17에서 실 검증, §11 마이그레이션은 Task 1 + Task 18.
2. **Placeholder scan** — 코드 step은 모두 실제 코드 포함. "TBD/TODO/적절히" 없음.
3. **Type consistency** — `getValidAccessToken({ storage, clientId, clientSecret, fetch, now })`, `exchangeCode({ code, clientId, clientSecret, redirectUri, fetch, now })`, `refreshAccessToken({ refreshToken, clientId, clientSecret, fetch, now })`, `sendDeviceCommand({ accessToken, deviceId, commands, fetch })`, `registerSubscription({ accessToken, installedAppId, deviceId, fetch })`, `buildAuthorizeUrl({ clientId, redirectUri, scopes, state })` — 모두 객체 인자, 명칭 일관.
