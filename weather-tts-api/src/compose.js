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

  // [현재 기온]
  if (w.t1h !== null && w.t1h !== undefined) {
    slots.push(`현재 기온은 ${round(w.t1h)}도입니다`);
  }

  // [오늘 최고/최저]
  const today = todaySentence(w);
  if (today) slots.push(today);

  // [강수]
  const precip = precipSentence(w);
  if (precip) slots.push(precip);

  // [미세먼지]
  const airS = airSentence(a);
  if (airS) slots.push(airS);

  // [옷차림] — TMX가 있어야 생성
  let outfitSentence = null;
  if (w.tmx !== null && w.tmx !== undefined) {
    const badAir = a && (
      (a.pm10 !== null && a.pm10 !== undefined && gradePm10(a.pm10) === '나쁨') ||
      (a.pm25 !== null && a.pm25 !== undefined && gradePm25(a.pm25) === '나쁨')
    );
    const addenda = buildAddenda({ hasPrecip: precip !== null, badAir: !!badAir });
    const tail = addenda.length ? ` ${addenda.map(s => s + '.').join(' ')}` : '';
    outfitSentence = `오늘은 ${recommendOutfit(w.tmx)} 추천드립니다.${tail}`;
  }

  // 모든 소스 실패
  if (slots.length === 0 && !outfitSentence) {
    return '오늘 날씨 정보를 가져올 수 없습니다.';
  }

  const head = '안녕하세요, 오늘의 날씨를 전해드리겠습니다.';
  const body = slots.map(s => s + '.').join(' ');
  const outfit = outfitSentence ? ' ' + outfitSentence : '';

  const errLines = [];
  if (errs.weather && !weather) errLines.push(errs.weather);
  if (errs.air && !air) errLines.push(errs.air);
  const errTail = errLines.length ? ' ' + errLines.join(' ') : '';

  const closing = ' 오늘도 좋은 하루 보내세요.';

  return `${head} ${body}${outfit}${errTail}${closing}`;
}

export { composeAnnouncement };
