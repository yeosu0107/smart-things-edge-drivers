# Seoul Bus Alarm — SmartThings Edge Driver

서울시 공공데이터포털의 버스 도착 정보 API를 호출해, 등록한 정류소(ARS-ID)의 도착 안내 문장을 SmartThings 디바이스 attribute로 노출하는 Edge Driver다. 음성 재생(TTS)은 본 드라이버의 책임이 아니며, 같은 SmartThings 환경의 자동화(Routine)에서 호환 스피커와 연결해 사용한다.

## 동작 개요

- 트리거: 사용자가 SmartThings 앱에서 새로고침을 하거나, 자동화의 "Refresh" 액션을 호출할 때.
- 처리: `https://ws.bus.go.kr/api/rest/stationinfo/getStationByUid` 를 cosock 기반 비동기 HTTPS로 호출.
- 결과: 응답을 정제해 한글 안내 문장으로 합성한 뒤 커스텀 capability `yeosu0107.busMessage`로 emit.

폴링은 수행하지 않는다. 주기적 갱신이 필요하면 SmartThings 자동화에서 시간 트리거 + Refresh 액션으로 구성한다.

## 사전 준비

| 항목 | 비고 |
| --- | --- |
| 공공데이터포털 ServiceKey | [data.go.kr](https://www.data.go.kr) "서울특별시\_정류소정보조회 서비스" 활용신청 후 발급. URL-safe하지 않은 문자가 포함되더라도 드라이버가 자동 인코딩한다. |
| 정류소 ARS-ID | 정류장 표지판 또는 서울 버스 앱에서 확인 가능한 5자리 번호. |
| 커스텀 capability `yeosu0107.busMessage` | SmartThings 개발자 워크스페이스에 사전 등록되어 있어야 한다. |
| SmartThings CLI | 패키지·설치에 사용. `brew install smartthingscommunity/smartthings/smartthings` 또는 [공식 릴리즈](https://github.com/SmartThingsCommunity/smartthings-cli/releases). |

## 설정 (Preferences)

프로파일에 정의된 두 항목을 SmartThings 앱의 디바이스 설정에서 입력한다.

| Preference | 키 | 설명 |
| --- | --- | --- |
| 공공데이터포털 API Key | `apiKey` | 발급받은 ServiceKey. |
| 정류소 ID (ARS-ID) | `stationId` | 조회할 서울 버스 정류소 번호. |

값을 변경하면 `infoChanged` 라이프사이클에서 즉시 재조회한다.

## 패키징·배포

```bash
# 패키지 검증 및 업로드
smartthings edge:drivers:package seoul-bus-stop-alarm

# 채널 할당
smartthings edge:channels:assign

# 허브에 설치
smartthings edge:drivers:install

# 실시간 로그 확인
smartthings edge:drivers:logcat <driverId>
```

## 음성 출력 연결 예시

SmartThings 자동화에서:

1. 트리거: `yeosu0107.busMessage` 의 value 변경(또는 시간 기반 트리거 + Refresh 액션 선행).
2. 액션: SmartThings 호환 스피커(SONOS 등)의 "Speak text" / "Play announcement"에 위 attribute 값을 전달.

## 디렉터리 구조

```
seoul-bus-stop-alarm/
├── config.yml                # 패키지 메타데이터
├── profiles/
│   └── bus-profile.yaml      # capability·preferences 선언
└── src/
    └── init.lua              # 드라이버 엔트리포인트
```
