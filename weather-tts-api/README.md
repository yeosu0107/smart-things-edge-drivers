# weather-tts-api

오늘 날씨와 미세먼지를 SmartThings 가상 switch toggle로 트리거 → 갤럭시 홈 미니에서 기상캐스터 톤 TTS로 안내하는 cloud-to-cloud 자동화. SmartThings `API_ONLY` 앱(OAuth-In) 패턴, Cloudflare Workers + KV. `bus-tts-api`와 동일한 패턴.

> Cloudflare worker name: `weather-tts-smartapp` (deploy URL의 host 부분).

## 동작 흐름

```
[모바일 앱] switch ON
   │
   ▼ SmartThings 클라우드
[Cloudflare Worker]  ── KV에서 refresh_token 로드 → access_token 갱신
   │ 1. 기상청 초단기실황 + 단기예보 + 에어코리아 측정소별 실시간 (Promise.allSettled)
   │ 2. composeAnnouncement → 자연문장 한 단락
   │ 3. 갤럭시 홈 미니: speechSynthesis.speak
   │ 4. 가상 switch: off (자동 원복)
   ▼
[갤럭시 홈 미니] 음성 출력
```

## 디렉터리

```
weather-tts-api/
├─ wrangler.toml             Cloudflare Workers 설정 + KV binding (gitignore)
├─ wrangler.toml.example
├─ public/index.html         OAuth 시작 페이지 (참고용; worker는 인라인 serve)
├─ profiles/weather-profile.yaml
├─ src/
│  ├─ worker.js              Cloudflare Workers entry
│  ├─ smartapp.js            lifecycle 라우터 (PING / CONFIRMATION / EVENT)
│  ├─ oauth.js               bus-tts-api에서 그대로 복사
│  ├─ storage.js             동상
│  ├─ subscription.js        동상
│  ├─ smartthings.js         동상
│  ├─ weather.js             기상청 API + 슬롯 추출 + base date/time
│  ├─ airquality.js          에어코리아 API + WHO 등급 매핑
│  ├─ outfit.js              기온/조건부 옷차림 룰
│  └─ compose.js             세 모듈 출력 → 자연문장 단락
└─ test/*.test.js
```

## 로컬 테스트

```bash
cd weather-tts-api
npm install
npm test
```

## 1회 셋업

### 1. SmartThings API_ONLY 앱 등록

```yaml
# api-only-app.yaml
appName: weather-tts-api
displayName: Weather TTS
appType: API_ONLY
classifications: [AUTOMATION]
oauth:
  clientName: Weather TTS
  scope: [r:devices:*, x:devices:*]
  redirectUris: [https://<weather-worker-host>/oauth/callback]
```

```bash
smartthings apps:create -i api-only-app.yaml
# 응답에서 appId / oauthClientId / oauthClientSecret 보관

smartthings apps:update <appId> -i - <<EOF
appName: weather-tts-api
appType: API_ONLY
apiOnly:
  targetUrl: https://<weather-worker-host>/
EOF
```

### 2. 가상 디바이스 + 프로파일

```bash
smartthings deviceprofiles:view:create -i profiles/weather-profile.yaml
smartthings virtualdevices:create -N "날씨 TTS" -P <profile-id> -l <location-id> -R <room-id>
smartthings virtualdevices:events <device-id> switch:switch off
```

### 3. Cloudflare Workers + KV (local)

```bash
wrangler login
wrangler kv namespace create ST_TOKENS    # 출력된 id 보관 (bus-tts와는 별도 namespace)
cp wrangler.toml.example wrangler.toml    # <KV_NAMESPACE_ID> 치환
```

### 4. 시크릿 등록 (local)

```bash
wrangler secret put ST_CLIENT_ID
wrangler secret put ST_CLIENT_SECRET
wrangler secret put ST_REDIRECT_URI       # https://<weather-worker-host>/oauth/callback
wrangler secret put OPEN_DATA_API_KEY     # bus-tts-api와 동일 값
wrangler secret put WEATHER_DEVICE_ID
wrangler secret put SPEAKER_DEVICE_ID     # bus-tts-api와 동일 값
wrangler secret put WEATHER_NX            # 기상청 격자 X
wrangler secret put WEATHER_NY            # 기상청 격자 Y
wrangler secret put AIR_STATION_NAME      # 에어코리아 측정소명
```

### 5. data.go.kr 활용 신청

`OPEN_DATA_API_KEY`(일반인증키)는 사용자 단위로 발급되지만, **사용할 API마다 "활용 신청"을 따로** 거쳐야 한다:

- 기상청 단기예보 조회서비스 (15084084)
- 한국환경공단_에어코리아_대기오염정보 (15073861)

활용 신청 승인 즉시 같은 키로 호출 가능.

### 6. 행정구역 → 격자좌표

기상청은 5km 격자 좌표(nx/ny)를 사용한다. 사용 위치의 nx/ny는 기상청 공식 변환표에서 1회 조회해 secret으로 박는다 (예: 서울 강남구 ≈ nx=61, ny=126).

### 7. 배포 + CONFIRMATION

```bash
wrangler deploy
smartthings apps:register <appId>
smartthings apps <appId> | grep targetStatus   # CONFIRMED 확인
```

### 8. 사용자 1회 OAuth

브라우저 → `https://<weather-worker-host>/` → "SmartThings로 인증" → 권한 동의. worker가 token 교환 + 구독(switch.switch) 자동 등록.

이후 모바일 앱에서 가상 디바이스 switch ON으로 트리거.

## CI/CD

수동 트리거만 (`workflow_dispatch`). Actions → "Deploy weather-tts-api" → **Run workflow** 또는:

```bash
gh workflow run deploy-weather-tts.yml
```

GitHub Secret (`.github/workflows/deploy-weather-tts.yml` 참고):

| 이름 | bus-tts와 공유 | 의미 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Cloudflare account id |
| `OPEN_DATA_API_KEY` | ✅ | data.go.kr 일반인증키 |
| `SPEAKER_DEVICE_ID` | ✅ | 갤럭시 홈 미니 device id |
| `WEATHER_KV_NAMESPACE_ID` | — | weather 전용 KV namespace |
| `WEATHER_ST_CLIENT_ID` | — | weather 앱 OAuth client id |
| `WEATHER_ST_CLIENT_SECRET` | — | 동 secret |
| `WEATHER_ST_REDIRECT_URI` | — | `https://<weather-worker-host>/oauth/callback` |
| `WEATHER_DEVICE_ID` | — | weather 가상 device id |
| `WEATHER_NX`, `WEATHER_NY` | — | 격자좌표 |
| `AIR_STATION_NAME` | — | 측정소명 |

## 디버그

```bash
wrangler tail weather-tts-smartapp --format pretty
wrangler kv key get default --namespace-id <id> --remote
smartthings devices:status <device-id>
```
