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
