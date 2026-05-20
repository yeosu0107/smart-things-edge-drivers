import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionPayload, registerSubscription } from '../src/subscription.js';

test('buildSubscriptionPayload returns DEVICE subscription for switch capability', () => {
  const p = buildSubscriptionPayload({ deviceId: 'd1', subscriptionName: 'busTrigger' });
  assert.deepEqual(p, {
    sourceType: 'DEVICE',
    device: {
      deviceId: 'd1',
      componentId: 'main',
      capability: 'switch',
      attribute: 'switch',
      stateChangeOnly: true,
      subscriptionName: 'busTrigger',
      value: '*',
    },
  });
});

test('registerSubscription POSTs to installedapps subscriptions endpoint with Bearer auth', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, async json() { return { id: 'sub1' }; } };
  };
  const out = await registerSubscription({
    accessToken: 'AT',
    installedAppId: 'IAP1',
    deviceId: 'd1',
    fetch: fakeFetch,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/installedapps/IAP1/subscriptions');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Authorization'], 'Bearer AT');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.device.deviceId, 'd1');
  assert.equal(body.device.capability, 'switch');
  assert.deepEqual(out, { id: 'sub1' });
});

test('registerSubscription throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, async text() { return 'unauth'; } });
  await assert.rejects(
    () => registerSubscription({ accessToken: 'X', installedAppId: 'I', deviceId: 'd', fetch: fakeFetch }),
    (e) => e.code === 'SUBSCRIPTION_REGISTER_FAILED' && /401/.test(e.message)
  );
});
