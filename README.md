# smart-things-edge-drivers



SmartThings Hub에서 동작하는 개인용 Edge Driver 모음. 각 최상위 디렉터리는 독립적인 드라이버 패키지이며, SmartThings CLI를 사용해 개별적으로 패키징·배포한다.

## Drivers

| Driver | Package Key | 설명 |
| --- | --- | --- |
| [`seoul-bus-stop-alarm`](./seoul-bus-stop-alarm/) | `waterabout01957.seoul-bus-stop-alarm` | 서울시 공공데이터포털 버스 도착 정보 API를 호출해 안내 문장을 커스텀 capability로 emit. |
