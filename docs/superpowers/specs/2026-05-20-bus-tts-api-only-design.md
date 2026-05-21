# Seoul Bus TTS — API_ONLY (OAuth-In) 재설계

- **작성일**: 2026-05-20
- **상태**: 설계 (구현 대기)
- **대체 대상**: 2026-05-08 spec의 WEBHOOK_SMART_APP 접근법
- **사유**: SmartThings Developer Workspace가 **May 2026 이후 deprecated**. WEBHOOK_SMART_APP (Automation Connector)은 Workspace의 "Deploy to Test"가 모바일 앱 노출의 필수 단계인데, Workspace 자체가 사라지므로 장기 사용 불가. Automation 카테고리의 마이그레이션 목적지는 공식 발표 누락 상태. → Workspace 의존이 없는 **API_ONLY (OAuth-In)** 패턴으로 전환.

## 1. 핵심 차이

| 항목 | 이전 (WEBHOOK_SMART_APP) | 신규 (API_ONLY OAuth-In) |
|---|---|---|
| 등록 경로 | CLI + Workspace "Deploy to Test" 필수 | CLI 등록만으로 완결 |
| 모바일 앱 설치 | Automations → Discover → 설치 | 모바일 앱 install 없음. OAuth flow 1회 |
| Trigger token | EVENT의 ephemeral access_token (5분, SDK 자동) | 사용자 refresh_token으로 access_token 갱신 (24h 유효) |
| Workspace 의존 | 있음 (Deploy to Test) | **없음** |
| May 2026 이후 | 불확실 | 정상 동작 예상 |

## 2. 아키텍처

```
[1회 setup]
   사용자 브라우저
        │ GET https://<your-worker-host>.netlify.app/
        ▼
   ┌─────────────────────────────────────────┐
   │ Netlify Function: smartapp              │
   │  - GET /        → "Authorize" 링크 페이지│
   │  - GET /oauth/callback → code → token   │
   │    → Netlify Blobs에 refresh_token 저장 │
   │  - GET /setup-subscription              │
   │    → 현재 token으로 subscription POST   │
   └─────────────────────────────────────────┘
        │
        ▼
   SmartThings Cloud: subscription 등록됨
   (busDevice의 button.button capability 구독)

[정상 동작]
   모바일 앱에서 "버스 TTS" 가상 디바이스 button push
        │ SmartThings Cloud event
        ▼
   ┌─────────────────────────────────────────┐
   │ POST /smartapp (lifecycle EVENT)        │
   │  - subscription event 수신              │
   │  - Netlify Blobs에서 refresh_token 로드 │
   │  - access_token 갱신 (필요 시)          │
   │  - fetch ws.bus.go.kr                   │
   │  - buildMessage(items)                  │
   │  - sendCommands × 2 (busmessage + TTS)  │
   └─────────────────────────────────────────┘
```

API_ONLY 앱도 webhook smartapp과 동일한 lifecycle (PING/CONFIRMATION/CONFIGURATION/INSTALL/UPDATE/EVENT)을 따른다. 차이는 모바일 앱 install 대신 사용자가 직접 OAuth flow를 거친다는 점.

## 3. 디렉터리 구조 (기존 재활용)

```
bus-tts-smartapp/
├─ netlify.toml
├─ package.json
├─ public/
│  └─ index.html              ← "Authorize" 페이지 (수정)
├─ netlify/functions/
│  └─ smartapp.js              ← OAuth callback + lifecycle + subscription register (재작성)
└─ src/
   ├─ bus.js                   ← 그대로 (버스 API + 메시지 빌드)
   ├─ oauth.js                 ← 신규: OAuth flow + token storage
   └─ subscription.js          ← 신규: subscription 등록 helper
```

기존 `src/smartapp.js`의 SDK 기반 page DSL은 폐기 (모바일 install 없음). 대신 직접 OAuth + subscription 호출.

## 4. 시크릿 / 설정

### Netlify env (운영자)

| key | 용도 |
|---|---|
| `OPEN_DATA_API_KEY` | 공공데이터포털 (유지) |
| `ST_CLIENT_ID` | `smartthings apps:create` 응답의 `oauthClientId` |
| `ST_CLIENT_SECRET` | 동상 |
| `BUS_DEVICE_ID` | 가상 버튼 device id (`<your-device-id>`) |
| `SPEAKER_DEVICE_ID` | (옵션) 갤럭시 홈 미니 device id |

### Netlify Blobs

| key | 값 |
|---|---|
| `st_tokens` | `{ access_token, refresh_token, expires_at, installed_app_id }` |

## 5. App 등록 (CLI)

```bash
smartthings apps:create
```

interactive prompt에서:
- App Type: **API-only / OAuth-In**
- App Name: `bus-tts-api`
- Display Name: `Seoul Bus TTS`
- Target URL: `https://<your-worker-host>.netlify.app/.netlify/functions/smartapp`
- Redirect URI: `https://<your-worker-host>.netlify.app/oauth/callback`
- Scopes: `r:devices:*`, `x:devices:*`

응답에서 `oauthClientId`, `oauthClientSecret` 받아 Netlify env에 저장.

## 6. OAuth Flow (1회)

```
1) 사용자가 https://<your-worker-host>.netlify.app/ 접속
2) "Authorize SmartThings" 버튼 클릭
   → redirect: https://api.smartthings.com/oauth/authorize
     ?response_type=code
     &client_id=$ST_CLIENT_ID
     &redirect_uri=$REDIRECT_URI
     &scope=r:devices:* x:devices:*
3) SmartThings 로그인 + 권한 동의
4) GET /oauth/callback?code=XXX 로 redirect
5) Netlify 함수가 POST https://api.smartthings.com/oauth/token
     grant_type=authorization_code
     code=XXX
     client_id, client_secret, redirect_uri
6) 응답의 access_token, refresh_token, expires_in을
   Netlify Blobs `st_tokens` 키로 저장
7) 같은 핸들러 안에서 subscription 등록:
   POST https://api.smartthings.com/installedapps/$installedAppId/subscriptions
   { sourceType: 'DEVICE', device: { deviceId: BUS_DEVICE_ID,
     componentId: 'main', capability: 'button', attribute: 'button',
     stateChangeOnly: true, subscriptionName: 'busTrigger' } }
8) "설정 완료" 페이지 표시
```

## 7. 정상 EVENT 처리

```
POST /smartapp
{ lifecycle: 'EVENT',
  eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: {...} }] } }
```

핸들러:
1. lifecycle === 'EVENT' && deviceEvent.value === 'pushed' 필터
2. Netlify Blobs에서 token 로드, expires_at 지났으면 refresh
3. `fetchSeoulBus(OPEN_DATA_API_KEY, ARS_ID)` — ARS_ID는 env or Blobs에 저장
4. `buildMessage(items)`
5. `POST /devices/$BUS_DEVICE_ID/commands` (busmessage)
6. (옵션) `POST /devices/$SPEAKER_DEVICE_ID/commands` (TTS)
7. 200 응답

기존 `src/bus.js`의 `fetchSeoulBus`, `buildMessage`, `mapErrorToMessage`는 그대로 재활용.

## 8. Token 관리 (oauth.js)

```js
const { getStore } = require('@netlify/blobs');

async function loadTokens() {
  const store = getStore('st-tokens');
  return await store.get('default', { type: 'json' });
}

async function saveTokens(tokens) {
  const store = getStore('st-tokens');
  await store.setJSON('default', tokens);
}

async function getValidAccessToken() {
  const t = await loadTokens();
  if (!t) throw new Error('not authorized — visit / first');
  if (Date.now() >= t.expires_at - 60_000) {
    const refreshed = await refreshAccessToken(t.refresh_token);
    await saveTokens(refreshed);
    return refreshed.access_token;
  }
  return t.access_token;
}
```

`@netlify/blobs`는 Netlify Functions 안에서 자동 인증 — 별도 API key 불필요.

## 9. ARS_ID 처리

이전 spec에서는 모바일 앱 install 시 SmartApp config로 받았다. API_ONLY는 install UI가 없으므로:

- 옵션 A: Netlify env `BUS_ARS_ID`로 고정 (1인용이라 적정)
- 옵션 B: `/` 페이지에 ARS_ID 입력 폼 → Blobs `app_config`로 저장

기본은 옵션 A. 단순.

## 10. 검증 가정

| 가정 | 검증 방법 |
|---|---|
| API_ONLY 앱도 device.button 이벤트 subscription을 받는다 | 공식 example `api-app-subscription-example-js`가 switch event를 받음. button도 같은 메커니즘 |
| API_ONLY 앱 등록 시에도 CONFIRMATION lifecycle이 발생한다 | example README가 "Unexpected CONFIRMATION request" 로그 언급 — Target URL 등록 시 webhook smartapp과 동일 패턴 |
| Netlify Blobs가 Netlify Functions에서 추가 설정 없이 동작 | Netlify 공식 — runtime injection |
| refresh_token이 무기한 유효 | SmartThings docs: access_token 24h, refresh_token rotation 시 새 값. 매 refresh마다 refresh_token도 새로 받아 저장 필요 |

## 11. 영향 / 마이그레이션

**삭제 (구 Workspace 자산)**:
- (사용자 직접) Developer Workspace의 `bus-tts-smart-app` 프로젝트
- 기존 CLI v3 app은 이미 삭제됨

**유지**:
- 가상 디바이스 `버스 TTS` (id `<your-device-id>`)
- device profile `bus-tts` (id `4712e6d8-...`)
- 커스텀 capability `waterabout01957.busmessage`
- Netlify 사이트 / Netlify env `OPEN_DATA_API_KEY`
- `src/bus.js` 메시지 빌드 로직
- 단위 테스트 (`test/bus.test.js` 그대로, `test/smartapp.test.js`는 재작성)

**신규**:
- `src/oauth.js`, `src/subscription.js`
- `public/index.html` (Authorize 페이지)
- Netlify Blobs storage
- env: `ST_CLIENT_ID`, `ST_CLIENT_SECRET`, `BUS_DEVICE_ID`, `BUS_ARS_ID`, (옵션) `SPEAKER_DEVICE_ID`

## 12. 미해결 / 후속

- `/setup-subscription` 재호출 경로: device id 또는 ARS_ID 변경 시 사용자가 어떻게 재구성할지 (간단: `/` 페이지에 "재인증" 링크 추가)
- Workspace의 v3 프로젝트가 May 2026 이후 자동 삭제될지 — SmartThings 측 통보 대기
- refresh_token이 24h 이상 안 쓰일 때 무효화 정책 — SmartThings 문서 추가 확인 필요
