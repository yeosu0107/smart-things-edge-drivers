# bus-tts-smartapp

서울시 버스 도착 정보를 SmartThings 가상 디바이스 switch toggle로 트리거 → 갤럭시 홈 미니에서 TTS로 안내하는 cloud-to-cloud 자동화. SmartThings API_ONLY (OAuth-In) 패턴, Cloudflare Workers + KV.

## 동작 흐름

```
[모바일 앱] switch ON
   │
   ▼ SmartThings 클라우드
[Cloudflare Worker]  ── KV에서 refresh_token 로드 → access_token 갱신
   │ 1. 서울시 공공데이터 API 호출 → 메시지 빌드
   │ 2. 갤럭시 홈 미니: speechSynthesis.speak
   │ 3. 가상 switch: off (자동 원복)
   ▼
[갤럭시 홈 미니] 음성 출력
```

## 디렉터리

```
bus-tts-smartapp/
├─ wrangler.toml             Cloudflare Workers 설정 + KV binding
├─ public/index.html         OAuth 시작 페이지 (worker가 인라인 serve)
├─ profiles/bus-profile.yaml SmartThings device profile (switch + busmessage)
├─ src/
│  ├─ worker.js              Cloudflare Workers entry
│  ├─ smartapp.js            HTTP 라우터 + lifecycle 처리
│  ├─ oauth.js               OAuth code exchange / refresh / getValidAccessToken
│  ├─ storage.js             KV / memory storage abstraction
│  ├─ subscription.js        device subscription register (switch.switch)
│  ├─ smartthings.js         device command sender
│  └─ bus.js                 서울 버스 API + 메시지 빌드
└─ test/*.test.js            node --test 단위 테스트
```

## 로컬 테스트

```bash
npm install
npm test
```

## 1회 셋업 (재구축할 때)

### 1. SmartThings API_ONLY 앱 등록

```yaml
# api-only-app.yaml
appName: bus-tts-api
displayName: Seoul Bus TTS
appType: API_ONLY
classifications: [AUTOMATION]
oauth:
  clientName: Seoul Bus TTS
  scope: [r:devices:*, x:devices:*]
  redirectUris: [https://<your-worker-host>/oauth/callback]
```

```bash
smartthings apps:create -i api-only-app.yaml
# 응답에서 appId / oauthClientId / oauthClientSecret 보관

# target URL 추가:
smartthings apps:update <appId> -i - <<EOF
appName: bus-tts-api
appType: API_ONLY
apiOnly:
  targetUrl: https://<your-worker-host>/
EOF
```

### 2. 가상 디바이스 + 프로파일

```bash
smartthings deviceprofiles:view:create -i profiles/bus-profile.yaml
smartthings virtualdevices:create -N "버스 TTS" -P <profile-id> -l <location-id> -R <room-id>
smartthings virtualdevices:events <device-id> switch:switch off
```

### 3. Cloudflare Workers + KV (local 작업용)

```bash
wrangler login
wrangler kv namespace create ST_TOKENS              # 출력된 id 보관
cp wrangler.toml.example wrangler.toml              # 그 다음 wrangler.toml의 <KV_NAMESPACE_ID> 치환
```

(`wrangler.toml`은 gitignore. CI는 `wrangler.toml.example`에서 동적으로 생성)

### 4. 시크릿 등록 (local 작업용)

```bash
wrangler secret put ST_CLIENT_ID
wrangler secret put ST_CLIENT_SECRET
wrangler secret put OPEN_DATA_API_KEY      # 서울시 공공데이터포털 키
wrangler secret put BUS_DEVICE_ID
wrangler secret put SPEAKER_DEVICE_ID
wrangler secret put BUS_ARS_ID
wrangler secret put ST_REDIRECT_URI        # https://<your-worker-host>/oauth/callback
```

(CI를 통한 자동 배포 시엔 아래 "CI/CD" 섹션의 GitHub Secret만 등록하면 workflow가 알아서 sync)

### 5. 배포 + CONFIRMATION 핸드셰이크

```bash
wrangler deploy
smartthings apps:register <appId>
smartthings apps <appId> | grep targetStatus    # CONFIRMED 확인
```

### 6. 사용자 1회 OAuth

브라우저로 `https://<your-worker-host>/` 접속 → "SmartThings로 인증" → 권한 동의. worker가 OAuth code → token 교환 + 구독(switch.switch) 자동 등록 + token KV 저장.

이후 모바일 앱에서 가상 디바이스 switch ON으로 트리거.

## CI/CD (GitHub Actions)

`main` push 시 자동 배포. `.github/workflows/deploy.yml` 참고. **모든 값을 GitHub Secret에서 source-of-truth로 관리**하고, workflow가:

1. `wrangler.toml.example`을 GitHub Secret의 KV namespace id로 치환해서 `wrangler.toml` 생성
2. `wrangler secret bulk`로 worker secret 7개 모두 Cloudflare에 동기화
3. `wrangler deploy`

GitHub repo Settings → Secrets and variables → Actions에 다음 9개 secret 등록:

| GitHub Secret | 발급 위치 / 의미 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/profile/api-tokens → Create Token → 템플릿 "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard 우측 사이드바 → Account ID 복사 |
| `KV_NAMESPACE_ID` | `wrangler kv namespace create ST_TOKENS`로 발급받은 id |
| `ST_CLIENT_ID`, `ST_CLIENT_SECRET` | `smartthings apps:create` 응답의 OAuth 자격증명 |
| `OPEN_DATA_API_KEY` | 서울시 공공데이터포털 발급 키 |
| `BUS_DEVICE_ID`, `SPEAKER_DEVICE_ID` | SmartThings device id (가상 device, 갤럭시 홈 미니) |
| `BUS_ARS_ID` | 정류소 ARS-ID |
| `ST_REDIRECT_URI` | `https://<your-worker-host>/oauth/callback` |

## 디버그

```bash
wrangler tail bus-tts-smartapp --format pretty
wrangler kv key get default --namespace-id <id> --remote
smartthings devices:status <device-id>
```
