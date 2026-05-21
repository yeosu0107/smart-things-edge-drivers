import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanBusMsg, arrivalSuffix, buildMessage, mapErrorToMessage, fetchSeoulBus } from '../src/bus.js';

test('cleanBusMsg returns null for empty / falsy', () => {
  assert.equal(cleanBusMsg(''), null);
  assert.equal(cleanBusMsg(null), null);
  assert.equal(cleanBusMsg(undefined), null);
});

test('cleanBusMsg returns null when message contains 운행종료', () => {
  assert.equal(cleanBusMsg('운행종료'), null);
  assert.equal(cleanBusMsg('[N5번째 전]운행종료'), null);
});

test('cleanBusMsg strips bracketed annotations and trims', () => {
  assert.equal(cleanBusMsg('[3번째 전]5분 30초후'), '5분 30초후');
  assert.equal(cleanBusMsg('  곧 도착  '), '곧 도착');
});

test('arrivalSuffix uses 입니다 for 곧 도착 / 출발대기', () => {
  assert.equal(arrivalSuffix('곧 도착'), '입니다');
  assert.equal(arrivalSuffix('출발대기'), '입니다');
});

test('arrivalSuffix uses 도착 예정입니다 by default', () => {
  assert.equal(arrivalSuffix('5분 30초후'), ' 도착 예정입니다');
});

test('buildMessage returns the empty-fallback message when no items have arrmsg1', () => {
  assert.equal(
    buildMessage([]),
    '현재 운행 중이거나 도착 예정인 버스가 없습니다.'
  );
  assert.equal(
    buildMessage([{ rtNm: '472', arrmsg1: '운행종료', arrmsg2: '운행종료' }]),
    '현재 운행 중이거나 도착 예정인 버스가 없습니다.'
  );
});

test('buildMessage formats single-arrival item', () => {
  const items = [{ rtNm: '472', arrmsg1: '5분 30초후', arrmsg2: '운행종료' }];
  assert.equal(
    buildMessage(items),
    '현재 정류장의 버스 도착 정보입니다. 472번 버스는 5분 30초후 도착 예정입니다'
  );
});

test('buildMessage formats two-arrival item with 곧 도착', () => {
  const items = [{ rtNm: '472', arrmsg1: '5분 30초후', arrmsg2: '곧 도착' }];
  assert.equal(
    buildMessage(items),
    '현재 정류장의 버스 도착 정보입니다. 472번 버스는 먼저 5분 30초후, 다음 버스는 곧 도착입니다'
  );
});

test('buildMessage joins multiple lines with ". "', () => {
  const items = [
    { rtNm: '472', arrmsg1: '곧 도착', arrmsg2: '5분 후' },
    { rtNm: '143', arrmsg1: '3분 후', arrmsg2: '운행종료' },
  ];
  assert.equal(
    buildMessage(items),
    '현재 정류장의 버스 도착 정보입니다. 472번 버스는 먼저 곧 도착, 다음 버스는 5분 후 도착 예정입니다. 143번 버스는 3분 후 도착 예정입니다'
  );
});

test('mapErrorToMessage maps known error codes', () => {
  assert.equal(mapErrorToMessage({ code: 'JSON_PARSE' }), '버스 정보 응답을 처리할 수 없습니다.');
  assert.equal(mapErrorToMessage({ code: 'NO_ITEM_LIST' }), '해당 정류장의 버스 정보가 없습니다.');
});

test('mapErrorToMessage falls back to generic message for unknown codes', () => {
  assert.equal(mapErrorToMessage({ code: 'NETWORK' }), '버스 정보 조회에 실패했습니다.');
  assert.equal(mapErrorToMessage({ code: 'HTTP_STATUS' }), '버스 정보 조회에 실패했습니다.');
  assert.equal(mapErrorToMessage({}), '버스 정보 조회에 실패했습니다.');
});

// fetchSeoulBus imported at top

function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

test('fetchSeoulBus returns itemList on success', async () => {
  const sample = { msgBody: { itemList: [{ rtNm: '472', arrmsg1: '곧 도착', arrmsg2: '5분 후' }] } };
  await withMockedFetch(
    async (url) => {
      assert.match(url, /ws\.bus\.go\.kr/);
      assert.match(url, /ServiceKey=KEY%20WITH%20SPACE/);
      assert.match(url, /arsId=12345/);
      assert.match(url, /resultType=json/);
      return { ok: true, status: 200, json: async () => sample };
    },
    async () => {
      const items = await fetchSeoulBus('KEY WITH SPACE', '12345');
      assert.deepEqual(items, sample.msgBody.itemList);
    }
  );
});

test('fetchSeoulBus throws NETWORK when fetch rejects', async () => {
  await withMockedFetch(
    async () => { throw new Error('boom'); },
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'NETWORK'
      );
    }
  );
});

test('fetchSeoulBus throws HTTP_STATUS for non-2xx responses', async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'HTTP_STATUS'
      );
    }
  );
});

test('fetchSeoulBus throws JSON_PARSE when body is not valid JSON', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'JSON_PARSE'
      );
    }
  );
});

test('fetchSeoulBus throws NO_ITEM_LIST when response shape is unexpected', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ msgBody: {} }) }),
    async () => {
      await assert.rejects(
        () => fetchSeoulBus('k', 'a'),
        (err) => err.code === 'NO_ITEM_LIST'
      );
    }
  );
});
