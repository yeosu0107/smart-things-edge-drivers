# smart-things-edge-drivers

SmartThings Hub에서 동작하는 개인용 Edge Driver 모음. 각 최상위 디렉터리는 독립적인 드라이버 패키지이며, SmartThings CLI를 사용해 개별적으로 패키징·배포한다.

## Drivers

| Driver | Package Key | 설명 |
| --- | --- | --- |
| [`seoul-bus-stop-alarm`](./seoul-bus-stop-alarm/) | `yeosu0107.seoul-bus-stop-alarm` | 서울시 공공데이터포털 버스 도착 정보 API를 호출해 안내 문장을 커스텀 capability로 emit. |

## Edge Driver 패키지 구조

```
<driver>/
├── config.yml                # name, packageKey, description 등 패키지 메타데이터
├── profiles/*.yaml           # capability·preferences 선언
└── src/init.lua              # Driver(...):run() 엔트리포인트
```

커스텀 capability는 SmartThings 개발자 워크스페이스에 사전 등록되어 있어야 하며, Lua 코드에서 `capabilities["<vendor>.<name>"]` 으로 참조한다.

## 외부 HTTP 호출 규칙

Edge Driver는 cosock 기반 협동 스케줄러 위에서 동작한다. 외부 HTTP/HTTPS 호출은 반드시 `cosock.asyncify` 로 감싼 모듈을 사용해 메인 루프를 블록하지 않도록 한다.

```lua
local cosock = require "cosock"
local https  = cosock.asyncify "ssl.https"
```

JSON 파싱은 `dkjson`, URL 인코딩은 `socket.url.escape` 를 사용한다.

## 패키징·배포

[SmartThings CLI](https://github.com/SmartThingsCommunity/smartthings-cli) 가 필요하다.

```bash
# 패키지 검증/업로드 (드라이버 디렉터리를 인자로 지정)
smartthings edge:drivers:package <driver-dir>

# 채널에 할당
smartthings edge:channels:assign

# 허브에 설치
smartthings edge:drivers:install

# 실시간 로그
smartthings edge:drivers:logcat <driverId>
```

로컬 단위 테스트 프레임워크는 두지 않으며, 실제 허브에 배포 후 `logcat` 으로 동작을 확인한다.

## License

[MIT](./LICENSE)
