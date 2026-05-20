import { buildAuthorizeUrl, exchangeCode, getValidAccessToken } from './oauth.js';
import { registerSubscription } from './subscription.js';
import { sendDeviceCommand } from './smartthings.js';
import { fetchSeoulBus, buildMessage, mapErrorToMessage } from './bus.js';

function createHandler({ config, storage, fetch, now }) {
  return async function handler(event) {
    const method = event.httpMethod;
    const path = event.path || '';

    if (method === 'GET' && (path === '/' || path === '')) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<!doctype html><meta charset="utf-8"><title>Seoul Bus TTS — 설정</title><body style="font-family:-apple-system,sans-serif;max-width:520px;margin:4rem auto;padding:0 1.5rem;line-height:1.6"><h1>Seoul Bus TTS — 1회 설정</h1><p>가상 디바이스 switch 이벤트 구독을 위해 SmartThings 계정 권한을 1회 위임합니다.</p><p><a style="display:inline-block;padding:0.6rem 1.2rem;background:#1976d2;color:#fff;text-decoration:none;border-radius:0.4rem;font-weight:600" href="/authorize">SmartThings로 인증</a></p><p style="margin-top:2rem;color:#666;font-size:0.9rem">이후 가상 디바이스 <code>버스 TTS</code>의 switch를 켜면 동작합니다.</p></body>',
      };
    }

    if (method === 'GET' && path.endsWith('/authorize')) {
      const url = buildAuthorizeUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        scopes: ['r:devices:*', 'x:devices:*'],
        state: String(now()),
      });
      return { statusCode: 302, headers: { Location: url }, body: '' };
    }

    if (method === 'GET' && path.endsWith('/oauth/callback')) {
      const code = event.queryStringParameters && event.queryStringParameters.code;
      if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'missing code' };
      const tokens = await exchangeCode({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        fetch, now,
      });
      await storage.save(tokens);
      try {
        await registerSubscription({
          accessToken: tokens.access_token,
          installedAppId: tokens.installed_app_id,
          deviceId: config.busDeviceId,
          fetch,
        });
      } catch (e) {
        console.error('subscription register failed', e && e.message);
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<!doctype html><meta charset="utf-8"><title>설정 완료</title><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 1.5rem;line-height:1.6"><h1>설정 완료</h1><p>가상 디바이스 <code>버스 TTS</code>의 switch를 켜면 동작합니다.</p></body>',
      };
    }

    if (method === 'POST') {
      const raw = event.isBase64Encoded
        ? atob(event.body || '')
        : (event.body || '');
      const body = raw ? JSON.parse(raw) : {};

      if (body.lifecycle === 'PING') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statusCode: 200, pingData: body.pingData }),
        };
      }

      // API_ONLY CONFIRMATION omits `lifecycle`, only sends `confirmationData`.
      if (body.lifecycle === 'CONFIRMATION' || (body.confirmationData && body.confirmationData.confirmationUrl)) {
        const url = body.confirmationData && body.confirmationData.confirmationUrl;
        if (url) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) console.error('confirmation fetch non-2xx', resp.status);
          } catch (e) {
            console.error('confirmation fetch failed', e && e.message);
          }
        }
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUrl: url }),
        };
      }

      // API_ONLY sends `messageType` instead of `lifecycle`; both forms accepted.
      if (body.lifecycle === 'EVENT' || (body.eventData && body.eventData.events)) {
        const events = (body.eventData && body.eventData.events) || [];
        const triggered = events.some(e =>
          e.eventType === 'DEVICE_EVENT' && e.deviceEvent && e.deviceEvent.value === 'on'
        );
        if (!triggered) {
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        let message;
        try {
          const items = await fetchSeoulBus(config.openDataApiKey, config.busArsId, fetch);
          message = buildMessage(items);
        } catch (err) {
          message = mapErrorToMessage(err);
          console.error('bus fetch failed', { code: err && err.code, msg: err && err.message });
        }

        let accessToken;
        try {
          accessToken = await getValidAccessToken({
            storage,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            fetch, now,
          });
        } catch (e) {
          console.error('access token unavailable', e && e.message);
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        const tasks = [
          sendDeviceCommand({
            accessToken,
            deviceId: config.busDeviceId,
            commands: [{ capability: 'switch', command: 'off' }],
            fetch,
          }),
        ];
        if (config.speakerDeviceId) {
          tasks.push(sendDeviceCommand({
            accessToken,
            deviceId: config.speakerDeviceId,
            commands: [{ capability: 'speechSynthesis', command: 'speak', arguments: [message] }],
            fetch,
          }));
        }
        const results = await Promise.allSettled(tasks);
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error('command channel failed', { idx: i, reason: r.reason && r.reason.message });
          }
        });

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
    }

    return { statusCode: 404, body: 'not found' };
  };
}

export { createHandler };
