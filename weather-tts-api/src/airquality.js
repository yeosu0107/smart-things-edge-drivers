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
  if (s === null || s === undefined || String(s).trim() === '') return null;
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
