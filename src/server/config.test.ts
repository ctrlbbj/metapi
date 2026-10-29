import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildConfig, buildFastifyOptions } from './config.js';

describe('buildConfig', () => {
  it('defaults to external listen host for server deployments', () => {
    const config = buildConfig({});

    expect(config.listenHost).toBe('0.0.0.0');
    expect(config.port).toBe(4000);
    expect(config.dataDir).toBe('./data');
  });

  it('aligns desktop deployments with server deployments for listen host', () => {
    const config = buildConfig({
      HOST: '0.0.0.0',
      METAPI_DESKTOP: '1',
      PORT: '4312',
      DATA_DIR: '/tmp/metapi-data',
    });

    expect(config.listenHost).toBe('0.0.0.0');
    expect(config.port).toBe(4312);
    expect(config.dataDir).toBe('/tmp/metapi-data');
  });

  it('honors explicit loopback host outside desktop mode', () => {
    const config = buildConfig({
      HOST: '127.0.0.1',
    });

    expect(config.listenHost).toBe('127.0.0.1');
  });

  it('defaults telegram api base url to the official endpoint', () => {
    const config = buildConfig({});

    expect(config.telegramApiBaseUrl).toBe('https://api.telegram.org');
    expect(config.telegramMessageThreadId).toBe('');
  });

  it('accepts telegram message thread id from environment', () => {
    const config = buildConfig({
      TELEGRAM_MESSAGE_THREAD_ID: '77',
    });

    expect(config.telegramMessageThreadId).toBe('77');
  });

  it('ships CLI-aligned OAuth defaults', () => {
    const config = buildConfig({});

    expect(config.codexClientId).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(config.codexResponsesWebsocketBeta).toBe('responses_websockets=2026-02-06');
    expect(config.claudeClientId).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(config.claudeClientSecret).toBe('');
    expect(config.geminiCliClientId).toBe('681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com');
    expect(config.geminiCliClientSecret).toBe('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');
  });

  it('allows overriding the codex websocket beta gate from environment', () => {
    const config = buildConfig({
      CODEX_RESPONSES_WEBSOCKET_BETA: 'responses_websockets=2099-01-01',
    });

    expect(config.codexResponsesWebsocketBeta).toBe('responses_websockets=2099-01-01');
  });

  it('accepts JSON request bodies larger than Fastify default 1 MiB', async () => {
    const app = Fastify(buildFastifyOptions(buildConfig({})));
    const largeText = 'a'.repeat(2 * 1024 * 1024);

    app.post('/echo', async (request) => {
      const body = request.body as { text?: string };
      return { textLength: body.text?.length ?? 0 };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { text: largeText },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ textLength: largeText.length });
    await app.close();
  });

  it('trusts forwarded client IP headers for reverse-proxy deployments', async () => {
    const app = Fastify(buildFastifyOptions(buildConfig({})));

    app.get('/ip', async (request) => ({
      ip: request.ip,
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.0.0.8',
      headers: {
        'x-forwarded-for': '203.0.113.5, 10.0.0.8',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ip: '203.0.113.5' });
    await app.close();
  });

  async function resolveRequestIp(
    env: NodeJS.ProcessEnv,
    remoteAddress: string,
    forwardedFor?: string,
  ): Promise<string> {
    const app = Fastify(buildFastifyOptions(buildConfig(env)));
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    await app.close();
    return (response.json() as { ip: string }).ip;
  }

  it('ignores X-Forwarded-For sent by a public peer by default', async () => {
    expect(await resolveRequestIp({}, '198.51.100.9', '8.8.4.4')).toBe('198.51.100.9');
  });

  it('does not let a client prepend its own address in front of a trusted proxy', async () => {
    expect(await resolveRequestIp({}, '10.0.0.8', '8.8.4.4, 198.51.100.9')).toBe('198.51.100.9');
  });

  it('resolves the client behind CDN ranges listed in TRUST_PROXY', async () => {
    const env = { TRUST_PROXY: 'loopback, uniquelocal, 172.64.0.0/13' };
    expect(await resolveRequestIp(env, '172.22.0.1', '8.8.4.4, 203.0.113.7, 172.71.24.85')).toBe('203.0.113.7');
    expect(await resolveRequestIp(env, '172.22.0.1', '8.8.4.4, 198.51.100.9')).toBe('198.51.100.9');
  });

  it('parses TRUST_PROXY switches and hop counts', async () => {
    expect(buildConfig({}).trustProxy).toEqual(['loopback', 'linklocal', 'uniquelocal']);
    expect(buildConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(buildConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(buildConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(await resolveRequestIp({ TRUST_PROXY: 'true' }, '198.51.100.9', '8.8.4.4')).toBe('8.8.4.4');
  });
});
