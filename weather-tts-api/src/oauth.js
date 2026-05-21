function buildAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
  const u = new URL('https://api.smartthings.com/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', state);
  return u.toString();
}

function basicAuth(clientId, clientSecret) {
  // btoa works on both browsers and Workers; clientId/clientSecret are ASCII.
  return 'Basic ' + btoa(`${clientId}:${clientSecret}`);
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetch, now }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const resp = await fetch('https://api.smartthings.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
    err.code = 'OAUTH_EXCHANGE_FAILED';
    throw err;
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    installed_app_id: data.installed_app_id,
    expires_at: now() + data.expires_in * 1000,
  };
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetch, now }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const resp = await fetch('https://api.smartthings.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = new Error(`token refresh failed: ${resp.status} ${await resp.text()}`);
    err.code = 'OAUTH_REFRESH_FAILED';
    throw err;
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now() + data.expires_in * 1000,
  };
}

async function getValidAccessToken({ storage, clientId, clientSecret, fetch, now }) {
  const t = await storage.load();
  if (!t) {
    const err = new Error('no tokens — authorize via / first');
    err.code = 'NOT_AUTHORIZED';
    throw err;
  }
  if (now() >= t.expires_at - 60_000) {
    const refreshed = await refreshAccessToken({
      refreshToken: t.refresh_token,
      clientId, clientSecret, fetch, now,
    });
    const merged = { ...t, ...refreshed };
    await storage.save(merged);
    return merged.access_token;
  }
  return t.access_token;
}

export { buildAuthorizeUrl, exchangeCode, refreshAccessToken, getValidAccessToken };
