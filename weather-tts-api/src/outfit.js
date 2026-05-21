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
