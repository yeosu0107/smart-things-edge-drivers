import { buildAuthorizeUrl, exchangeCode, getValidAccessToken } from './oauth.js';
import { registerSubscription } from './subscription.js';
import { sendDeviceCommand } from './smartthings.js';
import {
  getBaseDateTimeNcst, getBaseDateTimeFcst, todayYmdKst,
  extractNcstSlots, extractFcstSlots,
  fetchUltraSrtNcst, fetchVilageFcst, mapWeatherError,
} from './weather.js';
import { fetchAirQuality, mapAirError } from './airquality.js';
import { composeAnnouncement } from './compose.js';

const HTML_START = '<!doctype html><meta charset="utf-8"><title>Weather TTS — 설정</title><body style="font-family:-apple-system,sans-serif;max-width:520px;margin:4rem auto;padding:0 1.5rem;line-height:1.6"><h1>Weather TTS — 1회 설정</h1><p>가상 디바이스 switch 이벤트 구독을 위해 SmartThings 계정 권한을 1회 위임합니다.</p><p><a style="display:inline-block;padding:0.6rem 1.2rem;background:#1976d2;color:#fff;text-decoration:none;border-radius:0.4rem;font-weight:600" href="/authorize">SmartThings로 인증</a></p><p style="margin-top:2rem;color:#666;font-size:0.9rem">이후 가상 디바이스 <code>날씨 TTS</code>의 switch를 켜면 동작합니다.</p></body>';

const HTML_DONE = '<!doctype html><meta charset="utf-8"><title>설정 완료</title><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 1.5rem;line-height:1.6"><h1>설정 완료</h1><p>가상 디바이스 <code>날씨 TTS</code>의 switch를 켜면 동작합니다.</p></body>';

async function gatherWeather({ config, fetch, now }) {
  const d = new Date(now());
  const today = todayYmdKst(d);
  const nx = Number(config.nx);
  const ny = Number(config.ny);
  const [ncstResult, fcstResult, airResult] = await Promise.allSettled([
    fetchUltraSrtNcst(config.openDataApiKey, nx, ny, getBaseDateTimeNcst(d), fetch),
    fetchVilageFcst(config.openDataApiKey, nx, ny, getBaseDateTimeFcst(d), fetch),
    fetchAirQuality(config.openDataApiKey, config.airStationName, fetch),
  ]);

  let weather = null;
  let weatherErr = null;
  if (ncstResult.status === 'fulfilled' || fcstResult.status === 'fulfilled') {
    const ncst = ncstResult.status === 'fulfilled' ? extractNcstSlots(ncstResult.value) : { t1h: null, pty: null };
    const fcst = fcstResult.status === 'fulfilled' ? extractFcstSlots(fcstResult.value, today) : { tmx: null, tmn: null, pop: null };
    weather = { ...ncst, ...fcst };
  } else {
    weatherErr = mapWeatherError(ncstResult.reason);
    console.error('weather fetch failed',
      { ncst: ncstResult.reason && ncstResult.reason.code, fcst: fcstResult.reason && fcstResult.reason.code });
  }

  let air = null;
  let airErr = null;
  if (airResult.status === 'fulfilled') {
    air = airResult.value;
  } else {
    airErr = mapAirError(airResult.reason);
    console.error('air fetch failed', { code: airResult.reason && airResult.reason.code });
  }

  return { weather, air, errors: { weather: weatherErr, air: airErr } };
}

function createHandler({ config, storage, fetch, now }) {
  return async function handler(event) {
    const method = event.httpMethod;
    const path = event.path || '';

    if (method === 'GET' && (path === '/' || path === '')) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: HTML_START };
    }

    if (method === 'GET' && path.endsWith('/authorize')) {
      const url = buildAuthorizeUrl({
        clientId: config.clientId, redirectUri: config.redirectUri,
        scopes: ['r:devices:*', 'x:devices:*'], state: String(now()),
      });
      return { statusCode: 302, headers: { Location: url }, body: '' };
    }

    if (method === 'GET' && path.endsWith('/oauth/callback')) {
      const code = event.queryStringParameters && event.queryStringParameters.code;
      if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'missing code' };
      const tokens = await exchangeCode({
        code, clientId: config.clientId, clientSecret: config.clientSecret,
        redirectUri: config.redirectUri, fetch, now,
      });
      await storage.save(tokens);
      try {
        await registerSubscription({
          accessToken: tokens.access_token,
          installedAppId: tokens.installed_app_id,
          deviceId: config.weatherDeviceId,
          fetch,
        });
      } catch (e) {
        console.error('subscription register failed', e && e.message);
      }
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: HTML_DONE };
    }

    if (method === 'POST') {
      const raw = event.isBase64Encoded ? atob(event.body || '') : (event.body || '');
      const body = raw ? JSON.parse(raw) : {};

      if (body.lifecycle === 'PING') {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ statusCode: 200, pingData: body.pingData }) };
      }

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
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUrl: url }) };
      }

      if (body.lifecycle === 'EVENT' || (body.eventData && body.eventData.events)) {
        const events = (body.eventData && body.eventData.events) || [];
        const triggered = events.some(e =>
          e.eventType === 'DEVICE_EVENT' && e.deviceEvent && e.deviceEvent.value === 'on'
        );
        if (!triggered) {
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        const gathered = await gatherWeather({ config, fetch, now });
        const message = composeAnnouncement(gathered);

        let accessToken;
        try {
          accessToken = await getValidAccessToken({
            storage, clientId: config.clientId, clientSecret: config.clientSecret, fetch, now,
          });
        } catch (e) {
          console.error('access token unavailable', e && e.message);
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusCode: 200 }) };
        }

        const tasks = [
          sendDeviceCommand({
            accessToken, deviceId: config.weatherDeviceId,
            commands: [{ capability: 'switch', command: 'off' }], fetch,
          }),
        ];
        if (config.speakerDeviceId) {
          tasks.push(sendDeviceCommand({
            accessToken, deviceId: config.speakerDeviceId,
            commands: [{ capability: 'speechSynthesis', command: 'speak', arguments: [message] }], fetch,
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
