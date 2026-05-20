import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDeviceCommand } from '../src/smartthings.js';

test('sendDeviceCommand POSTs commands to device endpoint with Bearer auth', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, async json() { return { results: [] }; } };
  };
  await sendDeviceCommand({
    accessToken: 'AT',
    deviceId: 'd1',
    commands: [{ capability: 'speechSynthesis', command: 'speak', arguments: ['hello'] }],
    fetch: fakeFetch,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/devices/d1/commands');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Authorization'], 'Bearer AT');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body, {
    commands: [{ component: 'main', capability: 'speechSynthesis', command: 'speak', arguments: ['hello'] }],
  });
});

test('sendDeviceCommand throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, async text() { return 'forbidden'; } });
  await assert.rejects(
    () => sendDeviceCommand({ accessToken: 'X', deviceId: 'd', commands: [], fetch: fakeFetch }),
    (e) => e.code === 'DEVICE_COMMAND_FAILED' && /403/.test(e.message)
  );
});
