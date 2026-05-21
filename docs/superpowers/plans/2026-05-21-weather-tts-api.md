# weather-tts-api Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `weather-tts-api/`, a SmartThings `API_ONLY` app that — on a virtual switch toggle — fetches today's weather + air quality from data.go.kr APIs and speaks a weather-broadcaster-toned announcement via Galaxy Home Mini.

**Architecture:** Mirror `bus-tts-api/` directory layout on the same Cloudflare Workers + KV + OAuth-In pattern. Copy `oauth.js`/`storage.js`/`subscription.js`/`smartthings.js` verbatim. Implement four new domain modules — `weather.js`, `airquality.js`, `outfit.js`, `compose.js` — as pure functions where possible, each behind a small test surface. New API_ONLY app, new KV namespace, new worker (name: `weather-tts-smartapp`). Run alongside bus-tts-api with no shared infra.

**Tech Stack:** Cloudflare Workers (V8 isolate, Web Fetch API, no Node APIs in src), KV, Node `--test` for unit tests, `wrangler` CLI for deploy, GitHub Actions for CI. ESM modules.

**Spec:** `docs/superpowers/specs/2026-05-21-weather-tts-api-design.md`

---

## File Structure

```
weather-tts-api/
├─ .gitignore
├─ package.json
├─ wrangler.toml.example     (gitignored: wrangler.toml is generated)
├─ public/
│  └─ index.html             OAuth start page
├─ profiles/
│  └─ weather-profile.yaml   SmartThings device profile
├─ src/
│  ├─ worker.js              Cloudflare Workers fetch handler entry
│  ├─ smartapp.js            HTTP router + lifecycle (PING/CONFIRMATION/EVENT)
│  ├─ oauth.js               Copied verbatim from bus-tts-api
│  ├─ storage.js             Copied verbatim
│  ├─ subscription.js        Copied verbatim
│  ├─ smartthings.js         Copied verbatim
│  ├─ weather.js             KMA API + base_date/base_time + slot extraction + PTY mapping
│  ├─ airquality.js          AirKorea API + WHO grade mapping
│  ├─ outfit.js              Temperature → outfit rule + conditional addenda
│  └─ compose.js             Slot composition → single-paragraph announcement
└─ test/
   ├─ weather.test.js
   ├─ airquality.test.js
   ├─ outfit.test.js
   ├─ compose.test.js
   └─ smartapp.test.js
.github/workflows/
└─ deploy-weather-tts.yml
```

**Module responsibilities:**

- `weather.js`: pure helpers (`getBaseDateTimeNcst`, `getBaseDateTimeFcst`, `mapPty`, `extractWeatherSlots`) + `fetchUltraSrtNcst` + `fetchVilageFcst` + `mapWeatherError`.
- `airquality.js`: pure `gradePm10`/`gradePm25` + `fetchAirQuality` + `mapAirError`.
- `outfit.js`: pure `recommendOutfit(tmx)` + `buildAddenda({hasPrecip, badAir})`.
- `compose.js`: pure `composeAnnouncement({weather, air, errors})` consuming the above outputs.

Files that change together stay together. Domain modules are independent of OAuth/HTTP plumbing.

---

## Task 1: Project Scaffold

**Files:**
- Create: `weather-tts-api/.gitignore`
- Create: `weather-tts-api/package.json`
- Create: `weather-tts-api/wrangler.toml.example`

- [ ] **Step 1: Create `weather-tts-api/.gitignore`**

```
node_modules/
wrangler.toml
.wrangler/
```

- [ ] **Step 2: Create `weather-tts-api/package.json`**

```json
{
  "name": "weather-tts-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Weather + air quality TTS — API_ONLY (OAuth-In) Cloudflare Workers app.",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node --test 'test/*.test.js'",
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  }
}
```

- [ ] **Step 3: Create `weather-tts-api/wrangler.toml.example`**

```toml
# wrangler.toml template. Real wrangler.toml is gitignored.
# Local dev: cp wrangler.toml.example wrangler.toml, replace <KV_NAMESPACE_ID> with the id printed by
# `wrangler kv namespace create ST_TOKENS`. CI generates wrangler.toml dynamically from secrets.
name = "weather-tts-smartapp"
main = "src/worker.js"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "ST_TOKENS"
id = "<KV_NAMESPACE_ID>"
```

- [ ] **Step 4: Install dependencies (none yet, but lock-file)**

Run: `cd weather-tts-api && npm install`
Expected: creates empty `package-lock.json`. No prod deps.

- [ ] **Step 5: Commit**

```bash
git add weather-tts-api/.gitignore weather-tts-api/package.json weather-tts-api/package-lock.json weather-tts-api/wrangler.toml.example
git commit -m "chore(weather-tts-api): scaffold project"
```

---

## Task 2: `outfit.js` — Outfit Rules (TDD)

**Files:**
- Create: `weather-tts-api/src/outfit.js`
- Create: `weather-tts-api/test/outfit.test.js`

- [ ] **Step 1: Write failing tests for `recommendOutfit(tmx)`**

`weather-tts-api/test/outfit.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendOutfit, buildAddenda } from '../src/outfit.js';

test('recommendOutfit: ≥ 28°C → 반팔과 반바지', () => {
  assert.equal(recommendOutfit(28), '반팔과 반바지, 린넨 소재');
  assert.equal(recommendOutfit(35), '반팔과 반바지, 린넨 소재');
});

test('recommendOutfit: 23~27°C → 반팔이나 얇은 셔츠', () => {
  assert.equal(recommendOutfit(27), '반팔이나 얇은 셔츠');
  assert.equal(recommendOutfit(23), '반팔이나 얇은 셔츠');
});

test('recommendOutfit: 20~22°C → 얇은 긴팔이나 가디건', () => {
  assert.equal(recommendOutfit(22), '얇은 긴팔이나 가디건');
  assert.equal(recommendOutfit(20), '얇은 긴팔이나 가디건');
});

test('recommendOutfit: 17~19°C → 맨투맨이나 얇은 니트', () => {
  assert.equal(recommendOutfit(19), '맨투맨이나 얇은 니트');
  assert.equal(recommendOutfit(17), '맨투맨이나 얇은 니트');
});

test('recommendOutfit: 12~16°C → 자켓이나 트렌치코트', () => {
  assert.equal(recommendOutfit(16), '자켓이나 트렌치코트');
  assert.equal(recommendOutfit(12), '자켓이나 트렌치코트');
});

test('recommendOutfit: 9~11°C → 야상이나 바람막이', () => {
  assert.equal(recommendOutfit(11), '야상이나 바람막이');
  assert.equal(recommendOutfit(9), '야상이나 바람막이');
});

test('recommendOutfit: 5~8°C → 코트나 두꺼운 니트', () => {
  assert.equal(recommendOutfit(8), '코트나 두꺼운 니트');
  assert.equal(recommendOutfit(5), '코트나 두꺼운 니트');
});

test('recommendOutfit: < 5°C → 패딩에 목도리와 장갑', () => {
  assert.equal(recommendOutfit(4), '패딩에 목도리와 장갑까지');
  assert.equal(recommendOutfit(-10), '패딩에 목도리와 장갑까지');
});

test('buildAddenda: nothing flagged → empty array', () => {
  assert.deepEqual(buildAddenda({ hasPrecip: false, badAir: false }), []);
});

test('buildAddenda: only precip', () => {
  assert.deepEqual(buildAddenda({ hasPrecip: true, badAir: false }),
    ['우산 꼭 챙기시기 바랍니다']);
});

test('buildAddenda: only bad air', () => {
  assert.deepEqual(buildAddenda({ hasPrecip: false, badAir: true }),
    ['외출 시 마스크 착용 권장드립니다']);
});

test('buildAddenda: both', () => {
  assert.deepEqual(buildAddenda({ hasPrecip: true, badAir: true }),
    ['우산 꼭 챙기시기 바랍니다', '외출 시 마스크 착용 권장드립니다']);
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd weather-tts-api && npm test`
Expected: FAIL — `outfit.js` does not exist.

- [ ] **Step 3: Implement `outfit.js`**

`weather-tts-api/src/outfit.js`:

```javascript
function recommendOutfit(tmx) {
  if (tmx >= 28) return '반팔과 반바지, 린넨 소재';
  if (tmx >= 23) return '반팔이나 얇은 셔츠';
  if (tmx >= 20) return '얇은 긴팔이나 가디건';
  if (tmx >= 17) return '맨투맨이나 얇은 니트';
  if (tmx >= 12) return '자켓이나 트렌치코트';
  if (tmx >= 9)  return '야상이나 바람막이';
  if (tmx >= 5)  return '코트나 두꺼운 니트';
  return '패딩에 목도리와 장갑까지';
}

function buildAddenda({ hasPrecip, badAir }) {
  const out = [];
  if (hasPrecip) out.push('우산 꼭 챙기시기 바랍니다');
  if (badAir) out.push('외출 시 마스크 착용 권장드립니다');
  return out;
}

export { recommendOutfit, buildAddenda };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd weather-tts-api && npm test`
Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git add weather-tts-api/src/outfit.js weather-tts-api/test/outfit.test.js
git commit -m "feat(weather-tts-api): add outfit recommendation rules"
```

---

## Task 3: `airquality.js` — WHO Grade Mapping + Fetch (TDD)

**Files:**
- Create: `weather-tts-api/src/airquality.js`
- Create: `weather-tts-api/test/airquality.test.js`

- [ ] **Step 1: Write failing tests for grade mapping**

`weather-tts-api/test/airquality.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gradePm10, gradePm25, fetchAirQuality, mapAirError,
} from '../src/airquality.js';

test('gradePm10 WHO boundaries (24h)', () => {
  assert.equal(gradePm10(0),  '좋음');
  assert.equal(gradePm10(45), '좋음');
  assert.equal(gradePm10(46), '보통');
  assert.equal(gradePm10(75), '보통');
  assert.equal(gradePm10(76), '나쁨');
  assert.equal(gradePm10(300), '나쁨');
});

test('gradePm25 WHO boundaries (24h)', () => {
  assert.equal(gradePm25(0),  '좋음');
  assert.equal(gradePm25(15), '좋음');
  assert.equal(gradePm25(16), '보통');
  assert.equal(gradePm25(25), '보통');
  assert.equal(gradePm25(26), '나쁨');
  assert.equal(gradePm25(150), '나쁨');
});

test('mapAirError known codes', () => {
  assert.equal(mapAirError({ code: 'NO_ITEM' }), '미세먼지 측정 데이터가 없습니다.');
});

test('mapAirError fallback', () => {
  assert.equal(mapAirError({ code: 'NETWORK' }), '미세먼지 정보 조회에 실패했습니다.');
  assert.equal(mapAirError({ code: 'HTTP_STATUS' }), '미세먼지 정보 조회에 실패했습니다.');
  assert.equal(mapAirError({ code: 'JSON_PARSE' }), '미세먼지 정보 조회에 실패했습니다.');
  assert.equal(mapAirError({}), '미세먼지 정보 조회에 실패했습니다.');
});

function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

test('fetchAirQuality: returns first item PM10/PM2.5 numbers on success', async () => {
  const sample = {
    response: {
      body: {
        items: [
          { pm10Value: '32', pm25Value: '18', dataTime: '2026-05-21 12:00' },
        ],
      },
    },
  };
  await withMockedFetch(
    async (url) => {
      assert.match(url, /ArpltnInforInqireSvc\/getMsrstnAcctoRltmMesureDnsty/);
      assert.match(url, /serviceKey=KEY/);
      assert.match(url, /stationName=%EA%B0%95%EB%82%A8%EA%B5%AC/); // "강남구"
      assert.match(url, /returnType=json/);
      return { ok: true, status: 200, json: async () => sample };
    },
    async () => {
      const out = await fetchAirQuality('KEY', '강남구');
      assert.deepEqual(out, { pm10: 32, pm25: 18 });
    }
  );
});

test('fetchAirQuality: non-numeric values become null', async () => {
  const sample = {
    response: { body: { items: [{ pm10Value: '-', pm25Value: '' }] } },
  };
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => sample }),
    async () => {
      const out = await fetchAirQuality('K', 'S');
      assert.deepEqual(out, { pm10: null, pm25: null });
    }
  );
});

test('fetchAirQuality: NETWORK on fetch reject', async () => {
  await withMockedFetch(
    async () => { throw new Error('boom'); },
    async () => {
      await assert.rejects(() => fetchAirQuality('K', 'S'), (e) => e.code === 'NETWORK');
    }
  );
});

test('fetchAirQuality: HTTP_STATUS on non-2xx', async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      await assert.rejects(() => fetchAirQuality('K', 'S'), (e) => e.code === 'HTTP_STATUS');
    }
  );
});

test('fetchAirQuality: JSON_PARSE when body is not valid JSON', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
    async () => {
      await assert.rejects(() => fetchAirQuality('K', 'S'), (e) => e.code === 'JSON_PARSE');
    }
  );
});

test('fetchAirQuality: NO_ITEM when items missing or empty', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ response: { body: { items: [] } } }) }),
    async () => {
      await assert.rejects(() => fetchAirQuality('K', 'S'), (e) => e.code === 'NO_ITEM');
    }
  );
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
    async () => {
      await assert.rejects(() => fetchAirQuality('K', 'S'), (e) => e.code === 'NO_ITEM');
    }
  );
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd weather-tts-api && npm test`
Expected: FAIL — `airquality.js` does not exist.

- [ ] **Step 3: Implement `airquality.js`**

`weather-tts-api/src/airquality.js`:

```javascript
function gradePm10(v) {
  if (v <= 45) return '좋음';
  if (v <= 75) return '보통';
  return '나쁨';
}

function gradePm25(v) {
  if (v <= 15) return '좋음';
  if (v <= 25) return '보통';
  return '나쁨';
}

function toNumberOrNull(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchAirQuality(apiKey, stationName, fetchFn) {
  const _fetch = fetchFn || fetch;
  const url = 'http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty'
    + `?serviceKey=${encodeURIComponent(apiKey)}`
    + `&stationName=${encodeURIComponent(stationName)}`
    + '&dataTerm=DAILY'
    + '&pageNo=1'
    + '&numOfRows=1'
    + '&returnType=json'
    + '&ver=1.3';
  let resp;
  try {
    resp = await _fetch(url);
  } catch (e) {
    const err = new Error('fetch failed'); err.code = 'NETWORK'; throw err;
  }
  if (!resp.ok) {
    const err = new Error(`status ${resp.status}`); err.code = 'HTTP_STATUS'; throw err;
  }
  let data;
  try { data = await resp.json(); }
  catch (e) {
    const err = new Error('json parse'); err.code = 'JSON_PARSE'; throw err;
  }
  const items = data && data.response && data.response.body && data.response.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('no items'); err.code = 'NO_ITEM'; throw err;
  }
  const it = items[0];
  return {
    pm10: toNumberOrNull(it.pm10Value),
    pm25: toNumberOrNull(it.pm25Value),
  };
}

function mapAirError(err) {
  switch (err && err.code) {
    case 'NO_ITEM': return '미세먼지 측정 데이터가 없습니다.';
    default:        return '미세먼지 정보 조회에 실패했습니다.';
  }
}

export { gradePm10, gradePm25, fetchAirQuality, mapAirError };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd weather-tts-api && npm test`
Expected: tests for outfit + airquality all passing.

- [ ] **Step 5: Commit**

```bash
git add weather-tts-api/src/airquality.js weather-tts-api/test/airquality.test.js
git commit -m "feat(weather-tts-api): add air quality fetch + WHO grade mapping"
```

---

## Task 4: `weather.js` — KMA API + base date/time + Slot Extraction (TDD)

**Files:**
- Create: `weather-tts-api/src/weather.js`
- Create: `weather-tts-api/test/weather.test.js`

- [ ] **Step 1: Write failing tests**

`weather-tts-api/test/weather.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBaseDateTimeNcst, getBaseDateTimeFcst, mapPty,
  extractNcstSlots, extractFcstSlots,
  fetchUltraSrtNcst, fetchVilageFcst, mapWeatherError,
} from '../src/weather.js';

// ─── base_date / base_time ────────────────────────────────────────────────

test('getBaseDateTimeNcst: before HH:40 returns previous hour (KMA publishes ~40min after hour)', () => {
  // KST 2026-05-21 12:39 → use 11:00
  const d = new Date('2026-05-21T03:39:00Z'); // 12:39 KST
  assert.deepEqual(getBaseDateTimeNcst(d), { base_date: '20260521', base_time: '1100' });
});

test('getBaseDateTimeNcst: at or after HH:40 returns this hour', () => {
  // KST 2026-05-21 12:40 → use 12:00
  const d = new Date('2026-05-21T03:40:00Z');
  assert.deepEqual(getBaseDateTimeNcst(d), { base_date: '20260521', base_time: '1200' });
});

test('getBaseDateTimeNcst: midnight rollover when 00:39 KST', () => {
  // KST 2026-05-21 00:39 → use previous day 23:00
  const d = new Date('2026-05-20T15:39:00Z');
  assert.deepEqual(getBaseDateTimeNcst(d), { base_date: '20260520', base_time: '2300' });
});

test('getBaseDateTimeFcst: returns the most recent of [02,05,08,11,14,17,20,23] with +10min delay', () => {
  // KST 11:09 → still 08:00 slot (11:00 not yet usable)
  let d = new Date('2026-05-21T02:09:00Z');
  assert.deepEqual(getBaseDateTimeFcst(d), { base_date: '20260521', base_time: '0800' });

  // KST 11:10 → 11:00 slot
  d = new Date('2026-05-21T02:10:00Z');
  assert.deepEqual(getBaseDateTimeFcst(d), { base_date: '20260521', base_time: '1100' });

  // KST 14:00 → 11:00 (14:00 not yet +10min)
  d = new Date('2026-05-21T05:00:00Z');
  assert.deepEqual(getBaseDateTimeFcst(d), { base_date: '20260521', base_time: '1100' });

  // KST 14:11 → 14:00
  d = new Date('2026-05-21T05:11:00Z');
  assert.deepEqual(getBaseDateTimeFcst(d), { base_date: '20260521', base_time: '1400' });
});

test('getBaseDateTimeFcst: pre-02:10 KST rolls to previous day 23:00', () => {
  // KST 01:00 → previous day 23:00
  const d = new Date('2026-05-20T16:00:00Z');
  assert.deepEqual(getBaseDateTimeFcst(d), { base_date: '20260520', base_time: '2300' });
});

// ─── PTY mapping ──────────────────────────────────────────────────────────

test('mapPty: known codes', () => {
  assert.equal(mapPty(0), null);
  assert.equal(mapPty(1), '비');
  assert.equal(mapPty(2), '비와 눈');
  assert.equal(mapPty(3), '눈');
  assert.equal(mapPty(4), '소나기');
  assert.equal(mapPty(5), '빗방울');
  assert.equal(mapPty(6), '빗방울과 눈날림');
  assert.equal(mapPty(7), '눈날림');
});

test('mapPty: unknown / non-numeric falls back to "강수"', () => {
  assert.equal(mapPty(9), '강수');
  assert.equal(mapPty(null), null); // null in → null out (caller decides)
});

// ─── slot extraction ──────────────────────────────────────────────────────

test('extractNcstSlots: pulls T1H and PTY', () => {
  const items = [
    { category: 'T1H', obsrValue: '12.3' },
    { category: 'PTY', obsrValue: '1' },
    { category: 'REH', obsrValue: '60' },
  ];
  assert.deepEqual(extractNcstSlots(items), { t1h: 12.3, pty: 1 });
});

test('extractNcstSlots: missing categories → null', () => {
  assert.deepEqual(extractNcstSlots([]), { t1h: null, pty: null });
});

test('extractFcstSlots: pulls TMX/TMN/POP for today (earliest fcstDate)', () => {
  const items = [
    { category: 'TMX', fcstDate: '20260521', fcstTime: '1500', fcstValue: '18.0' },
    { category: 'TMN', fcstDate: '20260521', fcstTime: '0600', fcstValue: '8.0' },
    { category: 'POP', fcstDate: '20260521', fcstTime: '1200', fcstValue: '70' },
    { category: 'POP', fcstDate: '20260521', fcstTime: '1500', fcstValue: '40' },
    { category: 'TMX', fcstDate: '20260522', fcstTime: '1500', fcstValue: '20.0' }, // tomorrow — ignored
  ];
  const today = '20260521';
  const out = extractFcstSlots(items, today);
  assert.equal(out.tmx, 18);
  assert.equal(out.tmn, 8);
  // POP = max over today's slots
  assert.equal(out.pop, 70);
});

test('extractFcstSlots: missing fields → null', () => {
  assert.deepEqual(extractFcstSlots([], '20260521'), { tmx: null, tmn: null, pop: null });
});

// ─── error mapping ────────────────────────────────────────────────────────

test('mapWeatherError known codes', () => {
  assert.equal(mapWeatherError({ code: 'NO_ITEM' }), '현재 날씨 정보가 제공되지 않습니다.');
});

test('mapWeatherError fallback', () => {
  assert.equal(mapWeatherError({ code: 'NETWORK' }), '날씨 정보 조회에 실패했습니다.');
  assert.equal(mapWeatherError({}), '날씨 정보 조회에 실패했습니다.');
});

// ─── fetchers ─────────────────────────────────────────────────────────────

function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

test('fetchUltraSrtNcst returns items on success', async () => {
  const items = [{ category: 'T1H', obsrValue: '12' }];
  await withMockedFetch(
    async (url) => {
      assert.match(url, /VilageFcstInfoService_2\.0\/getUltraSrtNcst/);
      assert.match(url, /ServiceKey=K/);
      assert.match(url, /nx=55/);
      assert.match(url, /ny=127/);
      assert.match(url, /base_date=20260521/);
      assert.match(url, /base_time=1100/);
      assert.match(url, /dataType=JSON/);
      return { ok: true, status: 200, json: async () => ({ response: { body: { items } } }) };
    },
    async () => {
      const out = await fetchUltraSrtNcst('K', 55, 127, { base_date: '20260521', base_time: '1100' });
      assert.deepEqual(out, items);
    }
  );
});

test('fetchVilageFcst returns items on success', async () => {
  const items = [{ category: 'TMX', fcstDate: '20260521', fcstTime: '1500', fcstValue: '18' }];
  await withMockedFetch(
    async (url) => {
      assert.match(url, /VilageFcstInfoService_2\.0\/getVilageFcst/);
      assert.match(url, /numOfRows=1000/);
      return { ok: true, status: 200, json: async () => ({ response: { body: { items } } }) };
    },
    async () => {
      const out = await fetchVilageFcst('K', 55, 127, { base_date: '20260521', base_time: '0800' });
      assert.deepEqual(out, items);
    }
  );
});

test('fetchUltraSrtNcst error mapping', async () => {
  await withMockedFetch(async () => { throw new Error(); }, async () => {
    await assert.rejects(() => fetchUltraSrtNcst('K', 1, 1, { base_date: 'd', base_time: 't' }),
      (e) => e.code === 'NETWORK');
  });
  await withMockedFetch(async () => ({ ok: false, status: 500 }), async () => {
    await assert.rejects(() => fetchUltraSrtNcst('K', 1, 1, { base_date: 'd', base_time: 't' }),
      (e) => e.code === 'HTTP_STATUS');
  });
  await withMockedFetch(async () => ({ ok: true, json: async () => { throw new Error(); } }), async () => {
    await assert.rejects(() => fetchUltraSrtNcst('K', 1, 1, { base_date: 'd', base_time: 't' }),
      (e) => e.code === 'JSON_PARSE');
  });
  await withMockedFetch(async () => ({ ok: true, json: async () => ({}) }), async () => {
    await assert.rejects(() => fetchUltraSrtNcst('K', 1, 1, { base_date: 'd', base_time: 't' }),
      (e) => e.code === 'NO_ITEM');
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd weather-tts-api && npm test`
Expected: FAIL — `weather.js` not found.

- [ ] **Step 3: Implement `weather.js`**

`weather-tts-api/src/weather.js`:

```javascript
const KST_OFFSET_MIN = 9 * 60;
const FCST_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

function toKst(d) {
  return new Date(d.getTime() + KST_OFFSET_MIN * 60_000);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`; }

function getBaseDateTimeNcst(now = new Date()) {
  const k = toKst(now);
  let h = k.getUTCHours();
  if (k.getUTCMinutes() < 40) {
    h -= 1;
    if (h < 0) {
      const prev = new Date(k.getTime() - 24 * 60 * 60_000);
      return { base_date: ymd(prev), base_time: '2300' };
    }
  }
  return { base_date: ymd(k), base_time: `${pad2(h)}00` };
}

function getBaseDateTimeFcst(now = new Date()) {
  const k = toKst(now);
  const totalMin = k.getUTCHours() * 60 + k.getUTCMinutes();
  let best = null;
  for (const h of FCST_HOURS) {
    if (h * 60 + 10 <= totalMin) best = h;
  }
  if (best === null) {
    const prev = new Date(k.getTime() - 24 * 60 * 60_000);
    return { base_date: ymd(prev), base_time: '2300' };
  }
  return { base_date: ymd(k), base_time: `${pad2(best)}00` };
}

function todayYmdKst(now = new Date()) {
  return ymd(toKst(now));
}

function mapPty(code) {
  if (code === null || code === undefined) return null;
  const n = Number(code);
  if (n === 0) return null;
  switch (n) {
    case 1: return '비';
    case 2: return '비와 눈';
    case 3: return '눈';
    case 4: return '소나기';
    case 5: return '빗방울';
    case 6: return '빗방울과 눈날림';
    case 7: return '눈날림';
    default: return '강수';
  }
}

function toNumberOrNull(s) {
  if (s === undefined || s === null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function extractNcstSlots(items) {
  const by = {};
  for (const it of items || []) by[it.category] = it.obsrValue;
  return {
    t1h: toNumberOrNull(by.T1H),
    pty: toNumberOrNull(by.PTY),
  };
}

function extractFcstSlots(items, todayYmd) {
  let tmx = null, tmn = null, popMax = null;
  for (const it of items || []) {
    if (it.fcstDate !== todayYmd) continue;
    const v = toNumberOrNull(it.fcstValue);
    if (v === null) continue;
    if (it.category === 'TMX' && tmx === null) tmx = v;
    if (it.category === 'TMN' && tmn === null) tmn = v;
    if (it.category === 'POP') popMax = popMax === null ? v : Math.max(popMax, v);
  }
  return { tmx, tmn, pop: popMax };
}

function buildKmaUrl(endpoint, apiKey, nx, ny, { base_date, base_time }) {
  return 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/' + endpoint
    + `?ServiceKey=${encodeURIComponent(apiKey)}`
    + `&pageNo=1&numOfRows=1000&dataType=JSON`
    + `&base_date=${base_date}&base_time=${base_time}`
    + `&nx=${nx}&ny=${ny}`;
}

async function fetchKma(url, fetchFn) {
  const _fetch = fetchFn || fetch;
  let resp;
  try { resp = await _fetch(url); }
  catch (e) { const err = new Error('fetch failed'); err.code = 'NETWORK'; throw err; }
  if (!resp.ok) { const err = new Error(`status ${resp.status}`); err.code = 'HTTP_STATUS'; throw err; }
  let data;
  try { data = await resp.json(); }
  catch (e) { const err = new Error('json parse'); err.code = 'JSON_PARSE'; throw err; }
  const items = data && data.response && data.response.body && data.response.body.items
    && data.response.body.items.item;
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('no items'); err.code = 'NO_ITEM'; throw err;
  }
  return items;
}

async function fetchUltraSrtNcst(apiKey, nx, ny, base, fetchFn) {
  return fetchKma(buildKmaUrl('getUltraSrtNcst', apiKey, nx, ny, base), fetchFn);
}

async function fetchVilageFcst(apiKey, nx, ny, base, fetchFn) {
  return fetchKma(buildKmaUrl('getVilageFcst', apiKey, nx, ny, base), fetchFn);
}

function mapWeatherError(err) {
  switch (err && err.code) {
    case 'NO_ITEM': return '현재 날씨 정보가 제공되지 않습니다.';
    default:        return '날씨 정보 조회에 실패했습니다.';
  }
}

export {
  getBaseDateTimeNcst, getBaseDateTimeFcst, todayYmdKst,
  mapPty, extractNcstSlots, extractFcstSlots,
  fetchUltraSrtNcst, fetchVilageFcst, mapWeatherError,
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd weather-tts-api && npm test`
Expected: all weather tests pass. (Note: the test mock returns `items` directly as an array; the implementation expects `data.response.body.items.item`. Update the test mock to match KMA's actual nested structure.)

- [ ] **Step 5: Fix test mock shape**

The tests in Step 1 mock `{ response: { body: { items: [...] } } }` but KMA actually returns `{ response: { body: { items: { item: [...] } } } }`. Update `fetchUltraSrtNcst returns items on success` and `fetchVilageFcst returns items on success` tests to use the nested `item` array:

In `weather.test.js`, change both mocked successful responses:

```javascript
json: async () => ({ response: { body: { items: { item: items } } } }),
```

And in the `NO_ITEM` test:

```javascript
async () => ({ ok: true, json: async () => ({ response: { body: { items: { item: [] } } } }) })
```

(Also update the empty-body case `async () => ({})` is already covered.)

- [ ] **Step 6: Run tests, verify pass**

Run: `cd weather-tts-api && npm test`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add weather-tts-api/src/weather.js weather-tts-api/test/weather.test.js
git commit -m "feat(weather-tts-api): add KMA fetch + slot extraction"
```

---

## Task 5: `compose.js` — Message Composer (TDD)

**Files:**
- Create: `weather-tts-api/src/compose.js`
- Create: `weather-tts-api/test/compose.test.js`

- [ ] **Step 1: Write failing tests**

`weather-tts-api/test/compose.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAnnouncement } from '../src/compose.js';

test('full happy path: all slots present, rain forecast, normal air', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 12, tmx: 16, tmn: 8, pty: 0, pop: 70 },
    air:     { pm10: 30, pm25: 18 },
    errors:  {},
  });
  assert.equal(
    msg,
    '안녕하세요, 오늘의 날씨를 전해드리겠습니다. ' +
    '현재 기온은 12도입니다. ' +
    '낮 최고기온은 16도, 아침 최저기온은 8도가 되겠습니다. ' +
    '오늘 비 올 확률은 70퍼센트로, 우산이 필요하겠습니다. ' +
    '미세먼지는 좋음, 초미세먼지는 보통으로 예상됩니다. ' +
    '오늘은 자켓이나 트렌치코트 추천드립니다. 우산 꼭 챙기시기 바랍니다. ' +
    '오늘도 좋은 하루 보내세요.'
  );
});

test('currently raining (PTY=1) overrides POP wording', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 12, tmx: 16, tmn: 7, pty: 1, pop: 80 },
    air:     { pm10: 30, pm25: 18 },
    errors:  {},
  });
  assert.match(msg, /지금 비가 내리고 있습니다/);
  assert.doesNotMatch(msg, /비 올 확률/);
  assert.match(msg, /우산 꼭 챙기시기 바랍니다/);
});

test('low POP and no current rain → skip precip slot, no umbrella addendum', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 22, tmx: 25, tmn: 15, pty: 0, pop: 20 },
    air:     { pm10: 30, pm25: 18 },
    errors:  {},
  });
  assert.doesNotMatch(msg, /비 올 확률/);
  assert.doesNotMatch(msg, /지금/);
  assert.doesNotMatch(msg, /우산/);
});

test('bad PM2.5 → mask addendum, grade word "나쁨"', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 22, tmx: 25, tmn: 15, pty: 0, pop: 20 },
    air:     { pm10: 30, pm25: 40 },
    errors:  {},
  });
  assert.match(msg, /초미세먼지는 나쁨/);
  assert.match(msg, /외출 시 마스크 착용 권장드립니다/);
});

test('TMX missing → skip outfit slot + skip addenda', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 12, tmx: null, tmn: 8, pty: 0, pop: 70 },
    air:     { pm10: 30, pm25: 40 },
    errors:  {},
  });
  assert.doesNotMatch(msg, /추천드립니다/);
  assert.doesNotMatch(msg, /우산 꼭/);
  assert.doesNotMatch(msg, /마스크 착용/);
  // [오늘] slot with only TMN available
  assert.match(msg, /아침 최저기온은 8도/);
  assert.doesNotMatch(msg, /낮 최고기온/);
});

test('air error appended at end when air data missing', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 12, tmx: 18, tmn: 8, pty: 0, pop: 70 },
    air:     null,
    errors:  { air: '미세먼지 정보 조회에 실패했습니다.' },
  });
  assert.doesNotMatch(msg, /미세먼지는/);
  assert.match(msg, /미세먼지 정보 조회에 실패했습니다/);
});

test('weather error: only air available', () => {
  const msg = composeAnnouncement({
    weather: null,
    air:     { pm10: 30, pm25: 18 },
    errors:  { weather: '날씨 정보 조회에 실패했습니다.' },
  });
  assert.match(msg, /미세먼지는 좋음, 초미세먼지는 보통/);
  assert.match(msg, /날씨 정보 조회에 실패했습니다/);
  assert.doesNotMatch(msg, /추천드립니다/);
});

test('all sources failed', () => {
  const msg = composeAnnouncement({
    weather: null,
    air:     null,
    errors:  { weather: 'x', air: 'y' },
  });
  assert.equal(msg, '오늘 날씨 정보를 가져올 수 없습니다.');
});

test('temperatures rounded to nearest integer for speech', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 12.7, tmx: 18.3, tmn: 7.5, pty: 0, pop: 30 },
    air:     { pm10: 30, pm25: 18 },
    errors:  {},
  });
  assert.match(msg, /현재 기온은 13도/);
  assert.match(msg, /낮 최고기온은 18도/);
  assert.match(msg, /아침 최저기온은 8도/);
});

test('air with only PM10', () => {
  const msg = composeAnnouncement({
    weather: { t1h: 12, tmx: 18, tmn: 8, pty: 0, pop: 30 },
    air:     { pm10: 30, pm25: null },
    errors:  {},
  });
  assert.match(msg, /미세먼지는 좋음으로 예상됩니다/);
  assert.doesNotMatch(msg, /초미세먼지/);
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd weather-tts-api && npm test`
Expected: FAIL — `compose.js` not found.

- [ ] **Step 3: Implement `compose.js`**

`weather-tts-api/src/compose.js`:

```javascript
import { mapPty } from './weather.js';
import { gradePm10, gradePm25 } from './airquality.js';
import { recommendOutfit, buildAddenda } from './outfit.js';

function round(n) { return Math.round(n); }

function precipSentence({ pty, pop }) {
  const ptyWord = mapPty(pty);
  if (ptyWord) return `지금 ${ptyWord}가 내리고 있습니다`;
  if (pop !== null && pop !== undefined && pop >= 60) {
    return `오늘 비 올 확률은 ${round(pop)}퍼센트로, 우산이 필요하겠습니다`;
  }
  return null;
}

function todaySentence({ tmx, tmn }) {
  const has = (v) => v !== null && v !== undefined;
  if (has(tmx) && has(tmn)) {
    return `낮 최고기온은 ${round(tmx)}도, 아침 최저기온은 ${round(tmn)}도가 되겠습니다`;
  }
  if (has(tmx)) return `낮 최고기온은 ${round(tmx)}도가 되겠습니다`;
  if (has(tmn)) return `아침 최저기온은 ${round(tmn)}도가 되겠습니다`;
  return null;
}

function airSentence(air) {
  if (!air) return null;
  const parts = [];
  if (air.pm10 !== null && air.pm10 !== undefined) parts.push(`미세먼지는 ${gradePm10(air.pm10)}`);
  if (air.pm25 !== null && air.pm25 !== undefined) parts.push(`초미세먼지는 ${gradePm25(air.pm25)}`);
  if (parts.length === 0) return null;
  return `${parts.join(', ')}으로 예상됩니다`;
}

function composeAnnouncement({ weather, air, errors }) {
  const w = weather || {};
  const a = air || null;
  const errs = errors || {};

  const slots = [];

  // [현재]
  if (w.t1h !== null && w.t1h !== undefined) {
    slots.push(`현재 기온은 ${round(w.t1h)}도입니다`);
  }

  // [오늘]
  const today = todaySentence(w);
  if (today) slots.push(today);

  // [강수]
  const precip = precipSentence(w);
  if (precip) slots.push(precip);

  // [먼지]
  const airS = airSentence(a);
  if (airS) slots.push(airS);

  // [옷차림] (TMX required)
  let outfitSentence = null;
  if (w.tmx !== null && w.tmx !== undefined) {
    const badAir = a && (
      (a.pm10 !== null && gradePm10(a.pm10) === '나쁨') ||
      (a.pm25 !== null && gradePm25(a.pm25) === '나쁨')
    );
    const addenda = buildAddenda({ hasPrecip: precip !== null, badAir: !!badAir });
    const tail = addenda.length ? ` ${addenda.map(s => s + '.').join(' ')}` : '';
    outfitSentence = `오늘은 ${recommendOutfit(w.tmx)} 추천드립니다.${tail}`;
  }

  // hard failure
  if (slots.length === 0 && !outfitSentence) {
    return '오늘 날씨 정보를 가져올 수 없습니다.';
  }

  const head = '안녕하세요, 오늘의 날씨를 전해드리겠습니다.';
  const body = slots.map(s => s + '.').join(' ');
  const outfit = outfitSentence ? ' ' + outfitSentence : '';
  const tail = ' 오늘도 좋은 하루 보내세요.';

  const errLines = [];
  if (errs.weather && !weather) errLines.push(errs.weather);
  if (errs.air && !air) errLines.push(errs.air);
  const errTail = errLines.length ? ' ' + errLines.join(' ') : '';

  return `${head} ${body}${outfit}${errTail}${tail}`;
}

export { composeAnnouncement };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd weather-tts-api && npm test`
Expected: all 10 compose tests + earlier tests pass.

Note: If a test like `temperatures rounded` fails because rounding `7.5` produces `8` (banker's rounding caveat), JavaScript's `Math.round(7.5) === 8` so this is fine.

- [ ] **Step 5: Commit**

```bash
git add weather-tts-api/src/compose.js weather-tts-api/test/compose.test.js
git commit -m "feat(weather-tts-api): add announcement composer"
```

---

## Task 6: Copy Shared Modules from `bus-tts-api`

Spec mandates verbatim copy of `oauth.js`, `storage.js`, `subscription.js`, `smartthings.js`. They are already covered by bus-tts-api's tests; no new tests in this project.

**Files:**
- Create: `weather-tts-api/src/oauth.js`
- Create: `weather-tts-api/src/storage.js`
- Create: `weather-tts-api/src/subscription.js`
- Create: `weather-tts-api/src/smartthings.js`

- [ ] **Step 1: Copy files**

Run:

```bash
cp bus-tts-api/src/oauth.js       weather-tts-api/src/oauth.js
cp bus-tts-api/src/storage.js     weather-tts-api/src/storage.js
cp bus-tts-api/src/subscription.js weather-tts-api/src/subscription.js
cp bus-tts-api/src/smartthings.js weather-tts-api/src/smartthings.js
```

- [ ] **Step 2: Sanity diff**

Run: `diff bus-tts-api/src/oauth.js weather-tts-api/src/oauth.js`
Expected: no output (identical).

Run same diff for the other three. All identical.

- [ ] **Step 3: Run tests to confirm nothing broke**

Run: `cd weather-tts-api && npm test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add weather-tts-api/src/oauth.js weather-tts-api/src/storage.js weather-tts-api/src/subscription.js weather-tts-api/src/smartthings.js
git commit -m "feat(weather-tts-api): copy oauth/storage/subscription/smartthings from bus-tts-api"
```

---

## Task 7: `smartapp.js` — Lifecycle Handler

**Files:**
- Create: `weather-tts-api/src/smartapp.js`
- Create: `weather-tts-api/test/smartapp.test.js`

This file mirrors bus-tts-api's `smartapp.js` but the EVENT handler calls KMA + AirKorea (parallel) and feeds results into `composeAnnouncement`. Test the EVENT path end-to-end with mocked fetch covering OAuth refresh + KMA + AirKorea + device commands.

- [ ] **Step 1: Write failing test (PING)**

`weather-tts-api/test/smartapp.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/smartapp.js';
import { createMemoryStorage } from '../src/storage.js';

function makeConfig() {
  return {
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUri: 'https://w.example.com/oauth/callback',
    openDataApiKey: 'KMA-KEY',
    weatherDeviceId: 'weather-dev',
    speakerDeviceId: 'speaker-dev',
    nx: '55',
    ny: '127',
    airStationName: '강남구',
  };
}

test('PING lifecycle echoes pingData', async () => {
  const handler = createHandler({
    config: makeConfig(), storage: createMemoryStorage(),
    fetch: async () => { throw new Error('should not be called'); },
    now: () => 1_700_000_000_000,
  });
  const res = await handler({
    httpMethod: 'POST', path: '/',
    body: JSON.stringify({ lifecycle: 'PING', pingData: { challenge: 'xyz' } }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { statusCode: 200, pingData: { challenge: 'xyz' } });
});
```

- [ ] **Step 2: Run, verify FAIL (no smartapp.js)**

Run: `cd weather-tts-api && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `smartapp.js`**

`weather-tts-api/src/smartapp.js`:

```javascript
import { buildAuthorizeUrl, exchangeCode, getValidAccessToken } from './oauth.js';
import { registerSubscription } from './subscription.js';
import { sendDeviceCommand } from './smartthings.js';
import {
  getBaseDateTimeNcst, getBaseDateTimeFcst, todayYmdKst,
  extractNcstSlots, extractFcstSlots,
  fetchUltraSrtNcst, fetchVilageFcst, mapWeatherError,
} from './weather.js';
import { fetchAirQuality, mapAirError } from './airquality.js';
import { composeAnnouncement } from './compose.js';

const HTML_START = '<!doctype html><meta charset="utf-8"><title>Weather TTS — 설정</title><body style="font-family:-apple-system,sans-serif;max-width:520px;margin:4rem auto;padding:0 1.5rem;line-height:1.6"><h1>Weather TTS — 1회 설정</h1><p>가상 디바이스 switch 이벤트 구독을 위해 SmartThings 계정 권한을 1회 위임합니다.</p><p><a style="display:inline-block;padding:0.6rem 1.2rem;background:#1976d2;color:#fff;text-decoration:none;border-radius:0.4rem;font-weight:600" href="/authorize">SmartThings로 인증</a></p><p style="margin-top:2rem;color:#666;font-size:0.9rem">이후 가상 디바이스 <code>날씨 TTS</code>의 switch를 켜면 동작합니다.</p></body>';

const HTML_DONE = '<!doctype html><meta charset="utf-8"><title>설정 완료</title><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 1.5rem;line-height:1.6"><h1>설정 완료</h1><p>가상 디바이스 <code>날씨 TTS</code>의 switch를 켜면 동작합니다.</p></body>';

async function gatherWeather({ config, fetch, now }) {
  const d = new Date(now());
  const today = todayYmdKst(d);
  const nx = Number(config.nx);
  const ny = Number(config.ny);
  const [ncstResult, fcstResult, airResult] = await Promise.allSettled([
    fetchUltraSrtNcst(config.openDataApiKey, nx, ny, getBaseDateTimeNcst(d), fetch),
    fetchVilageFcst(config.openDataApiKey, nx, ny, getBaseDateTimeFcst(d), fetch),
    fetchAirQuality(config.openDataApiKey, config.airStationName, fetch),
  ]);

  let weather = null;
  let weatherErr = null;
  if (ncstResult.status === 'fulfilled' || fcstResult.status === 'fulfilled') {
    const ncst = ncstResult.status === 'fulfilled' ? extractNcstSlots(ncstResult.value) : { t1h: null, pty: null };
    const fcst = fcstResult.status === 'fulfilled' ? extractFcstSlots(fcstResult.value, today) : { tmx: null, tmn: null, pop: null };
    weather = { ...ncst, ...fcst };
  } else {
    weatherErr = mapWeatherError(ncstResult.reason);
    console.error('weather fetch failed',
      { ncst: ncstResult.reason && ncstResult.reason.code, fcst: fcstResult.reason && fcstResult.reason.code });
  }

  let air = null;
  let airErr = null;
  if (airResult.status === 'fulfilled') {
    air = airResult.value;
  } else {
    airErr = mapAirError(airResult.reason);
    console.error('air fetch failed', { code: airResult.reason && airResult.reason.code });
  }

  return { weather, air, errors: { weather: weatherErr, air: airErr } };
}

function createHandler({ config, storage, fetch, now }) {
  return async function handler(event) {
    const method = event.httpMethod;
    const path = event.path || '';

    if (method === 'GET' && (path === '/' || path === '')) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: HTML_START };
    }

    if (method === 'GET' && path.endsWith('/authorize')) {
      const url = buildAuthorizeUrl({
        clientId: config.clientId, redirectUri: config.redirectUri,
        scopes: ['r:devices:*', 'x:devices:*'], state: String(now()),
      });
      return { statusCode: 302, headers: { Location: url }, body: '' };
    }

    if (method === 'GET' && path.endsWith('/oauth/callback')) {
      const code = event.queryStringParameters && event.queryStringParameters.code;
      if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'missing code' };
      const tokens = await exchangeCode({
        code, clientId: config.clientId, clientSecret: config.clientSecret,
        redirectUri: config.redirectUri, fetch, now,
      });
      await storage.save(tokens);
      try {
        await registerSubscription({
          accessToken: tokens.access_token,
          installedAppId: tokens.installed_app_id,
          deviceId: config.weatherDeviceId,
          fetch,
        });
      } catch (e) {
        console.error('subscription register failed', e && e.message);
      }
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: HTML_DONE };
    }

    if (method === 'POST') {
      const raw = event.isBase64Encoded ? atob(event.body || '') : (event.body || '');
      const body = raw ? JSON.parse(raw) : {};

      if (body.lifecycle === 'PING') {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ statusCode: 200, pingData: body.pingData }) };
      }

      if (body.lifecycle === 'CONFIRMATION' || (body.confirmationData && body.confirmationData.confirmationUrl)) {
        const url = body.confirmationData && body.confirmationData.confirmationUrl;
        if (url) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) console.error('confirmation fetch non-2xx', resp.status);
          } catch (e) {
            console.error('confirmation fetch failed', e && e.message);
          }
        }
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUrl: url }) };
      }

      if (body.lifecycle === 'EVENT' || (body.eventData && body.eventData.events)) {
        const events = (body.eventData && body.eventData.events) || [];
        const triggered = events.some(e =>
          e.eventType === 'DEVICE_EVENT' && e.deviceEvent && e.deviceEvent.value === 'on'
        );
        if (!triggered) {
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        const gathered = await gatherWeather({ config, fetch, now });
        const message = composeAnnouncement(gathered);

        let accessToken;
        try {
          accessToken = await getValidAccessToken({
            storage, clientId: config.clientId, clientSecret: config.clientSecret, fetch, now,
          });
        } catch (e) {
          console.error('access token unavailable', e && e.message);
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        const tasks = [
          sendDeviceCommand({
            accessToken, deviceId: config.weatherDeviceId,
            commands: [{ capability: 'switch', command: 'off' }], fetch,
          }),
        ];
        if (config.speakerDeviceId) {
          tasks.push(sendDeviceCommand({
            accessToken, deviceId: config.speakerDeviceId,
            commands: [{ capability: 'speechSynthesis', command: 'speak', arguments: [message] }], fetch,
          }));
        }
        const results = await Promise.allSettled(tasks);
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error('command channel failed', { idx: i, reason: r.reason && r.reason.message });
          }
        });

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
    }

    return { statusCode: 404, body: 'not found' };
  };
}

export { createHandler };
```

- [ ] **Step 4: Run PING test, verify PASS**

Run: `cd weather-tts-api && npm test`
Expected: PING test passes.

- [ ] **Step 5: Add CONFIRMATION test**

Append to `weather-tts-api/test/smartapp.test.js`:

```javascript
test('CONFIRMATION fetches confirmationUrl and returns targetUrl', async () => {
  let visited = null;
  const handler = createHandler({
    config: makeConfig(), storage: createMemoryStorage(),
    fetch: async (url) => { visited = url; return { ok: true }; },
    now: () => 1_700_000_000_000,
  });
  const res = await handler({
    httpMethod: 'POST', path: '/',
    body: JSON.stringify({ lifecycle: 'CONFIRMATION', confirmationData: { confirmationUrl: 'https://api.smartthings.com/confirm/abc' } }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(visited, 'https://api.smartthings.com/confirm/abc');
  assert.deepEqual(JSON.parse(res.body), { targetUrl: 'https://api.smartthings.com/confirm/abc' });
});
```

- [ ] **Step 6: Run, verify PASS**

Run: `cd weather-tts-api && npm test`

- [ ] **Step 7: Add EVENT happy-path test (full integration)**

Append to `weather-tts-api/test/smartapp.test.js`:

```javascript
function makeKmaNcstResp() {
  return { ok: true, json: async () => ({ response: { body: { items: { item: [
    { category: 'T1H', obsrValue: '12' },
    { category: 'PTY', obsrValue: '0' },
  ] } } } }) };
}
function makeKmaFcstResp(today) {
  return { ok: true, json: async () => ({ response: { body: { items: { item: [
    { category: 'TMX', fcstDate: today, fcstTime: '1500', fcstValue: '16' },
    { category: 'TMN', fcstDate: today, fcstTime: '0600', fcstValue: '8' },
    { category: 'POP', fcstDate: today, fcstTime: '1200', fcstValue: '20' },
  ] } } } }) };
}
function makeAirResp() {
  return { ok: true, json: async () => ({ response: { body: { items: [
    { pm10Value: '30', pm25Value: '18' },
  ] } } }) };
}

test('EVENT (switch=on) fetches sources, composes message, calls speak + switch off', async () => {
  const storage = createMemoryStorage();
  await storage.save({
    access_token: 'AT', refresh_token: 'RT',
    installed_app_id: 'iaid', expires_at: 2_000_000_000_000, // far future
  });

  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, method: init && init.method, body: init && init.body });
    if (url.includes('getUltraSrtNcst')) return makeKmaNcstResp();
    if (url.includes('getVilageFcst'))   return makeKmaFcstResp('20260521');
    if (url.includes('ArpltnInforInqireSvc')) return makeAirResp();
    if (url.includes('/devices/') && url.endsWith('/commands')) return { ok: true, json: async () => ({}) };
    throw new Error('unexpected fetch ' + url);
  };

  // Pin "now" to 2026-05-21 13:00 KST (= 04:00 UTC) so KMA base_time = 1200, FCST = 1100
  const now = () => Date.UTC(2026, 4, 21, 4, 0, 0);

  const handler = createHandler({
    config: makeConfig(), storage, fetch: fetchMock, now,
  });
  const res = await handler({
    httpMethod: 'POST', path: '/',
    body: JSON.stringify({
      lifecycle: 'EVENT',
      eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'on' } }] },
    }),
  });
  assert.equal(res.statusCode, 200);

  const speakCall = calls.find(c => c.url.endsWith('/devices/speaker-dev/commands'));
  assert.ok(speakCall, 'speak command must be sent');
  const speakBody = JSON.parse(speakCall.body);
  assert.equal(speakBody.commands[0].capability, 'speechSynthesis');
  assert.equal(speakBody.commands[0].command, 'speak');
  const spoken = speakBody.commands[0].arguments[0];
  assert.match(spoken, /현재 기온은 12도/);
  assert.match(spoken, /낮 최고기온은 16도/);
  assert.match(spoken, /미세먼지는 좋음/);
  assert.match(spoken, /자켓이나 트렌치코트 추천드립니다/);

  const switchOff = calls.find(c => c.url.endsWith('/devices/weather-dev/commands'));
  assert.ok(switchOff, 'switch off command must be sent');
  const offBody = JSON.parse(switchOff.body);
  assert.equal(offBody.commands[0].capability, 'switch');
  assert.equal(offBody.commands[0].command, 'off');
});

test('EVENT ignores switch=off events (guard against self-trigger)', async () => {
  const handler = createHandler({
    config: makeConfig(), storage: createMemoryStorage(),
    fetch: async () => { throw new Error('must not call'); },
    now: () => 1_700_000_000_000,
  });
  const res = await handler({
    httpMethod: 'POST', path: '/',
    body: JSON.stringify({
      lifecycle: 'EVENT',
      eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'off' } }] },
    }),
  });
  assert.equal(res.statusCode, 200);
});
```

- [ ] **Step 8: Run all tests, verify PASS**

Run: `cd weather-tts-api && npm test`
Expected: PING + CONFIRMATION + 2 EVENT tests all pass alongside earlier tests.

- [ ] **Step 9: Commit**

```bash
git add weather-tts-api/src/smartapp.js weather-tts-api/test/smartapp.test.js
git commit -m "feat(weather-tts-api): add lifecycle handler"
```

---

## Task 8: `worker.js` — Cloudflare Workers Entry

**Files:**
- Create: `weather-tts-api/src/worker.js`

- [ ] **Step 1: Create `worker.js`**

`weather-tts-api/src/worker.js`:

```javascript
import { createHandler } from './smartapp.js';
import { createKVStorage } from './storage.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const event = {
      httpMethod: request.method,
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text(),
      isBase64Encoded: false,
    };
    const config = {
      clientId: env.ST_CLIENT_ID,
      clientSecret: env.ST_CLIENT_SECRET,
      redirectUri: env.ST_REDIRECT_URI,
      openDataApiKey: env.OPEN_DATA_API_KEY,
      weatherDeviceId: env.WEATHER_DEVICE_ID,
      speakerDeviceId: env.SPEAKER_DEVICE_ID || undefined,
      nx: env.WEATHER_NX,
      ny: env.WEATHER_NY,
      airStationName: env.AIR_STATION_NAME,
    };
    const storage = createKVStorage(env.ST_TOKENS);
    const handler = createHandler({
      config, storage,
      fetch: globalThis.fetch.bind(globalThis),
      now: () => Date.now(),
    });
    const res = await handler(event);
    return new Response(res.body, {
      status: res.statusCode,
      headers: res.headers || {},
    });
  },
};
```

- [ ] **Step 2: Run all tests (still must pass)**

Run: `cd weather-tts-api && npm test`
Expected: pass. (`worker.js` itself has no test — it's covered by `smartapp.js` tests at the handler level.)

- [ ] **Step 3: Commit**

```bash
git add weather-tts-api/src/worker.js
git commit -m "feat(weather-tts-api): add Cloudflare Workers entry"
```

---

## Task 9: Device Profile + OAuth Landing Page

**Files:**
- Create: `weather-tts-api/profiles/weather-profile.yaml`
- Create: `weather-tts-api/public/index.html`

- [ ] **Step 1: Create `weather-tts-api/profiles/weather-profile.yaml`**

```yaml
name: weather-tts-v1
components:
  - id: main
    capabilities:
      - id: switch
        version: 1
    categories:
      - name: Switch
view:
  dashboard:
    states:
      - capability: switch
    actions:
      - capability: switch
  detailView:
    - capability: switch
  automation:
    conditions:
      - capability: switch
    actions:
      - capability: switch
```

- [ ] **Step 2: Create `weather-tts-api/public/index.html`**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Weather TTS — 설정</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        max-width: 520px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6;
      }
      h1 { font-size: 1.5rem; }
      .btn {
        display: inline-block; padding: 0.6rem 1.2rem; background: #1976d2; color: #fff;
        text-decoration: none; border-radius: 0.4rem; font-weight: 600;
      }
      ol li { margin-bottom: 0.4rem; }
      code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
    </style>
  </head>
  <body>
    <h1>Weather TTS — 1회 설정</h1>
    <p>가상 switch push 이벤트 구독을 위해 SmartThings 계정 권한을 1회 위임해야 합니다.</p>
    <ol>
      <li>아래 버튼을 누르면 SmartThings 로그인 페이지로 이동합니다.</li>
      <li>로그인 + 권한 동의 후 자동으로 돌아옵니다.</li>
      <li>토큰이 저장되고 가상 디바이스의 switch subscription이 등록됩니다.</li>
    </ol>
    <p><a class="btn" href="/authorize">SmartThings로 인증</a></p>
    <p style="margin-top:2rem;color:#666;font-size:0.9rem">
      이후 가상 디바이스 <code>날씨 TTS</code>의 switch를 켜면 동작합니다.
    </p>
  </body>
</html>
```

(Note: bus-tts-api inlines the HTML into `smartapp.js` and doesn't actually serve `public/index.html` from the worker. We follow the same pattern — `public/index.html` exists for documentation/reference. The inline HTML in `smartapp.js` is what users see.)

- [ ] **Step 3: Commit**

```bash
git add weather-tts-api/profiles/weather-profile.yaml weather-tts-api/public/index.html
git commit -m "feat(weather-tts-api): add device profile and OAuth landing page"
```

---

## Task 10: README

**Files:**
- Create: `weather-tts-api/README.md`

- [ ] **Step 1: Create `weather-tts-api/README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add weather-tts-api/README.md
git commit -m "docs(weather-tts-api): add README"
```

---

## Task 11: GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/deploy-weather-tts.yml`

- [ ] **Step 1: Create workflow**

`.github/workflows/deploy-weather-tts.yml`:

```yaml
name: Deploy weather-tts-api

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: weather-tts-api
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: weather-tts-api/package-lock.json

      - run: npm ci

      - run: npm test

      - name: Generate wrangler.toml from template
        run: |
          sed "s|<KV_NAMESPACE_ID>|${{ secrets.WEATHER_KV_NAMESPACE_ID }}|" wrangler.toml.example > wrangler.toml

      - name: Sync worker secrets to Cloudflare
        run: |
          cat > /tmp/secrets.json <<EOF
          {
            "ST_CLIENT_ID": ${{ toJSON(secrets.WEATHER_ST_CLIENT_ID) }},
            "ST_CLIENT_SECRET": ${{ toJSON(secrets.WEATHER_ST_CLIENT_SECRET) }},
            "ST_REDIRECT_URI": ${{ toJSON(secrets.WEATHER_ST_REDIRECT_URI) }},
            "OPEN_DATA_API_KEY": ${{ toJSON(secrets.OPEN_DATA_API_KEY) }},
            "WEATHER_DEVICE_ID": ${{ toJSON(secrets.WEATHER_DEVICE_ID) }},
            "SPEAKER_DEVICE_ID": ${{ toJSON(secrets.SPEAKER_DEVICE_ID) }},
            "WEATHER_NX": ${{ toJSON(secrets.WEATHER_NX) }},
            "WEATHER_NY": ${{ toJSON(secrets.WEATHER_NY) }},
            "AIR_STATION_NAME": ${{ toJSON(secrets.AIR_STATION_NAME) }}
          }
          EOF
          npx wrangler secret bulk /tmp/secrets.json
          rm /tmp/secrets.json

      - name: Deploy
        run: npx wrangler deploy
```

- [ ] **Step 2: Validate workflow YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-weather-tts.yml'))" && echo OK`
Expected: `OK`. (If `python3` lacks PyYAML, skip and rely on manual review.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-weather-tts.yml
git commit -m "ci: add manual deploy workflow for weather-tts-api"
```

---

## Task 12: Update Root `CLAUDE.md`

The repo overview in `CLAUDE.md` lists projects; add `weather-tts-api` and update the SmartApp anatomy section to reference both.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current `CLAUDE.md` section header**

Run: `grep -n "현재 포함된 프로젝트" CLAUDE.md`

- [ ] **Step 2: Add weather-tts-api line to project list**

Edit `CLAUDE.md`. Locate this block:

```
현재 포함된 프로젝트:

- `bus-tts-api/` — 서울시 공공데이터포털 버스 도착 정보 API를 호출해, SmartThings 가상 디바이스 switch toggle을 트리거로 갤럭시 홈 미니에서 TTS 안내를 출력. SmartThings `API_ONLY` 앱(OAuth-In) + Cloudflare Workers + KV 기반. 상세는 [`bus-tts-api/README.md`](bus-tts-api/README.md).
```

Append a new bullet immediately after:

```
- `weather-tts-api/` — 기상청 단기예보 + 에어코리아 미세먼지 API를 호출해, 가상 switch 토글 트리거로 갤럭시 홈 미니에서 기상캐스터 톤 TTS 안내를 출력. 동일한 `API_ONLY` + Cloudflare Workers + KV 패턴. 상세는 [`weather-tts-api/README.md`](weather-tts-api/README.md).
```

- [ ] **Step 3: Verify the edit**

Run: `grep -A1 "weather-tts-api/.* 기상청" CLAUDE.md`
Expected: 1 match.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): add weather-tts-api to project list"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run all tests one last time**

Run: `cd weather-tts-api && npm test`
Expected: all tests passing, exit code 0.

- [ ] **Step 2: Verify build artifacts are absent**

Run: `git status`
Expected: working tree clean (no untracked `wrangler.toml`, no stray files).

- [ ] **Step 3: Verify git log shows clean task-by-task history**

Run: `git log --oneline -20`
Expected: separate commits for scaffold, outfit, airquality, weather, compose, copied modules, smartapp, worker, profile/html, README, workflow, CLAUDE.md update.

- [ ] **Step 4: Manual review of inline HTML output**

Read `weather-tts-api/src/smartapp.js`:`HTML_START` and `HTML_DONE` and confirm the inline strings render correctly (the bus-tts-api precedent ships inline HTML; we follow the same pattern).

This concludes coding work. The user must perform 1-time SmartThings/Cloudflare/data.go.kr setup steps per `weather-tts-api/README.md` before the worker is functional in production, but those are operational and out of scope for the code plan.
