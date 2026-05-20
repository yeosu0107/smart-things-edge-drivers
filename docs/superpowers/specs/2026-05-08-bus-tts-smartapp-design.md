# Seoul Bus TTS SmartApp — Design

- **작성일**: 2026-05-08
- **상태**: 설계 승인 완료, 구현 대기
- **대체 대상**: `seoul-bus-stop-alarm/` Edge Driver (LAN-only 제약으로 외부 API 호출 불가 → 폐기)
- **재사용 자산**: `oauth-broker/` (디렉터리/Netlify 사이트만 재활용, OAuth 함수는 모두 제거)

## 1. 배경과 목표

기존 `seoul-bus-stop-alarm` Edge Driver는 SmartThings Hub에서 직접 외부 API(`ws.bus.go.kr`, `api.smartthings.com`)를 호출하도록 구현되어 있었으나, Edge Driver 런타임은 platform 측에서 LAN-only 정책으로 외부 인터넷 접근을 차단한다. 따라서 cloud-to-cloud 모델로 전환한다.

**목표**: 본인 1인 전용 SmartApp. SmartThings 모바일 앱에서 가상 버튼을 누르면 서울시 정류소 도착 정보를 조회하여 (1) 가상 디바이스의 커스텀 capability를 갱신하고 (2) 갤럭시 홈 미니로 TTS 안내하고 (3) SmartThings 푸시를 보낸다.

**비목표**:
- 다른 사용자에게 배포 (WEBHOOK_SMART_APP의 self-publish 제약 + 본인용으로 충분)
- 자동 cron 조회 (사용자가 트리거할 때만 동작)
- Google Home Routine 연동

## 2. 아키텍처

```
   [SmartThings Mobile App]
            │ button push
            ▼
   [SmartThings Cloud]
            │ POST /smartapp (lifecycle: EVENT)
            ▼
   ┌───────────────────────────────────────┐
   │ Netlify Function: smartapp.js         │
   │ (@smartthings/smartapp SDK)           │
   │  ─────────────────────────────────    │
   │  1. fetch ws.bus.go.kr (HTTPS GET)    │
   │  2. buildMessage(items)               │
   │  3. ctx.api.devices.sendCommands × 2  │
   │     (busmessage + speechSynthesis)    │
   │  4. ctx.api.notifications.send        │
   └───────────────────────────────────────┘
```

핵심:

- 단일 Netlify Function이 모든 lifecycle (PING/CONFIGURATION/INSTALL/UPDATE/EVENT/UNINSTALL) 처리
- `subscribedEventHandler` 안에서 `ctx.api`는 EVENT 페이로드의 ephemeral access_token(5분)을 SDK가 자동 사용 — refresh_token / ContextStore 불필요
- 외부 API 직접 호출은 SmartApp 안에서만 (hub 거치지 않음)
- 가상 디바이스 1개가 트리거(button)이자 메시지 표시(busmessage) 역할

## 3. 디렉터리 구조

```
smart-things-edge-drivers/
├─ bus-tts-smartapp/                ← oauth-broker/ 에서 rename
│  ├─ netlify.toml
│  ├─ package.json                   (deps: @smartthings/smartapp)
│  ├─ profiles/
│  │  └─ bus-profile.yaml            (button + waterabout01957.busmessage)
│  ├─ public/
│  │  └─ index.html                  (간단 안내, 옵션)
│  ├─ netlify/functions/
│  │  └─ smartapp.js                 ← lifecycle 진입점
│  └─ src/
│     ├─ smartapp.js                 ← SmartApp 정의 (page, handlers)
│     └─ bus.js                      ← 서울 버스 API 호출 + 메시지 빌드
└─ docs/superpowers/specs/
   └─ 2026-05-08-bus-tts-smartapp-design.md
```

**삭제할 자산**:
- `oauth-broker/netlify/functions/{authorize,callback,refresh}.js`
- `oauth-broker/oauth-settings.json`, `oauth-broker/smartapp-definition.json`
- `seoul-bus-stop-alarm/` 디렉터리 통째
- 기존 OAuth client SmartApp (`smartthings apps:delete`)

## 4. 시크릿 / 설정값

### Netlify env (시크릿, 운영자만)

| key | 용도 |
|---|---|
| `ST_CLIENT_ID` | SmartApp OAuth client (SmartThings 발급) |
| `ST_CLIENT_SECRET` | 동상 |
| `OPEN_DATA_API_KEY` | 공공데이터포털 서비스 키 |

### SmartApp config (사용자가 모바일 앱에서 변경 가능)

| field | 타입 | required | 설명 |
|---|---|---|---|
| `arsId` | text | ✓ | 정류소 ARS-ID |
| `busDevice` | device (`button`, `waterabout01957.busmessage`) | ✓ | 가상 버스 디바이스 |
| `speaker` | device (`speechSynthesis`) | — | TTS 출력 (예: 갤럭시 홈 미니) |

설치 후 사용자가 모바일 앱에서 SmartApp을 다시 열어 값 수정 → SmartThings가 `UPDATE` lifecycle 호출 → SDK의 `updated()` 핸들러에서 subscription 재구성. 그 외 값(arsId 등)은 매 EVENT마다 `ctx.config`로 최신값 사용.

**보안 원칙**: 코드에 어떤 키도 하드코드하지 않는다. 모든 시크릿은 Netlify env. SmartApp config로 노출되는 값은 시크릿이 아닌 사용자 설정값(arsId, device IDs)뿐이다.

## 5. 가상 디바이스 (`bus-profile.yaml`)

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

**capability 선택 이유**:
- `momentary` capability는 attributes가 비어 있어 SmartApp이 구독할 수 없다 (CLI 검증: `smartthings capabilities momentary`).
- `button` capability는 `button` attribute에 `pushed`/`held`/`double` 등 emit하므로 `subscribeToDevices(device, 'button', 'button', handler)`로 구독 가능.
- 모바일 앱 UI에서는 button capability도 "Push" 버튼으로 비슷하게 노출됨.

기존 edge driver 프로파일의 `preferences` 절은 모두 제거 (입력은 SmartApp config에서 받음).

생성 절차: `smartthings deviceprofiles:create` 후 `smartthings virtualdevices:create` 1회.

## 6. SmartApp 정의 (page + handlers)

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
      console.error('bus fetch failed', { code: err.code, msg: err.message });
    }

    const tasks = [
      ctx.api.devices.sendCommands(ctx.config.busDevice, [{
        capability: 'waterabout01957.busmessage',
        command: 'setBusMessage',
        arguments: [message],
      }]),
      ctx.api.notifications.send({ message, title: '서울 버스' }),
    ];
    if (ctx.config.speaker?.length) {
      tasks.push(ctx.api.devices.sendCommands(ctx.config.speaker, [{
        capability: 'speechSynthesis',
        command: 'speak',
        arguments: [message],
      }]));
    }

    const results = await Promise.allSettled(tasks);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error('output channel failed', { idx: i, reason: r.reason?.message });
      }
    });
  });

module.exports = smartapp;
```

`netlify/functions/smartapp.js`는 SDK가 제공하는 어댑터 중 `handleLambdaCallback(event, context, callback)`을 사용한다. Netlify Functions는 AWS Lambda 호환 시그니처(`async (event, context) => response`)를 채택하므로, SDK 콜백을 Promise로 wrapping하여 Netlify의 응답 형식(`{statusCode, body, headers}`)으로 변환한다. 정확한 wrapping 패턴은 implementation 단계에서 작성 (구조 예시는 Section 6 코드 참조).

## 7. 메시지 빌드 (`src/bus.js`)

기존 `seoul-bus-stop-alarm/src/init.lua`의 `clean_bus_msg` / `arrival_suffix` / `build_message` 로직을 그대로 JavaScript로 포팅한다. 동작 동일성 유지.

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
  if (!data?.msgBody?.itemList) {
    const err = new Error('no itemList'); err.code = 'NO_ITEM_LIST'; throw err;
  }
  return data.msgBody.itemList;
}

function mapErrorToMessage(err) {
  switch (err.code) {
    case 'JSON_PARSE':   return '버스 정보 응답을 처리할 수 없습니다.';
    case 'NO_ITEM_LIST': return '해당 정류장의 버스 정보가 없습니다.';
    default:             return '버스 정보 조회에 실패했습니다.';
  }
}

module.exports = { fetchSeoulBus, buildMessage, mapErrorToMessage };
```

## 8. 데이터 흐름 (Lifecycle 요약)

| Lifecycle | 트리거 | 동작 |
|---|---|---|
| `PING` / `CONFIRMATION` | SmartApp 등록 직후 1회 | SDK가 confirmationUrl 자동 GET |
| `CONFIGURATION` | 사용자가 Discover에서 설치 진입 | page DSL → 폼 JSON 응답 |
| `INSTALL` / `UPDATE` | 설정 저장 시점 | subscription 재구성 (delete → subscribeToDevices) |
| `EVENT` | 가상 디바이스의 button push (`event.value === 'pushed'`) | 버스 조회 → 메시지 빌드 → 3채널 출력 |
| `UNINSTALL` | 사용자가 SmartApp 제거 | SDK 자동 cleanup |

## 9. 에러 처리

**원칙**: 트리거 누른 후 사용자가 항상 어떤 피드백을 받는다.

| 케이스 | 사용자가 보는 메시지 |
|---|---|
| HTTP 실패 / 비정상 응답 코드 | "버스 정보 조회에 실패했습니다." |
| JSON 파싱 실패 | "버스 정보 응답을 처리할 수 없습니다." |
| `msgBody.itemList` 없음 | "해당 정류장의 버스 정보가 없습니다." |
| 모든 노선 빈/운행종료 | "현재 운행 중이거나 도착 예정인 버스가 없습니다." |
| 정상 | 빌드된 도착 정보 메시지 |

- 정상/에러 메시지 모두 동일한 3채널(busmessage / 푸시 / TTS)로 출력
- 출력 채널은 `Promise.allSettled`로 best-effort — 한 채널 실패해도 나머지 시도
- SmartThings API 401 토큰 만료 재시도는 SDK가 자동 처리 (Edge driver 시절의 수동 retry 코드 불필요)
- 운영 중 디버깅은 Netlify function logs (`netlify functions:log smartapp --tail`)

## 10. 배포 / CLI 절차

### 10.1 1회 셋업 (개발자)

1. `mv oauth-broker bus-tts-smartapp` + 기존 OAuth 함수/설정 파일 제거
2. `bus-tts-smartapp/profiles/bus-profile.yaml` 작성 (Section 5)
3. `npm install --save @smartthings/smartapp`
4. `src/smartapp.js`, `src/bus.js`, `netlify/functions/smartapp.js` 작성
5. `smartthings deviceprofiles:create -i profiles/bus-profile.yaml`
6. `smartthings virtualdevices:create` (위 profile 사용)
7. `netlify deploy --prod`
8. `netlify env:set OPEN_DATA_API_KEY '<키>'`
9. `smartthings apps:create` (WEBHOOK_SMART_APP, target URL = Netlify endpoint, scopes: 최소 `r:devices:* x:devices:*` — push notification 관련 scope는 CLI 프롬프트가 제시하는 옵션 중 선택. 공식 scope 목록 미확정이므로 등록 직후 실제 푸시 호출로 검증) → `client_id`/`client_secret` 발급
10. `netlify env:set ST_CLIENT_ID '<id>' && netlify env:set ST_CLIENT_SECRET '<secret>'`
11. `netlify deploy --prod` (env 반영 재배포)
12. `smartthings apps:delete <기존 oauth-broker app id>` (구 OAuth client 정리)
13. `rm -rf seoul-bus-stop-alarm/`

### 10.2 사용자 설치 (모바일 앱)

1. SmartThings 모바일 앱 → **+ Add → Routines → Discover** → "Seoul Bus TTS" 탭
2. config 페이지에서 정류소 ARS-ID, 가상 버스 디바이스, 갤럭시 홈 미니 선택
3. Done → INSTALL → subscription 자동 등록
4. 가상 버스 디바이스 → "Push" 버튼 탭 → 푸시 + busmessage + 갤럭시 홈 미니 TTS 출력

## 11. 검증된 가정

| 가정 | 검증 결과 |
|---|---|
| `@smartthings/smartapp` SDK가 EVENT lifecycle 안에서 access_token을 자동 처리 | ✅ 공식 README: "the SmartApp SDK will facilitate API calls on behalf of a user within the EVENT lifecycle. These user tokens are ephemeral and last 5 minutes." |
| `momentary` capability는 SmartApp 구독 불가, `button`으로 교체 필요 | ✅ CLI `smartthings capabilities momentary` → `attributes: {}` 확인 |
| WEBHOOK_SMART_APP은 self-publish only (등록자 본인 계정에 자동 노출) | ✅ SmartThings Community 답변 확인 |
| 설치 후에도 사용자가 모바일 앱에서 설정 변경 → `UPDATE` lifecycle | ✅ SDK README: "Called for both INSTALLED and UPDATED lifecycle events" |
| Netlify CLI로 SmartThings PAT 없이 SmartApp 등록·env 관리 가능 | ✅ `smartthings apps:create`, `netlify env:set` 확인 |
| Netlify Function 시그니처가 SDK의 `handleLambdaCallback`과 호환 | ⚠️ AWS Lambda 호환 시그니처라 wrapping으로 사용 가능. 정확한 wrapping 패턴은 implementation 단계에서 작성 |
| `notifications.send`에 필요한 OAuth scope명 | ⚠️ 공식 문서에 명시 미확인. 등록 시 CLI 프롬프트의 옵션을 보고 선택, 실 호출로 검증 |

## 12. 영향 범위

**삭제**:
- `seoul-bus-stop-alarm/` (Edge driver, 폐기)
- `oauth-broker/netlify/functions/{authorize,callback,refresh}.js`
- `oauth-broker/{oauth-settings,smartapp-definition}.json`
- 기존 SmartApp OAuth client (CLI로 삭제)

**rename**:
- `oauth-broker/` → `bus-tts-smartapp/`
- Netlify 사이트명 (선택)

**유지**:
- 커스텀 capability `waterabout01957.busmessage` (Developer Workspace에 이미 등록됨)
- 갤럭시 홈 미니의 SmartThings 등록
