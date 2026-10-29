import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';

type ConfigModule = typeof import('../../config.js');
type DbModule = typeof import('../../db/index.js');
type MonitorSessionModule = typeof import('../../services/monitorSessionStore.js');

describe('monitor routes', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let config: ConfigModule['config'];
  let clearMonitorSessions: MonitorSessionModule['clearMonitorSessions'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-monitor-routes-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./monitor.js');
    const configModule = await import('../../config.js');
    const monitorSessionModule = await import('../../services/monitorSessionStore.js');
    db = dbModule.db;
    schema = dbModule.schema;
    config = configModule.config;
    clearMonitorSessions = monitorSessionModule.clearMonitorSessions;

    app = Fastify();
    await app.register(routesModule.monitorRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.settings).run();
    clearMonitorSessions();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('rejects malformed monitor config payloads at the route boundary', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/monitor/config',
      payload: {
        ldohCookie: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: 'Invalid ldohCookie. Expected string or null.',
    });
  });

  it('accepts null monitor cookie payloads and clears the stored cookie', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/monitor/config',
      payload: {
        ldohCookie: 'ld_auth_session=abcdefghijklmnopqrstuvwxyz',
      },
    });
    expect(saveResponse.statusCode).toBe(200);

    const clearResponse = await app.inject({
      method: 'PUT',
      url: '/api/monitor/config',
      payload: {
        ldohCookie: null,
      },
    });

    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toMatchObject({
      success: true,
      ldohCookieConfigured: false,
    });

    const saved = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'monitor_ldoh_cookie'))
      .get();
    expect(saved?.value).toBe('""');
  });

  async function issueMonitorSessionCookie(): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/api/monitor/session' });
    expect(response.statusCode).toBe(200);
    const setCookie = String(response.headers['set-cookie'] || '');
    const match = /^meta_monitor_auth=([^;]*);/.exec(setCookie);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('issues an opaque monitor session cookie instead of the admin token', async () => {
    const sessionId = await issueMonitorSessionCookie();

    expect(sessionId).not.toBe(config.authToken);
    expect(sessionId).not.toContain(config.authToken);
    expect(sessionId.length).toBeGreaterThanOrEqual(43);
    expect(await issueMonitorSessionCookie()).not.toBe(sessionId);
  });

  it('accepts only issued monitor sessions on the LDOH proxy', async () => {
    const sessionId = await issueMonitorSessionCookie();

    const withSession = await app.inject({
      method: 'GET',
      url: '/monitor-proxy/ldoh/',
      headers: { cookie: `meta_monitor_auth=${sessionId}` },
    });
    // Authenticated, then stops before any upstream fetch because no LDOH cookie is stored.
    expect(withSession.statusCode).toBe(400);

    const withAdminToken = await app.inject({
      method: 'GET',
      url: '/monitor-proxy/ldoh/',
      headers: { cookie: `meta_monitor_auth=${config.authToken}` },
    });
    expect(withAdminToken.statusCode).toBe(401);

    clearMonitorSessions();
    const afterClear = await app.inject({
      method: 'GET',
      url: '/monitor-proxy/ldoh/',
      headers: { cookie: `meta_monitor_auth=${sessionId}` },
    });
    expect(afterClear.statusCode).toBe(401);
  });
});
