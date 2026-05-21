import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl, exchangeCode, refreshAccessToken, getValidAccessToken } from '../src/oauth.js';
import { createMemoryStorage } from '../src/storage.js';

test('buildAuthorizeUrl encodes all required params', () => {
  const url = buildAuthorizeUrl({
    clientId: 'cid',
    redirectUri: 'https://example.com/oauth/callback',
    scopes: ['r:devices:*', 'x:devices:*'],
    state: 'abc123',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.smartthings.com/oauth/authorize');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('client_id'), 'cid');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://example.com/oauth/callback');
  assert.equal(parsed.searchParams.get('scope'), 'r:devices:* x:devices:*');
  assert.equal(parsed.searchParams.get('state'), 'abc123');
});

test('exchangeCode POSTs to token endpoint and normalizes response', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      async json() {
        return { access_token: 'at', refresh_token: 'rt', expires_in: 86400, installed_app_id: 'iap1' };
      },
    };
  };
  const now = 1_700_000_000_000;
  const tokens = await exchangeCode({
    code: 'xyz',
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUri: 'https://example.com/oauth/callback',
    fetch: fakeFetch,
    now: () => now,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/oauth/token');
  assert.equal(captured.init.method, 'POST');
  const body = new URLSearchParams(captured.init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'xyz');
  assert.equal(body.get('redirect_uri'), 'https://example.com/oauth/callback');
  assert.equal(body.get('client_id'), null, 'client_id must not be in body');
  assert.equal(body.get('client_secret'), null, 'client_secret must not be in body');
  assert.equal(captured.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(
    captured.init.headers['Authorization'],
    'Basic ' + Buffer.from('cid:csec').toString('base64'),
    'client credentials must be sent via Basic auth'
  );
  assert.equal(tokens.access_token, 'at');
  assert.equal(tokens.refresh_token, 'rt');
  assert.equal(tokens.installed_app_id, 'iap1');
  assert.equal(tokens.expires_at, now + 86400 * 1000);
});

test('exchangeCode throws when response not ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, async text() { return 'bad'; } });
  await assert.rejects(
    () => exchangeCode({ code: 'x', clientId: 'c', clientSecret: 's', redirectUri: 'r', fetch: fakeFetch, now: () => 0 }),
    (e) => e.code === 'OAUTH_EXCHANGE_FAILED' && /400/.test(e.message)
  );
});

// refreshAccessToken imported at top

test('refreshAccessToken sends refresh_token grant and returns normalized tokens', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, async json() { return { access_token: 'at2', refresh_token: 'rt2', expires_in: 86400 }; } };
  };
  const now = 1_700_000_000_000;
  const t = await refreshAccessToken({
    refreshToken: 'rt-old',
    clientId: 'cid',
    clientSecret: 'csec',
    fetch: fakeFetch,
    now: () => now,
  });
  assert.equal(captured.url, 'https://api.smartthings.com/oauth/token');
  const body = new URLSearchParams(captured.init.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'rt-old');
  assert.equal(body.get('client_id'), null, 'client_id must not be in body');
  assert.equal(body.get('client_secret'), null, 'client_secret must not be in body');
  assert.equal(
    captured.init.headers['Authorization'],
    'Basic ' + Buffer.from('cid:csec').toString('base64'),
    'client credentials must be sent via Basic auth'
  );
  assert.equal(t.access_token, 'at2');
  assert.equal(t.refresh_token, 'rt2');
  assert.equal(t.expires_at, now + 86400 * 1000);
});

