import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildConfig } from '../config.js';
import { createRateLimitGuard, resetRequestRateLimitStore } from './requestRateLimit.js';

describe('request rate limit', () => {
  beforeEach(() => {
    resetRequestRateLimitStore();
  });

  async function countLimited(remoteAddress: string, forwardedFor: (index: number) => string): Promise<number> {
    const app = Fastify({ trustProxy: buildConfig({}).trustProxy });
    const guard = createRateLimitGuard({ bucket: 'test', max: 2, windowMs: 60_000 });
    app.get('/limited', { preHandler: [guard] }, async () => ({ ok: true }));

    let limited = 0;
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/limited',
        remoteAddress,
        headers: { 'x-forwarded-for': forwardedFor(index) },
      });
      if (response.statusCode === 429) limited += 1;
    }
    await app.close();
    return limited;
  }

  it('cannot be bypassed by rotating a spoofed X-Forwarded-For from a public peer', async () => {
    expect(await countLimited('198.51.100.9', (index) => `8.8.4.${index}`)).toBe(3);
  });

  it('keys on the client resolved through a trusted proxy, not the leftmost entry', async () => {
    expect(await countLimited('10.0.0.8', (index) => `8.8.4.${index}, 203.0.113.5`)).toBe(3);
  });
});
