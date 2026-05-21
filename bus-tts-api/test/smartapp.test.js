import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/smartapp.js';
import { createMemoryStorage } from '../src/storage.js';

function makeEvent(method, path, body) {
  const qsi = path.indexOf('?');
  const queryStringParameters = {};
  if (qsi >= 0) {
    const params = new URLSearchParams(path.slice(qsi + 1));
    for (const [k, v] of params) queryStringParameters[k] = v;
  }
  return {
    httpMethod: method,
    path: qsi >= 0 ? path.slice(0, qsi) : path,
    queryStringParameters,
    body: typeof body === 'string' ? body : (body ? JSON.stringify(body) : ''),
    isBase64Encoded: false,
  };
}

test('GET /authorize redirects to SmartThings OAuth authorize URL', async () => {
  const handler = createHandler({
    config: {
      clientId: 'cid', clientSecret: 'csec',
      redirectUri: 'https://example.com/oauth/callback',
      busDeviceId: 'd1', busArsId: '12345',
    },
    storage: createMemoryStorage(),
    fetch: async () => { throw new Error('no fetch'); },
    now: () => 1_700_000_000_000,
  });
  const res = await handler(makeEvent('GET', '/authorize'));
  assert.equal(res.statusCode, 302);
  const u = new URL(res.headers.Location);
  assert.equal(u.searchParams.get('client_id'), 'cid');
});

test('GET /oauth/callback exchanges code, persists tokens to storage, registers subscription', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://api.smartthings.com/oauth/token') {
      return { ok: true, async json() { return { access_token: 'AT', refresh_token: 'RT', expires_in: 86400, installed_app_id: 'IAP' }; } };
    }
    if (url.endsWith('/installedapps/IAP/subscriptions')) {
      return { ok: true, async json() { return { id: 'sub1' }; } };
    }
    throw new Error('unexpected ' + url);
  };
  const storage = createMemoryStorage();
  const handler = createHandler({
    config: { clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://example.com/cb', busDeviceId: 'd1', busArsId: '12345' },
    storage, fetch: fakeFetch, now: () => 1_700_000_000_000,
  });
  const res = await handler(makeEvent('GET', '/oauth/callback?code=xyz'));
  assert.equal(res.statusCode, 200);
  const saved = await storage.load();
  assert.equal(saved.access_token, 'AT');
  assert.equal(saved.refresh_token, 'RT');
  assert.equal(saved.installed_app_id, 'IAP');
  assert(calls.find(c => c.url.endsWith('/installedapps/IAP/subscriptions')), 'subscription should be registered');
});

test('GET /oauth/callback returns 400 when code missing', async () => {
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd', busArsId: '1' },
    storage: createMemoryStorage(),
    fetch: async () => {}, now: () => 0,
  });
  const res = await handler(makeEvent('GET', '/oauth/callback'));
  assert.equal(res.statusCode, 400);
});

test('POST PING returns same challenge', async () => {
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd', busArsId: '1' },
    storage: createMemoryStorage(),
    fetch: async () => {}, now: () => 0,
  });
  const res = await handler(makeEvent('POST', '/', {
    lifecycle: 'PING', pingData: { challenge: 'C1' },
  }));
  assert.deepEqual(JSON.parse(res.body), { statusCode: 200, pingData: { challenge: 'C1' } });
});

test('POST CONFIRMATION without lifecycle field fetches confirmationUrl and returns targetUrl', async () => {
  let fetched;
  const fakeFetch = async (url) => { fetched = url; return { ok: true, async text() { return ''; } }; };
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd', busArsId: '1' },
    storage: createMemoryStorage(),
    fetch: fakeFetch, now: () => 0,
  });
  const res = await handler(makeEvent('POST', '/', {
    confirmationData: { confirmationUrl: 'https://api.smartthings.com/confirm?t=xx' },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(fetched, 'https://api.smartthings.com/confirm?t=xx');
  assert.deepEqual(JSON.parse(res.body), { targetUrl: 'https://api.smartthings.com/confirm?t=xx' });
});

test('POST EVENT with switch on uses stored token to send busmessage + switch off', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init && init.body });
    if (url.startsWith('http://ws.bus.go.kr/')) {
      return { ok: true, async json() { return { msgBody: { itemList: [{ rtNm: '143', arrmsg1: '곧 도착' }] } }; } };
    }
    if (url === 'https://api.smartthings.com/devices/d1/commands') {
      return { ok: true, async json() { return { results: [] }; } };
    }
    throw new Error('unexpected ' + url);
  };
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'AT', refresh_token: 'RT', expires_at: 9_999_999_999_999, installed_app_id: 'IAP' });
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd1', busArsId: '12345', openDataApiKey: 'K' },
    storage, fetch: fakeFetch, now: () => 1_700_000_000_000,
  });
  const res = await handler(makeEvent('POST', '/', {
    lifecycle: 'EVENT',
    eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'on' } }] },
  }));
  assert.equal(res.statusCode, 200);
  const cmdCall = calls.find(c => c.url === 'https://api.smartthings.com/devices/d1/commands');
  assert(cmdCall, 'device command should be sent');
  const cmdBody = JSON.parse(cmdCall.body);
  assert.equal(cmdBody.commands[0].capability, 'switch');
  assert.equal(cmdBody.commands[0].command, 'off');
});

test('POST EVENT for switch off (non-on value) is ignored', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true, async json() { return {}; } }; };
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'AT', refresh_token: 'RT', expires_at: 9_999_999_999_999, installed_app_id: 'IAP' });
  const handler = createHandler({
    config: { clientId: 'c', clientSecret: 's', redirectUri: 'r', busDeviceId: 'd1', busArsId: '1', openDataApiKey: 'K' },
    storage, fetch: fakeFetch, now: () => 0,
  });
  const res = await handler(makeEvent('POST', '/', {
    lifecycle: 'EVENT',
    eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'off' } }] },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(called, false);
});

test('POST EVENT also speaks via speaker device when configured', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init && init.body });
    if (url.startsWith('http://ws.bus.go.kr/')) {
      return { ok: true, async json() { return { msgBody: { itemList: [{ rtNm: '143', arrmsg1: '곧 도착' }] } }; } };
    }
    return { ok: true, async json() { return { results: [] }; } };
  };
  const storage = createMemoryStorage();
  await storage.save({ access_token: 'AT', refresh_token: 'RT', expires_at: 9_999_999_999_999, installed_app_id: 'IAP' });
  const handler = createHandler({
    config: {
      clientId: 'c', clientSecret: 's', redirectUri: 'r',
      busDeviceId: 'd1', busArsId: '1', openDataApiKey: 'K',
      speakerDeviceId: 'spk1',
    },
    storage, fetch: fakeFetch, now: () => 0,
  });
  await handler(makeEvent('POST', '/', {
    lifecycle: 'EVENT',
    eventData: { events: [{ eventType: 'DEVICE_EVENT', deviceEvent: { value: 'on' } }] },
  }));
  const spk = calls.find(c => c.url === 'https://api.smartthings.com/devices/spk1/commands');
  assert(spk, 'speaker command should be sent');
  assert.equal(JSON.parse(spk.body).commands[0].capability, 'speechSynthesis');
});
