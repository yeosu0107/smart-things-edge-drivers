import { createHandler } from './smartapp.js';
import { createKVStorage } from './storage.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const event = {
      httpMethod: request.method,
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text(),
      isBase64Encoded: false,
    };
    const config = {
      clientId: env.ST_CLIENT_ID,
      clientSecret: env.ST_CLIENT_SECRET,
      redirectUri: env.ST_REDIRECT_URI,
      busDeviceId: env.BUS_DEVICE_ID,
      busArsId: env.BUS_ARS_ID,
      speakerDeviceId: env.SPEAKER_DEVICE_ID || undefined,
      openDataApiKey: env.OPEN_DATA_API_KEY,
    };
    const storage = createKVStorage(env.ST_TOKENS);
    const handler = createHandler({
      config,
      storage,
      fetch: globalThis.fetch.bind(globalThis),
      now: () => Date.now(),
    });
    const res = await handler(event);
    return new Response(res.body, {
      status: res.statusCode,
      headers: res.headers || {},
    });
  },
};
