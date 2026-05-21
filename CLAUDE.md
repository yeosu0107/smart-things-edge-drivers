# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

이 레포지토리는 SmartThings용 cloud-to-cloud 통합 모음이다. 각 프로젝트는 독립된 디렉터리로 들어 있으며, 최상위 디렉터리 하나가 하나의 통합(SmartApp / API_ONLY 앱 등)에 대응한다.

현재 포함된 프로젝트:

- `bus-tts-api/` — 서울시 공공데이터포털 버스 도착 정보 API를 호출해, SmartThings 가상 디바이스 switch toggle을 트리거로 갤럭시 홈 미니에서 TTS 안내를 출력. SmartThings `API_ONLY` 앱(OAuth-In) + Cloudflare Workers + KV 기반. 상세는 [`bus-tts-api/README.md`](bus-tts-api/README.md).

> 참고: 과거에는 SmartThings Edge Driver(`seoul-bus-stop-alarm/`)도 포함되어 있었으나, hub의 외부 인터넷 직접 호출이 platform 차원에서 차단되어 cloud-to-cloud 구조로 옮겼다. 관련 의사결정은 `docs/` 참고.

## 용어: "SmartApp" vs `API_ONLY` 앱

본문/커밋/디렉터리에서 종종 "SmartApp"이라 부르지만, SmartThings 공식 분류상 `AppType`은 세 가지로 나뉜다:

| `AppType` | 성격 | lifecycle |
|---|---|---|
| `WEBHOOK_SMART_APP` | 좁은 의미의 SmartApp. 모바일 앱에서 사용자가 install / configure. | `PING`, `CONFIGURATION`, `INSTALL`, `UPDATE`, `EVENT` |
| `LAMBDA_SMART_APP` | 위와 동일하나 AWS Lambda 기반. | 동일 |
| `API_ONLY` | OAuth-In 통합. 모바일 앱에 install되지 않으며, 외부 서비스가 OAuth로 사용자 동의를 받아 SmartThings API를 직접 호출. | `PING`, `CONFIRMATION`, 디바이스 이벤트만 |

`bus-tts-api`는 **`API_ONLY` 앱**이다 (`appType: API_ONLY`, `CONFIGURATION`/`INSTALL`/`UPDATE` 핸들러 없음, 모바일 앱에 노출되지 않음, OAuth callback에서 `registerSubscription`으로 구독을 코드에서 직접 등록). 관용적으로 "API-only SmartApp"이라 호칭하지만, 새 통합을 추가할 땐 위 분류를 의식하고 적절한 `appType`을 선택할 것.

## `bus-tts-api` Anatomy

Cloudflare Workers 위에서 SmartThings `API_ONLY` 앱으로 동작한다:

- `wrangler.toml` — Cloudflare Workers 설정 + KV binding (gitignore, `wrangler.toml.example`에서 생성).
- `src/worker.js` — Workers entry. fetch 핸들러에서 path 기반으로 OAuth / lifecycle / 디바이스 이벤트 라우팅.
- `src/smartapp.js` — lifecycle 처리. 실제로 다루는 케이스는 `PING`, `CONFIRMATION`, `EVENT`(`DEVICE_EVENT` switch=on) 세 가지. `API_ONLY`는 `CONFIGURATION`/`INSTALL`/`UPDATE`를 보내지 않으므로 의도적으로 핸들러가 없다.
- `src/oauth.js` — OAuth authorize URL 빌드, code 교환, refresh, `getValidAccessToken()`로 만료 시 자동 갱신.
- `src/storage.js` — KV 기반 토큰 저장 abstraction (로컬 테스트용 memory storage 포함).
- `src/subscription.js` — 디바이스 이벤트 구독 등록 (`switch.switch`). OAuth callback 직후 1회 호출.
- `src/smartthings.js` — SmartThings API로 디바이스 명령 전송 (`speechSynthesis.speak`, `switch.off` 등).
- `src/bus.js` — 서울시 공공데이터 버스 API 호출 + 안내 메시지 빌드.
- `profiles/*.yaml` — SmartThings device profile (가상 디바이스용, `switch` + 커스텀 capability).
- `test/*.test.js` — `node --test` 기반 단위 테스트.

SmartThings에 등록한 `API_ONLY` 앱은 worker의 `targetUrl`로 lifecycle 콜백을 보내고, worker는 KV에 보관한 `refresh_token`으로 access token을 갱신하며 양방향 호출을 처리한다.

## HTTP / 비동기 호출 규약

Cloudflare Workers V8 isolate 위에서 동작하므로 Node.js API가 아니라 **Web 표준 API**(`fetch`, `Request`, `Response`, `crypto.subtle`)를 사용한다. 외부 호출은 모두 글로벌 `fetch`로, JSON은 표준 `JSON.parse` / `response.json()`을 쓴다. `node:*` 모듈 import는 피하고, 꼭 필요한 경우에만 wrangler `compatibility_flags = ["nodejs_compat"]`을 검토.

## 빌드 / 테스트 / 배포

```bash
# 단위 테스트 (node --test)
cd bus-tts-api
npm install
npm test

# 로컬 실행 (Cloudflare Workers dev server)
wrangler dev

# 배포
wrangler deploy
```

CI/CD는 `.github/workflows/deploy-bus-tts.yml`로 정의되어 있으며 **수동 트리거(`workflow_dispatch`) 전용**이다. GitHub UI의 Actions → "Deploy bus-tts-api" → Run workflow, 또는 `gh workflow run deploy-bus-tts.yml`로 실행. workflow는 GitHub Secret에서 `wrangler.toml` 생성 → `wrangler secret bulk`로 secret 동기화 → `wrangler deploy` 순서로 진행한다. 등록해야 할 GitHub Secret 목록과 SmartThings 측 갱신 절차(프로파일 / `targetUrl` / OAuth scope 변경)는 [`bus-tts-api/README.md`](bus-tts-api/README.md) 참고.

배포 후 동작 검증:

```bash
wrangler tail bus-tts-smartapp --format pretty   # 실시간 worker 로그 (worker name은 'bus-tts-smartapp' 유지)
smartthings devices:status <device-id>           # SmartThings 측 상태
```

> 참고: 디렉터리명은 `bus-tts-api`이지만 Cloudflare worker name은 운영 무중단을 위해 `bus-tts-smartapp`을 유지한다 (`wrangler.toml.example`의 `name` 필드). `targetUrl` / OAuth redirect URI도 그대로.

## 시크릿 / 자격증명 정책

`wrangler.toml`, `.env`, OAuth client secret, access / refresh token 등 비밀은 절대 레포에 커밋하지 않는다. 운영 비밀은 GitHub Secret + Cloudflare Worker secret(`wrangler secret put`)이 source of truth이고, 사용자 토큰은 Cloudflare KV에만 저장한다.
