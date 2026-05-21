# Bus TTS SmartApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edge Driver(`seoul-bus-stop-alarm`)을 폐기하고 Netlify Function 기반 cloud-to-cloud SmartApp(`bus-tts-smartapp`)으로 교체한다. 모바일 앱의 가상 버튼 push로 서울시 버스 도착 정보를 조회해 busmessage capability + 푸시 + 갤럭시 홈 미니 TTS로 출력한다.

**Architecture:** 단일 Netlify Function이 SmartThings의 모든 lifecycle(PING / CONFIRMATION / CONFIGURATION / INSTALL / UPDATE / EVENT / UNINSTALL)을 처리. `@smartthings/smartapp` SDK가 EVENT 페이로드의 ephemeral access_token(5분)을 자동 사용해 device command와 push notification을 호출하므로 refresh_token / ContextStore 불필요. SmartApp config로 ARS-ID·디바이스 ID를 받고, 시크릿(`OPEN_DATA_API_KEY`, `ST_CLIENT_ID/SECRET`)은 Netlify env로만 주입.

**Tech Stack:** Node.js ≥ 18 (global fetch 사용), `@smartthings/smartapp` SDK, Netlify Functions(AWS Lambda 호환 시그니처), `node:test` + `node:assert/strict`(빌트인 테스트 러너, 의존성 추가 없음), SmartThings CLI, custom capability `waterabout01957.busmessage`.

---

## File Structure

새 디렉터리는 기존 `oauth-broker/`를 rename해 만들고, OAuth용 자산(authorize/callback/refresh 함수, smartapp-definition.json, oauth-settings.json)은 모두 제거한다. 그 결과 `bus-tts-smartapp/`은 다음 구조가 된다:

```
bus-tts-smartapp/
├─ netlify.toml                    (재사용, 그대로)
├─ package.json                    (rename + deps + test script)
├─ profiles/
│  └─ bus-profile.yaml             (button + busmessage, preferences 제거)
├─ public/
│  └─ index.html                   (재사용 가능, 미수정)
├─ netlify/functions/
│  └─ smartapp.js                  (Lambda 시그니처 → SDK handleLambdaCallback wrap)
├─ src/
│  ├─ smartapp.js                  (SmartApp 정의: page + updated + subscribedEventHandler)
│  └─ bus.js                       (fetchSeoulBus / buildMessage / cleanBusMsg / arrivalSuffix / mapErrorToMessage)
└─ test/
   └─ bus.test.js                  (bus.js 전 함수 단위 테스트)
```

각 파일의 책임:

- `src/bus.js` — 외부 API 호출 + 메시지 빌드. 순수 함수 + 1개 fetch 함수. 테스트 가능한 로직은 모두 여기에 모은다.
- `src/smartapp.js` — `@smartthings/smartapp` 인스턴스 정의. UI(page DSL), subscription 재구성(updated), 이벤트 처리(subscribedEventHandler)만 담당. 외부 API 호출은 `bus.js`에 위임.
- `netlify/functions/smartapp.js` — Netlify의 `async (event, context) => response` 시그니처를 SDK의 `handleLambdaCallback(event, context, callback)`로 어댑팅하는 얇은 wrapper. 비즈니스 로직 없음.
- `profiles/bus-profile.yaml` — 가상 디바이스 프로파일. SmartApp이 구독 가능한 `button` capability + 메시지 표시용 `waterabout01957.busmessage`만 선언. preferences는 제거(입력은 SmartApp config에서).
- `test/bus.test.js` — `node --test`로 실행. global.fetch만 stub해서 `fetchSeoulBus`까지 검증.

별도로 레포지토리 최상위에서:
- `seoul-bus-stop-alarm/` 디렉터리 통째로 삭제
- 최상위 `README.md`는 현 시점에서 driver 1개만 언급하므로 SmartApp 관련 문구로 업데이트

---

## Task 1: 프로젝트 스켈레톤 셋업 (rename + cleanup + deps)

**Files:**
- Rename: `oauth-broker/` → `bus-tts-smartapp/`
- Delete: `bus-tts-smartapp/netlify/functions/authorize.js`, `bus-tts-smartapp/netlify/functions/callback.js`, `bus-tts-smartapp/netlify/functions/refresh.js`, `bus-tts-smartapp/oauth-settings.json`, `bus-tts-smartapp/smartapp-definition.json`
- Modify: `bus-tts-smartapp/package.json`

- [ ] **Step 1: 디렉터리 rename**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
mv oauth-broker bus-tts-smartapp
```

`mv`(plain)를 사용해 untracked 파일(`.netlify/`)도 함께 이동시킨다. git rename detection이 다음 commit에서 자동으로 인식한다.

- [ ] **Step 2: 폐기되는 OAuth 자산 제거**

```bash
rm bus-tts-smartapp/netlify/functions/authorize.js
rm bus-tts-smartapp/netlify/functions/callback.js
rm bus-tts-smartapp/netlify/functions/refresh.js
rm bus-tts-smartapp/oauth-settings.json
rm bus-tts-smartapp/smartapp-definition.json
```

- [ ] **Step 3: `package.json` 갱신**

`bus-tts-smartapp/package.json`을 다음으로 교체:

```json
{
  "name": "bus-tts-smartapp",
  "version": "1.0.0",
  "private": true,
  "description": "Seoul Bus TTS SmartApp — cloud-to-cloud Netlify function that fetches bus arrivals and outputs to busmessage capability, push, and Galaxy Home Mini TTS.",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "@smartthings/smartapp": "^5.0.0"
  }
}
```

- [ ] **Step 4: 의존성 설치**

```bash
cd bus-tts-smartapp
npm install
```

설치 후 `package-lock.json`이 생성됨을 확인. `node_modules/@smartthings/smartapp/`가 존재하는지 한 번 확인.

- [ ] **Step 5: 빈 디렉터리 골격 생성**

```bash
mkdir -p bus-tts-smartapp/src bus-tts-smartapp/test
```

`profiles/`, `netlify/functions/`, `public/`는 rename 결과 이미 존재.

- [ ] **Step 6: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add -A
git commit -m "chore: rename oauth-broker to bus-tts-smartapp and remove OAuth assets"
```

`git status`로 rename detection이 동작했는지(`renamed: oauth-broker/... -> bus-tts-smartapp/...`로 표시되는지) 확인.

---

## Task 2: `src/bus.js` 순수 함수 — TDD

**Files:**
- Create: `bus-tts-smartapp/test/bus.test.js`
- Create: `bus-tts-smartapp/src/bus.js`

- [ ] **Step 1: 실패 테스트 작성 (`cleanBusMsg` / `arrivalSuffix` / `buildMessage` / `mapErrorToMessage`)**

`bus-tts-smartapp/test/bus.test.js` 생성:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanBusMsg, arrivalSuffix, buildMessage, mapErrorToMessage } = require('../src/bus');

test('cleanBusMsg returns null for empty / falsy', () => {
  assert.equal(cleanBusMsg(''), null);
  assert.equal(cleanBusMsg(null), null);
  assert.equal(cleanBusMsg(undefined), null);
});

test('cleanBusMsg returns null when message contains 운행종료', () => {
  assert.equal(cleanBusMsg('운행종료'), null);
  assert.equal(cleanBusMsg('[N5번째 전]운행종료'), null);
});

test('cleanBusMsg strips bracketed annotations and trims', () => {
  assert.equal(cleanBusMsg('[3번째 전]5분 30초후'), '5분 30초후');
  assert.equal(cleanBusMsg('  곧 도착  '), '곧 도착');
});

test('arrivalSuffix uses 입니다 for 곧 도착 / 출발대기', () => {
  assert.equal(arrivalSuffix('곧 도착'), '입니다');
  assert.equal(arrivalSuffix('출발대기'), '입니다');
});

test('arrivalSuffix uses 도착 예정입니다 by default', () => {
  assert.equal(arrivalSuffix('5분 30초후'), ' 도착 예정입니다');
});

test('buildMessage returns the empty-fallback message when no items have arrmsg1', () => {
  assert.equal(
    buildMessage([]),
    '현재 운행 중이거나 도착 예정인 버스가 없습니다.'
  );
  assert.equal(
    buildMessage([{ rtNm: '472', arrmsg1: '운행종료', arrmsg2: '운행종료' }]),
    '현재 운행 중이거나 도착 예정인 버스가 없습니다.'
  );
});

test('buildMessage formats single-arrival item', () => {
  const items = [{ rtNm: '472', arrmsg1: '5분 30초후', arrmsg2: '운행종료' }];
  assert.equal(
    buildMessage(items),
    '현재 정류장의 버스 도착 정보입니다. 472번 버스는 5분 30초후 도착 예정입니다'
  );
});

test('buildMessage formats two-arrival item with 곧 도착', () => {
  const items = [{ rtNm: '472', arrmsg1: '5분 30초후', arrmsg2: '곧 도착' }];
  assert.equal(
    buildMessage(items),
    '현재 정류장의 버스 도착 정보입니다. 472번 버스는 먼저 5분 30초후, 다음 버스는 곧 도착입니다'
  );
});

test('buildMessage joins multiple lines with ". "', () => {
  const items = [
    { rtNm: '472', arrmsg1: '곧 도착', arrmsg2: '5분 후' },
    { rtNm: '143', arrmsg1: '3분 후', arrmsg2: '운행종료' },
  ];
  assert.equal(
    buildMessage(items),
    '현재 정류장의 버스 도착 정보입니다. 472번 버스는 먼저 곧 도착, 다음 버스는 5분 후 도착 예정입니다. 143번 버스는 3분 후 도착 예정입니다'
  );
});

test('mapErrorToMessage maps known error codes', () => {
  assert.equal(mapErrorToMessage({ code: 'JSON_PARSE' }), '버스 정보 응답을 처리할 수 없습니다.');
  assert.equal(mapErrorToMessage({ code: 'NO_ITEM_LIST' }), '해당 정류장의 버스 정보가 없습니다.');
});

test('mapErrorToMessage falls back to generic message for unknown codes', () => {
  assert.equal(mapErrorToMessage({ code: 'NETWORK' }), '버스 정보 조회에 실패했습니다.');
  assert.equal(mapErrorToMessage({ code: 'HTTP_STATUS' }), '버스 정보 조회에 실패했습니다.');
  assert.equal(mapErrorToMessage({}), '버스 정보 조회에 실패했습니다.');
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd bus-tts-smartapp
npm test
```

Expected: FAIL with "Cannot find module '../src/bus'".

- [ ] **Step 3: 최소 구현 작성**

`bus-tts-smartapp/src/bus.js` 생성 (이번 단계에서는 순수 함수만):

```js
function cleanBusMsg(raw) {
  if (!raw || raw === '' || raw.includes('운행종료')) return null;
  return raw.replace(/\[.*?\]/g, '').trim();
}

function arrivalSuffix(msg) {
  return /곧 도착|출발대기/.test(msg) ? '입니다' : ' 도착 예정입니다';
}

function buildMessage(items) {
  const parts = [];
  for (const item of items) {
    const m1 = cleanBusMsg(item.arrmsg1);
    const m2 = cleanBusMsg(item.arrmsg2);
    if (!m1) continue;
    parts.push(m2
      ? `${item.rtNm}번 버스는 먼저 ${m1}, 다음 버스는 ${m2}${arrivalSuffix(m2)}`
      : `${item.rtNm}번 버스는 ${m1}${arrivalSuffix(m1)}`);
  }
  return parts.length
    ? `현재 정류장의 버스 도착 정보입니다. ${parts.join('. ')}`
    : '현재 운행 중이거나 도착 예정인 버스가 없습니다.';
}

function mapErrorToMessage(err) {
  switch (err && err.code) {
    case 'JSON_PARSE':   return '버스 정보 응답을 처리할 수 없습니다.';
    case 'NO_ITEM_LIST': return '해당 정류장의 버스 정보가 없습니다.';
    default:             return '버스 정보 조회에 실패했습니다.';
  }
}

module.exports = { cleanBusMsg, arrivalSuffix, buildMessage, mapErrorToMessage };
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd bus-tts-smartapp
npm test
```

Expected: 모든 테스트 PASS (11 tests).

- [ ] **Step 5: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add bus-tts-smartapp/src/bus.js bus-tts-smartapp/test/bus.test.js
git commit -m "feat(bus-tts-smartapp): port pure message-build helpers from edge driver"
```

---

## Task 3: `src/bus.js` — `fetchSeoulBus` (TDD with mocked fetch)

**Files:**
- Modify: `bus-tts-smartapp/test/bus.test.js`
- Modify: `bus-tts-smartapp/src/bus.js`

- [ ] **Step 1: 실패 테스트 추가**

`bus-tts-smartapp/test/bus.test.js` 끝에 추가:

```js
const { fetchSeoulBus } = require('../src/bus');

function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

test('fetchSeoulBus returns itemList on success', async () => {
  const sample = { msgBody: { itemList: [{ rtNm: '472', arrmsg1: '곧 도착', arrmsg2: '5분 후' }] } };
  await withMockedFetch(
    async (url) => {
      assert.match(url, /ws\.bus\.go\.kr/);
      assert.match(url, /ServiceKey=KEY%20WITH%20SPACE/);
      assert.match(url, /arsId=12345/);
      assert.match(url, /resultType=json/);
      return { ok: true, status: 200, json: async () => sample };
    },
    async () => {
      const items = await fetchSeoulBus('KEY WITH SPACE', '12345');
      assert.deepEqual(items, sample.msgBody.itemList);
    }
  );
});

test('fetchSeoulBus throws NETWORK when fetch rejects', async () => {
  await withMockedFetch(
    async () => { throw new Error('boom'); },
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'NETWORK'
      );
    }
  );
});

test('fetchSeoulBus throws HTTP_STATUS for non-2xx responses', async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'HTTP_STATUS'
      );
    }
  );
});

test('fetchSeoulBus throws JSON_PARSE when body is not valid JSON', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'JSON_PARSE'
      );
    }
  );
});

test('fetchSeoulBus throws NO_ITEM_LIST when response shape is unexpected', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ msgBody: {} }) }),
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'NO_ITEM_LIST'
      );
    }
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd bus-tts-smartapp
npm test
```

Expected: 새 5개 테스트 FAIL with "fetchSeoulBus is not a function" (또는 동등한 에러).

- [ ] **Step 3: `fetchSeoulBus` 구현 추가**

`bus-tts-smartapp/src/bus.js`를 수정해 함수 추가 + export 갱신:

```js
async function fetchSeoulBus(apiKey, arsId) {
  const url = 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid'
    + `?ServiceKey=${encodeURIComponent(apiKey)}`
    + `&arsId=${encodeURIComponent(arsId)}`
    + '&resultType=json';
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    const err = new Error('fetch failed'); err.code = 'NETWORK'; throw err;
  }
  if (!resp.ok) {
    const err = new Error(`status ${resp.status}`); err.code = 'HTTP_STATUS'; throw err;
  }
  let data;
  try { data = await resp.json(); }
  catch (e) {
    const err = new Error('json parse'); err.code = 'JSON_PARSE'; throw err;
  }
  if (!data || !data.msgBody || !data.msgBody.itemList) {
    const err = new Error('no itemList'); err.code = 'NO_ITEM_LIST'; throw err;
  }
  return data.msgBody.itemList;
}

module.exports = { cleanBusMsg, arrivalSuffix, buildMessage, mapErrorToMessage, fetchSeoulBus };
```

(파일 하단의 기존 `module.exports`를 위 한 줄로 대체.)

- [ ] **Step 4: 테스트 전체 통과 확인**

```bash
cd bus-tts-smartapp
npm test
```

Expected: 모든 테스트 PASS (16 tests: 기존 11 + 신규 5).

- [ ] **Step 5: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add bus-tts-smartapp/src/bus.js bus-tts-smartapp/test/bus.test.js
git commit -m "feat(bus-tts-smartapp): add fetchSeoulBus with typed error codes"
```

---

## Task 4: 가상 디바이스 프로파일 갱신

**Files:**
- Modify: `bus-tts-smartapp/profiles/bus-profile.yaml`

- [ ] **Step 1: 프로파일 전체 교체**

`bus-tts-smartapp/profiles/bus-profile.yaml`을 다음으로 교체 (기존 momentary + preferences는 모두 제거):

```yaml
name: bus-tts
components:
  - id: main
    capabilities:
      - id: button
        version: 1
      - id: waterabout01957.busmessage
        version: 1
    categories:
      - name: Switch
```

이유: spec §5 — `momentary` capability는 attributes가 비어 있어 SmartApp이 구독할 수 없다. `button` capability는 `pushed` 등을 emit하므로 `subscribeToDevices(device, 'button', 'button', handler)`로 구독 가능하며 모바일 앱에서도 Push 버튼 형태로 노출된다. preferences는 SmartApp config로 이전했으므로 제거.

- [ ] **Step 2: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add bus-tts-smartapp/profiles/bus-profile.yaml
git commit -m "feat(bus-tts-smartapp): replace momentary with button-capable virtual profile"
```

---

## Task 5: SmartApp 정의 (`src/smartapp.js`)

**Files:**
- Create: `bus-tts-smartapp/src/smartapp.js`
- Create: `bus-tts-smartapp/test/smartapp.test.js`

- [ ] **Step 1: 모듈 로드 smoke test 작성 (실패)**

`bus-tts-smartapp/test/smartapp.test.js` 생성:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('smartapp module loads and exports a SmartApp-like instance', () => {
  const smartapp = require('../src/smartapp');
  assert.ok(smartapp, 'expected module export to be truthy');
  // SmartApp instances expose a `handleLambdaCallback` method (used by Netlify wrapper).
  assert.equal(typeof smartapp.handleLambdaCallback, 'function');
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd bus-tts-smartapp
npm test
```

Expected: FAIL with "Cannot find module '../src/smartapp'".

- [ ] **Step 3: SmartApp 본체 작성**

`bus-tts-smartapp/src/smartapp.js` 생성:

```js
const SmartApp = require('@smartthings/smartapp');
const { fetchSeoulBus, buildMessage, mapErrorToMessage } = require('./bus');

const smartapp = new SmartApp()
  .enableEventLogging()
  .page('mainPage', (ctx, page) => {
    page.section('busStop', s => {
      s.textSetting('arsId').required(true)
        .name('정류소 ARS-ID')
        .description('조회할 서울 버스 정류소의 고유 번호');
    });
    page.section('trigger', s => {
      s.deviceSetting('busDevice')
        .capabilities(['button', 'waterabout01957.busmessage'])
        .required(true)
        .name('가상 버스 디바이스');
    });
    page.section('output', s => {
      s.deviceSetting('speaker')
        .capabilities(['speechSynthesis'])
        .required(false)
        .name('TTS 스피커 (예: 갤럭시 홈 미니)');
    });
  })
  .updated(async (ctx) => {
    await ctx.api.subscriptions.delete();
    await ctx.api.subscriptions.subscribeToDevices(
      ctx.config.busDevice, 'button', 'button', 'busTrigger'
    );
  })
  .subscribedEventHandler('busTrigger', async (ctx, event) => {
    if (event.value !== 'pushed') return;

    let message;
    try {
      const items = await fetchSeoulBus(
        process.env.OPEN_DATA_API_KEY,
        ctx.configStringValue('arsId')
      );
      message = buildMessage(items);
    } catch (err) {
      message = mapErrorToMessage(err);
      console.error('bus fetch failed', { code: err && err.code, msg: err && err.message });
    }

    const tasks = [
      ctx.api.devices.sendCommands(ctx.config.busDevice, [{
        capability: 'waterabout01957.busmessage',
        command: 'setBusMessage',
        arguments: [message],
      }]),
      ctx.api.notifications.send({ message, title: '서울 버스' }),
    ];
    if (ctx.config.speaker && ctx.config.speaker.length) {
      tasks.push(ctx.api.devices.sendCommands(ctx.config.speaker, [{
        capability: 'speechSynthesis',
        command: 'speak',
        arguments: [message],
      }]));
    }

    const results = await Promise.allSettled(tasks);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error('output channel failed', { idx: i, reason: r.reason && r.reason.message });
      }
    });
  });

module.exports = smartapp;
```

설계 노트:
- `ctx.api`는 EVENT 페이로드의 ephemeral access_token(5분)을 SDK가 자동 사용 — refresh_token / ContextStore 불필요 (spec §11 검증 항목).
- 정상 / 에러 모두 동일한 3채널(busmessage / push / TTS)로 출력 (spec §9).
- 출력 채널은 `Promise.allSettled`로 best-effort: 한 채널 실패해도 나머지는 시도.
- `ctx.config.speaker`는 deviceSetting이므로 device ID 배열로 전달됨 — `length` 검사로 미설정 처리.

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd bus-tts-smartapp
npm test
```

Expected: 모든 테스트 PASS (17 tests: 기존 16 + smoke test 1).

- [ ] **Step 5: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add bus-tts-smartapp/src/smartapp.js bus-tts-smartapp/test/smartapp.test.js
git commit -m "feat(bus-tts-smartapp): add SmartApp definition with page DSL and busTrigger handler"
```

---

## Task 6: Netlify Function 어댑터 (`netlify/functions/smartapp.js`)

**Files:**
- Create: `bus-tts-smartapp/netlify/functions/smartapp.js`

- [ ] **Step 1: 어댑터 작성**

`bus-tts-smartapp/netlify/functions/smartapp.js` 생성:

```js
const smartapp = require('../../src/smartapp');

exports.handler = async (event, context) => {
  return await new Promise((resolve, reject) => {
    smartapp.handleLambdaCallback(event, context, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
};
```

설계 노트:
- Netlify Functions의 시그니처는 `async (event, context) => response`로 AWS Lambda 호환.
- SDK의 `handleLambdaCallback(event, context, callback)`은 콜백 스타일이므로 `Promise`로 감싼다.
- 비즈니스 로직은 한 줄도 없음 — 모든 처리는 `smartapp` 인스턴스가 담당.

- [ ] **Step 2: 모듈 로드 확인 (require가 throw 안 하면 OK)**

```bash
cd bus-tts-smartapp
node -e "const h = require('./netlify/functions/smartapp').handler; if (typeof h !== 'function') process.exit(1); console.log('ok');"
```

Expected: `ok` 출력.

추가로 회귀 방지로 기존 테스트도 다시 실행:

```bash
npm test
```

Expected: 모든 테스트 PASS (17 tests).

- [ ] **Step 3: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add bus-tts-smartapp/netlify/functions/smartapp.js
git commit -m "feat(bus-tts-smartapp): add Netlify function adapter for SmartApp lifecycle"
```

---

## Task 7: 폐기된 Edge Driver 디렉터리 제거

**Files:**
- Delete: `seoul-bus-stop-alarm/` (전체)
- Modify: `README.md` (top-level — 현 시점 SmartApp만 언급하도록)

- [ ] **Step 1: Edge driver 디렉터리 삭제**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git rm -r seoul-bus-stop-alarm/
```

이유: spec §1, §12 — Edge driver 런타임은 LAN-only로 외부 인터넷 접근이 차단되므로 폐기 결정. cloud-to-cloud SmartApp이 그 역할을 대체.

- [ ] **Step 2: 최상위 README 갱신**

먼저 현재 내용 읽기:

```bash
cat README.md
```

이후 SmartApp 중심으로 다시 작성. 최소한 다음을 반영:
- 레포지토리 설명을 "Edge Driver 모음"에서 "SmartThings 통합(Edge Driver / SmartApp)"로 확장
- `bus-tts-smartapp/` 1줄 설명 추가
- `seoul-bus-stop-alarm/` 언급 제거

```markdown
# smart-things-edge-drivers

SmartThings용 통합 모음 — Edge Driver(LAN-only)와 cloud-to-cloud SmartApp을 한 레포에서 관리한다.

## 포함 프로젝트

- `bus-tts-smartapp/` — 서울시 버스 도착 정보를 조회해 SmartThings 푸시 / 가상 디바이스 메시지 / 갤럭시 홈 미니 TTS로 안내하는 Netlify Function 기반 SmartApp.

## 빌드 / 배포

- SmartApp: `bus-tts-smartapp/` 안에서 `netlify deploy --prod` + `smartthings apps:create` (자세한 절차는 `docs/superpowers/specs/2026-05-08-bus-tts-smartapp-design.md` §10 참조).
- Edge Driver: `smartthings edge:drivers:package <driver-dir>` (현재는 포함된 driver 없음).
```

- [ ] **Step 3: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add README.md
git commit -m "chore: drop seoul-bus-stop-alarm edge driver and refocus README on SmartApp"
```

---

## Task 8: 배포 / CLI 런북

**Files:**
- Create: `bus-tts-smartapp/README.md`

코드는 더 이상 변경 없음. spec §10의 CLI 절차를 레포에 영구 보관해 향후 재배포 / 디버깅 시 참조 가능하게 한다. 시크릿 값은 절대 커밋하지 않는다.

- [ ] **Step 1: 런북 README 작성**

`bus-tts-smartapp/README.md` 생성:

```markdown
# bus-tts-smartapp

SmartThings 모바일 앱의 가상 버튼 push로 서울시 버스 도착 정보를 조회해
(1) busmessage capability 갱신, (2) 갤럭시 홈 미니 TTS, (3) SmartThings 푸시
3채널로 출력하는 cloud-to-cloud SmartApp. 단일 Netlify Function이 모든 lifecycle을 처리.

설계 문서: [`docs/superpowers/specs/2026-05-08-bus-tts-smartapp-design.md`](../docs/superpowers/specs/2026-05-08-bus-tts-smartapp-design.md)

## 디렉터리

- `src/smartapp.js` — SmartApp 정의 (page DSL + updated + subscribedEventHandler).
- `src/bus.js` — 서울시 버스 API 호출 + 메시지 빌드.
- `netlify/functions/smartapp.js` — Netlify Function ↔ SDK `handleLambdaCallback` wrapper.
- `profiles/bus-profile.yaml` — 가상 디바이스 프로파일 (button + waterabout01957.busmessage).
- `test/` — `node --test` 기반 단위 테스트.

## 로컬 검증

```bash
npm install
npm test
```

## 1회 셋업 (운영자)

1. `smartthings deviceprofiles:create -i profiles/bus-profile.yaml`
2. `smartthings virtualdevices:create` (위 profile 사용)
3. `netlify deploy --prod` (Netlify 사이트가 없다면 먼저 `netlify init`)
4. `netlify env:set OPEN_DATA_API_KEY '<공공데이터포털 서비스 키>'`
5. `smartthings apps:create`
   - 타입: `WEBHOOK_SMART_APP`
   - target URL: 위 Netlify 배포의 함수 endpoint (예: `https://<site>.netlify.app/.netlify/functions/smartapp`)
   - scopes: 최소 `r:devices:*`, `x:devices:*` + 푸시 notification 관련(CLI 프롬프트의 옵션 중 선택; 등록 후 실호출로 검증)
   - 출력된 `client_id` / `client_secret` 보관
6. `netlify env:set ST_CLIENT_ID '<id>'` && `netlify env:set ST_CLIENT_SECRET '<secret>'`
7. `netlify deploy --prod` (env 반영을 위해 재배포)
8. (구 OAuth client 정리) `smartthings apps:delete <기존 oauth-broker app id>`

## 사용자 설치 (모바일 앱)

1. SmartThings 모바일 앱 → **+ Add → Routines → Discover** → "Seoul Bus TTS"
2. config 페이지에서 정류소 ARS-ID, 가상 버스 디바이스, (옵션) 갤럭시 홈 미니 선택
3. Done → INSTALL → subscription 자동 등록
4. 가상 버스 디바이스의 "Push" 탭 → 푸시 + busmessage + TTS 출력

## 시크릿 / 설정값

| 종류 | 키 | 위치 | 주체 |
|---|---|---|---|
| 시크릿 | `ST_CLIENT_ID`, `ST_CLIENT_SECRET` | Netlify env | 운영자 |
| 시크릿 | `OPEN_DATA_API_KEY` | Netlify env | 운영자 |
| 사용자 설정 | `arsId`, `busDevice`, `speaker` | SmartApp config (모바일 앱) | 사용자 |

코드에 어떤 시크릿도 하드코드하지 않는다. 사용자 설정값은 시크릿이 아니다.

## 디버깅

- Netlify function 로그: `netlify functions:log smartapp --tail`
- SmartApp 등록 정보: `smartthings apps:<id>`
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/hackle/repos/smart-things-edge-drivers
git add bus-tts-smartapp/README.md
git commit -m "docs(bus-tts-smartapp): add deployment runbook"
```

---

## 후속 (코드 외 — 운영자가 수동 수행)

코드 작업은 Task 8까지로 완결된다. 실제 배포 / SmartApp 등록은 위 런북의 "1회 셋업" 절차를 따라 운영자가 수행한다. 본 plan의 자동화 범위는 여기까지.
