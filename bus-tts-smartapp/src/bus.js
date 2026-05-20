function cleanBusMsg(raw) {
  if (!raw || raw === '' || raw.includes('운행종료')) return null;
  return raw.replace(/\[.*?\]/g, '').trim();
}

function arrivalSuffix(msg) {
  return /곧 도착|출발대기/.test(msg) ? '입니다' : ' 도착 예정입니다';
}

function buildMessage(items) {
  const parts = [];
  for (const item of items) {
    const m1 = cleanBusMsg(item.arrmsg1);
    const m2 = cleanBusMsg(item.arrmsg2);
    if (!m1) continue;
    parts.push(m2
      ? `${item.rtNm}번 버스는 먼저 ${m1}, 다음 버스는 ${m2}${arrivalSuffix(m2)}`
      : `${item.rtNm}번 버스는 ${m1}${arrivalSuffix(m1)}`);
  }
  return parts.length
    ? `현재 정류장의 버스 도착 정보입니다. ${parts.join('. ')}`
    : '현재 운행 중이거나 도착 예정인 버스가 없습니다.';
}

function mapErrorToMessage(err) {
  switch (err && err.code) {
    case 'JSON_PARSE':   return '버스 정보 응답을 처리할 수 없습니다.';
    case 'NO_ITEM_LIST': return '해당 정류장의 버스 정보가 없습니다.';
    default:             return '버스 정보 조회에 실패했습니다.';
  }
}

async function fetchSeoulBus(apiKey, arsId, fetchFn) {
  const _fetch = fetchFn || fetch;
  const url = 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid'
    + `?ServiceKey=${encodeURIComponent(apiKey)}`
    + `&arsId=${encodeURIComponent(arsId)}`
    + '&resultType=json';
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
  if (!data || !data.msgBody || !data.msgBody.itemList) {
    const err = new Error('no itemList'); err.code = 'NO_ITEM_LIST'; throw err;
  }
  return data.msgBody.itemList;
}

export { cleanBusMsg, arrivalSuffix, buildMessage, mapErrorToMessage, fetchSeoulBus };
