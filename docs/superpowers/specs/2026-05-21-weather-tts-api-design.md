# weather-tts-api 설계

오늘 날씨, 미세먼지, 옷차림 추천을 갤럭시 홈 미니의 speechSynthesis로 안내하는 SmartThings `API_ONLY` 앱. `bus-tts-api`와 동일한 cloud-to-cloud 패턴(Cloudflare Workers + KV + 가상 switch 토글 트리거)을 따른다.

## 동작 흐름

```
[모바일 앱] 가상 switch ON
   │
   ▼ SmartThings 클라우드 → EVENT (DEVICE_EVENT, switch=on) 콜백
[Cloudflare Worker]  ── KV에서 refresh_token 로드 → access_token 자동 갱신
   │
   ├─ Promise.allSettled([
   │     getUltraSrtNcst(nx, ny),              기상청 초단기실황
   │     getVilageFcst(nx, ny),                기상청 단기예보
   │     getMsrstnAcctoRltmMesureDnsty(name),  에어코리아 측정소별 실시간
   │   ])
   │
   ├─ composeAnnouncement(weatherSlots, airSlots)
   │
   ├─ smartthings.speak(SPEAKER_DEVICE_ID, message)
   └─ smartthings.switchOff(WEATHER_DEVICE_ID)
```

`switch=off` 이벤트는 가드로 무시. OAuth callback 직후 `subscription.register(switch.switch)` 1회 호출하여 디바이스 이벤트 구독 자동 등록.

## 디렉터리 구조

```
weather-tts-api/
├─ wrangler.toml             (gitignore, .example에서 생성)
├─ wrangler.toml.example
├─ public/index.html         OAuth 시작 페이지
├─ profiles/weather-profile.yaml
├─ src/
│  ├─ worker.js              Cloudflare Workers entry
│  ├─ smartapp.js            lifecycle 라우터 (PING / CONFIRMATION / EVENT)
│  ├─ oauth.js               bus-tts-api에서 복사
│  ├─ storage.js             bus-tts-api에서 복사
│  ├─ subscription.js        switch.switch 구독 등록 (복사 후 capability만 동일)
│  ├─ smartthings.js         speechSynthesis.speak / switch.off (복사)
│  ├─ weather.js             기상청 API 호출 + 슬롯 추출 + 강수문구
│  ├─ airquality.js          에어코리아 API 호출 + WHO 등급 매핑
│  ├─ outfit.js              기온/조건부 옷차림 룰
│  └─ compose.js             세 모듈 출력 → 자연문장 단락 조립
└─ test/*.test.js            node --test
```

`oauth.js`/`storage.js`/`subscription.js`/`smartthings.js`는 `bus-tts-api`에서 변경 없이 복사한다 (구독 capability `switch.switch`가 동일하므로 `subscription.js`도 그대로). 도메인 로직 4개 모듈(`weather`, `airquality`, `outfit`, `compose`)만 새로 작성하며, 각각 순수 함수로 테스트 가능하게 분리한다.

세 번째 SmartApp이 추가되기 전에는 공유 패키지화하지 않는다 (premature abstraction 회피). bus-tts-api가 운영 중이라 회귀 위험이 더 큰 비용이다.

## 외부 API 호출

### 기상청 단기예보 조회서비스 (VilageFcstInfoService_2.0)

| Endpoint | 용도 | 추출 필드 |
|---|---|---|
| `getUltraSrtNcst` (초단기실황) | 현재 기온, 현재 강수 여부 | `T1H` (기온), `PTY` (강수형태 코드) |

`PTY` 코드 매핑 (음성 출력용):

| PTY | 표현 |
|---|---|
| 0 | 강수 없음 (분기 스킵) |
| 1 | `"비"` |
| 2 | `"비와 눈"` |
| 3 | `"눈"` |
| 4 | `"소나기"` |
| 5 | `"빗방울"` |
| 6 | `"빗방울과 눈날림"` |
| 7 | `"눈날림"` |
| 기타 미정의 | `"강수"` (fallback) |

`·` 같은 구두점은 TTS가 잘못 읽을 위험이 있어 한글로 풀어 적는다.
| `getVilageFcst` (단기예보) | 오늘 최고/최저, 강수확률 | `TMX` (최고), `TMN` (최저), `POP` (강수확률) |

- 위치: 환경변수 `WEATHER_NX` / `WEATHER_NY` (격자좌표). 행정구역→격자 변환은 1회 수동 수행 후 secret으로 박는다.
- 호출 시점에 `base_date` / `base_time`을 산출하는 함수를 `weather.js`에 둔다.
  - 초단기실황: 매시 30분 이후 해당 시 발표분이 유효. 매시 30분 이전이면 직전 시각.
  - 단기예보: 02·05·08·11·14·17·20·23시 발표. 발표시각+10분 이후부터 해당 발표분 사용. 그 전이면 직전 발표.

### 한국환경공단 에어코리아 (ArpltnInforInqireSvc)

| Endpoint | 용도 | 추출 필드 |
|---|---|---|
| `getMsrstnAcctoRltmMesureDnsty` (측정소별 실시간 측정정보) | PM10 / PM2.5 수치 | `pm10Value`, `pm25Value` |

- 위치: 환경변수 `AIR_STATION_NAME` (예: `"강남구"`, `"종로구"`).
- API가 제공하는 `pm10Grade` / `pm25Grade`는 한국 환경부 기준이므로 **사용하지 않고** 수치만 받아 WHO 기준으로 자체 매핑한다.

### 인증 키

`OPEN_DATA_API_KEY` 하나만 사용. data.go.kr 일반인증키는 사용자 단위로 발급되며, 각 API에 "활용 신청"만 별도로 거치면 같은 키로 두 API 모두 호출 가능. bus-tts-api와 동일 secret 값을 공유.

### 호출 전략

세 endpoint를 `Promise.allSettled`로 병렬 호출. 부분 실패 시에도 가능한 슬롯만으로 메시지를 조립. 트리거 빈도가 낮으므로(분당 1회 미만) 캐시는 두지 않는다.

## 메시지 빌더 (`compose.js`)

기상캐스터 톤. 슬롯 순서 고정, 데이터 없는 슬롯은 스킵.

```
[인사]   안녕하세요, 오늘의 날씨를 전해드리겠습니다.
[현재]   현재 기온은 {T1H}도입니다.
[오늘]   낮 최고기온은 {TMX}도, 아침 최저기온은 {TMN}도가 되겠습니다.
[강수]   {강수문구}.
[먼지]   미세먼지는 {grade}, 초미세먼지는 {grade}로 예상됩니다.
[옷차림] 오늘은 {기온표 문구} 추천드립니다. {조건부 마무리}.
[클로징] 오늘도 좋은 하루 보내세요.
```

### 강수문구 분기

- 현재 강수 중 (`PTY > 0`): `"지금 {PTY 매핑 표현}이 내리고 있습니다"`
- 강수 예정 (`POP ≥ 60`, 현재 강수 없음): `"오늘 비 올 확률은 {POP}퍼센트로, 우산이 필요하겠습니다"`
- 그 외: 슬롯 스킵

`PTY`(초단기실황)와 `POP`(단기예보)이 서로 다른 endpoint에서 오므로 한쪽만 받은 경우에도 가능한 분기는 평가한다. 둘 다 없으면 슬롯 스킵.

`%` 기호는 TTS 발음이 불안정할 수 있어 `"퍼센트"`로 풀어서 출력. 운영 중 실제 발음으로 재조정.

### 미세먼지 등급 (WHO Air Quality Guidelines 2021, 24h 기준)

| 등급 | PM10 (µg/m³) | PM2.5 (µg/m³) | 출처 |
|---|---|---|---|
| 좋음 | ≤ 45 | ≤ 15 | WHO AQG (2021) |
| 보통 | 46 ~ 75 | 16 ~ 25 | WHO IT-4 |
| 나쁨 | > 75 | > 25 | IT-4 초과 |

음성에는 수치를 포함하지 않고 등급만 출력. (한국 환경부 기본 등급보다 엄격해 같은 수치에서 "나쁨" 비율이 높다.)

### 옷차림 룰 (`outfit.js`)

기준 기온은 **오늘 최고기온**(`TMX`). 외출이 보통 낮 시간이므로.

| 최고기온 (°C) | 추천 문구 |
|---|---|
| ≥ 28 | `"반팔과 반바지, 린넨 소재"` |
| 23 ~ 27 | `"반팔이나 얇은 셔츠"` |
| 20 ~ 22 | `"얇은 긴팔이나 가디건"` |
| 17 ~ 19 | `"맨투맨이나 얇은 니트"` |
| 12 ~ 16 | `"자켓이나 트렌치코트"` |
| 9 ~ 11 | `"야상이나 바람막이"` |
| 5 ~ 8 | `"코트나 두꺼운 니트"` |
| < 5 | `"패딩에 목도리와 장갑까지"` |

조건부 마무리(둘 다 해당 시 둘 다 붙임):

- 강수문구가 있는 날: `"우산 꼭 챙기시기 바랍니다"`
- PM10 또는 PM2.5 중 하나라도 "나쁨": `"외출 시 마스크 착용 권장드립니다"`

### 출력 예시

> "안녕하세요, 오늘의 날씨를 전해드리겠습니다. 현재 기온은 12도입니다. 낮 최고기온은 16도, 아침 최저기온은 8도가 되겠습니다. 오늘 비 올 확률은 70퍼센트로, 우산이 필요하겠습니다. 미세먼지는 좋음, 초미세먼지는 보통으로 예상됩니다. 오늘은 자켓이나 트렌치코트 추천드립니다. 우산 꼭 챙기시기 바랍니다. 오늘도 좋은 하루 보내세요."

## 에러 처리

bus-tts-api의 `mapErrorToMessage` 패턴을 도메인별로 확장.

| 출처 | 코드 | 음성 메시지 |
|---|---|---|
| `weather.js` | `NETWORK` / `HTTP_STATUS` / `JSON_PARSE` | `"날씨 정보 조회에 실패했습니다."` |
| `weather.js` | `NO_ITEM` | `"현재 날씨 정보가 제공되지 않습니다."` |
| `airquality.js` | `NETWORK` / `HTTP_STATUS` / `JSON_PARSE` | `"미세먼지 정보 조회에 실패했습니다."` |
| `airquality.js` | `NO_ITEM` | `"미세먼지 측정 데이터가 없습니다."` |

**부분 실패 정책**: 세 호출 중 일부가 reject되더라도 가능한 슬롯만으로 메시지 조립. 예) 에어코리아만 실패하면 [먼지] 슬롯을 건너뛰고 끝에 `"미세먼지 정보는 조회에 실패했습니다"`를 부가한다. 옷차림의 마스크 조건도 PM 데이터가 없으면 평가하지 않는다.

슬롯별 의존도:

- [현재] 기온: 초단기실황의 `T1H` 필요. 없으면 슬롯 스킵.
- [오늘] 최고/최저: 단기예보의 `TMX` / `TMN` 필요. 둘 다 없으면 슬롯 스킵, 하나만 있으면 있는 쪽만 출력.
- [옷차림]: 단기예보 `TMX` 필요. `TMX`가 없으면 옷차림 슬롯 자체를 스킵하고 조건부 마무리도 출력하지 않는다 (기준 기온 없이는 추천 자체가 무의미).
- [먼지]: PM10 / PM2.5 중 하나라도 있으면 있는 쪽만 출력.

**전체 실패** (세 호출 모두 reject): `"오늘 날씨 정보를 가져올 수 없습니다."`

**OAuth/토큰 에러**: bus-tts-api와 동일. 토큰 갱신 실패 시 worker가 500을 SmartThings에 반환하고 speak/switchOff 호출 자체를 스킵.

## 환경/시크릿

### Cloudflare Worker secret

| 이름 | 의미 |
|---|---|
| `ST_CLIENT_ID` | 새 API_ONLY 앱의 OAuth client id |
| `ST_CLIENT_SECRET` | 동 client secret |
| `ST_REDIRECT_URI` | `https://<weather-worker-host>/oauth/callback` |
| `OPEN_DATA_API_KEY` | data.go.kr 일반인증키 (bus-tts-api와 동일 값) |
| `WEATHER_NX` | 기상청 격자 X |
| `WEATHER_NY` | 기상청 격자 Y |
| `AIR_STATION_NAME` | 에어코리아 측정소명 |
| `WEATHER_DEVICE_ID` | 새 가상 switch device id |
| `SPEAKER_DEVICE_ID` | 갤럭시 홈 미니 device id (bus-tts-api와 동일 값) |

KV namespace는 `ST_TOKENS` binding으로 새 namespace를 별도로 생성한다. bus-tts-api와 namespace를 공유하지 않는다 (격리).

### bus-tts-api 대비 재사용 가능 여부

| Secret | 재사용 가능 | 이유 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 가능 | 같은 Cloudflare 계정 |
| `CLOUDFLARE_ACCOUNT_ID` | 가능 | 같은 Cloudflare 계정 |
| `OPEN_DATA_API_KEY` | 가능 | data.go.kr 일반인증키는 사용자 단위 공용 |
| `SPEAKER_DEVICE_ID` | 가능 | 같은 갤럭시 홈 미니 device id |
| `ST_CLIENT_ID` | 불가 | 새 API_ONLY 앱은 별개 OAuth client |
| `ST_CLIENT_SECRET` | 불가 | 동상 |
| `ST_REDIRECT_URI` | 불가 | 새 worker host |
| `WEATHER_DEVICE_ID` | 불가 | 새 가상 device |
| `KV_NAMESPACE_ID` | 불가 | 격리 위해 별도 namespace |

### GitHub Secret 이름 매핑

GitHub repo의 secret namespace는 flat이라 두 워크플로우가 같은 이름을 공유한다. 재사용 가능한 4개는 그대로 참조하고, 별개여야 하는 것은 `WEATHER_` prefix를 붙여서 등록 후 워크플로우에서 wrangler용 짧은 이름으로 변환한다.

```
# 재사용 (bus와 공유)
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
OPEN_DATA_API_KEY
SPEAKER_DEVICE_ID

# weather-tts-api 전용 (새로 등록)
WEATHER_ST_CLIENT_ID         → wrangler secret: ST_CLIENT_ID
WEATHER_ST_CLIENT_SECRET     → ST_CLIENT_SECRET
WEATHER_ST_REDIRECT_URI      → ST_REDIRECT_URI
WEATHER_DEVICE_ID            → WEATHER_DEVICE_ID
WEATHER_KV_NAMESPACE_ID      → wrangler.toml의 KV id로 치환
WEATHER_NX                   → WEATHER_NX
WEATHER_NY                   → WEATHER_NY
AIR_STATION_NAME             → AIR_STATION_NAME
```

## 디바이스 프로파일

`profiles/weather-profile.yaml` — `switch` capability 하나만 둔다. bus-tts-api의 `waterabout01957.busmessage` 같은 표시용 custom capability는 추가하지 않는다 (ROI 낮음).

## 배포

`.github/workflows/deploy-weather-tts.yml`를 새로 추가. `deploy-bus-tts.yml`을 복제하고 worker name(`weather-tts-smartapp`) / secret 목록 / KV id 변수만 교체한다. 수동 트리거(`workflow_dispatch`) 전용. 1회 셋업(API_ONLY 앱 등록, 가상 device 생성, KV namespace 생성, OAuth 동의)은 `weather-tts-api/README.md`에 절차로 남긴다.

## 테스트

`test/*.test.js`, node `--test`:

- `outfit.test.js`: 기온 경계값 (4/5/8/9/11/12/16/17/19/20/22/23/27/28) → 룰 매핑. 조건부 추가어 조합 4케이스 (강수 ON/OFF × 먼지 나쁨 ON/OFF).
- `airquality.test.js`: PM 수치 → WHO 등급 경계값 (PM2.5: 15/16/25/26, PM10: 45/46/75/76).
- `weather.test.js`: 슬롯 추출, 강수문구 분기 (`PTY=0/1/2/3/4`, `POP=59/60`), base_date/base_time 산정 (단기실황 시각 30분 직전/직후, 단기예보 발표시각 ±10분, 자정 경계).
- `compose.test.js`: 메시지 빌더 — 모든 슬롯 정상 / 먼지만 없음 / 강수 슬롯 스킵 / 전체 실패 등 5케이스.
- `error-map.test.js`: 각 에러 코드 → 음성 문구.

`oauth.js` / `storage.js` / `subscription.js` / `smartthings.js`는 bus-tts-api에서 그대로 복사되며 그 쪽 테스트가 이미 cover하므로 새 프로젝트에 동일 테스트를 다시 두지 않는다.
