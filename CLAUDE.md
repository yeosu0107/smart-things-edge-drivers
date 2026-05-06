# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

이 레포지토리는 SmartThings Edge Drivers 모음이다. 각 드라이버는 SmartThings Hub에서 실행되는 독립적인 Lua 패키지이며, 최상위 디렉터리 하나가 하나의 드라이버에 대응한다.

현재 포함된 드라이버:

- `seoul-bus-stop-alarm/` — 서울시 공공데이터포털의 버스 도착 정보 API(`ws.bus.go.kr`)를 호출해 커스텀 capability `yeosu0107.busMessage`로 안내 문장을 emit하는 드라이버. `packageKey`는 `yeosu0107.seoul-bus-stop-alarm`.

## Edge Driver Anatomy

각 드라이버는 SmartThings Edge가 요구하는 고정 레이아웃을 따른다:

- `config.yml` — `name`, `packageKey`, `description` 등 패키지 메타데이터.
- `profiles/*.yaml` — 디바이스 프로파일. `components`에 사용 capability(예: `switch`, `refresh`, 커스텀 `yeosu0107.busMessage`)와 `preferences`(사용자 입력 필드: API key, 정류소 ID 등)를 선언. 프로파일에 선언된 preference는 런타임에서 `device.preferences.<name>`으로 접근.
- `src/init.lua` — 드라이버 엔트리포인트. `Driver(name, template):run()` 으로 실행되며 `template`의 `supported_capabilities`/`capability_handlers`로 각 capability command와 핸들러를 매핑한다.

커스텀 capability(`yeosu0107.busMessage` 등)는 SmartThings 개발자 워크스페이스에서 별도로 등록되어 있어야 하며, 코드에서는 `capabilities["yeosu0107.busMessage"]`로 참조한다.

## HTTP / 비동기 호출 규약

Edge 드라이버는 cosock 기반 협동 스케줄러 위에서 동작한다. 외부 HTTP 호출은 반드시 `cosock.asyncify "socket.http"`로 감싼 모듈을 사용해야 메인 루프를 블록하지 않는다 — `init.lua`의 `local http = cosock.asyncify "socket.http"` 패턴을 따를 것. JSON 파싱은 `dkjson`을 사용한다.

## 빌드 / 배포

이 레포지토리에는 자체 빌드 스크립트나 테스트 러너가 없다. 검증·배포는 SmartThings CLI(`smartthings`)로 수행한다:

```bash
# 패키지 검증/업로드 (드라이버 디렉터리를 인자로 지정)
smartthings edge:drivers:package seoul-bus-stop-alarm

# 채널에 할당
smartthings edge:channels:assign

# 허브에 설치 (특정 허브에 직접 설치할 때)
smartthings edge:drivers:install
```

로컬 단위 테스트 프레임워크는 설정되어 있지 않으므로, 동작 검증은 실제 허브에 배포 후 SmartThings 앱 또는 `smartthings edge:drivers:logcat`으로 로그를 확인하는 방식으로 진행한다.
