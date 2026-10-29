import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { authMiddleware, extractClientIp, isIpAllowed, requiresAdminAuth } from './auth.js';

describe('admin auth hook', () => {
  async function buildApp() {
    const app = Fastify();
    app.addHook('onRequest', async (request, reply) => {
      if (requiresAdminAuth(request)) {
        await authMiddleware(request, reply);
      }
    });
    app.get('/api/desktop/health', async () => ({ ok: true }));
    app.get('/api/oauth/callback/:provider', async () => ({ callback: true }));
    app.get('/api/events', async () => ({ admin: true }));
    app.post('/api/monitor/session', async () => ({ admin: true }));
    app.get('/v1/models', async () => ({ proxy: true }));
    return app;
  }

  it.each([
    ['GET', '/api/events'],
    ['GET', '/%61pi/events'],
    ['GET', '/%61%70%69/events'],
    ['GET', '/a%70i/events'],
    ['GET', '/api/%65vents'],
    ['POST', '/%61pi/monitor/session'],
  ] as const)('requires the admin token for %s %s', async (method, url) => {
    const app = await buildApp();
    const response = await app.inject({ method, url });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('keeps public api routes, non-api routes and authorized admin requests reachable', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/desktop/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/oauth/callback/codex' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/models' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/nonexistent' })).statusCode).toBe(401);
    const authorized = await app.inject({
      method: 'GET',
      url: '/%61pi/events',
      headers: { authorization: `Bearer ${config.authToken}` },
    });
    expect(authorized.statusCode).toBe(200);
    await app.close();
  });
});

describe('auth middleware IP helpers', () => {
  it('extracts first forwarded IP and normalizes ipv4-mapped address', () => {
    const ip = extractClientIp('::ffff:10.0.0.1', '198.51.100.7, 203.0.113.2');
    expect(ip).toBe('198.51.100.7');
  });

  it('allows request when allowlist is empty', () => {
    expect(isIpAllowed('203.0.113.8', [])).toBe(true);
  });

  it('rejects non-allowlisted IP when allowlist is configured', () => {
    expect(isIpAllowed('203.0.113.8', ['203.0.113.9'])).toBe(false);
    expect(isIpAllowed('203.0.113.9', ['203.0.113.9'])).toBe(true);
  });

  it('matches ipv4 CIDR ranges in the allowlist', () => {
    expect(isIpAllowed('8.8.8.8', ['8.8.8.0/24'])).toBe(true);
    expect(isIpAllowed('8.8.9.8', ['8.8.8.0/24'])).toBe(false);
    expect(isIpAllowed('8.8.8.8', ['8.8.0.0/16'])).toBe(true);
  });

  it('ignores malformed CIDR entries instead of matching unexpectedly', () => {
    expect(isIpAllowed('8.8.8.8', ['8.8.8.0/99'])).toBe(false);
    expect(isIpAllowed('8.8.8.8', ['not-an-ip/24'])).toBe(false);
  });
});
