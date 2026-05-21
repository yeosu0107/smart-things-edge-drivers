# smartthings-apps

[![SmartThings](https://img.shields.io/badge/SmartThings-Cloud%20App-15bfff?logo=smartthings&logoColor=white)](https://developer.smartthings.com/docs/getting-started/welcome)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

SmartThings cloud-to-cloud 앱 모음. SmartThings 공식 `/apps` 카테고리(`WEBHOOK_SMART_APP` / `LAMBDA_SMART_APP` / `API_ONLY`)에 해당하는 프로젝트들을 담는다.

## 포함 프로젝트

- [`bus-tts-api/`](bus-tts-api/) — 서울시 버스 도착 정보를 SmartThings 가상 디바이스 switch toggle로 트리거하고 갤럭시 홈 미니에서 TTS로 출력. `API_ONLY` 앱(OAuth-In) + Cloudflare Workers + KV.

각 프로젝트의 README에 setup/배포/CI/CD 절차가 있습니다.
