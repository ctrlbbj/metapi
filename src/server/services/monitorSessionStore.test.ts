import { beforeEach, describe, expect, it } from 'vitest';
import {
  MONITOR_SESSION_MAX_AGE_SEC,
  clearMonitorSessions,
  isMonitorSessionValid,
  issueMonitorSession,
} from './monitorSessionStore.js';

describe('monitor session store', () => {
  beforeEach(() => {
    clearMonitorSessions();
  });

  it('issues random session ids that validate until they expire', () => {
    const now = 1_000_000;
    const sessionId = issueMonitorSession(now);

    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issueMonitorSession(now)).not.toBe(sessionId);
    expect(isMonitorSessionValid(sessionId, now)).toBe(true);
    expect(isMonitorSessionValid(sessionId, now + MONITOR_SESSION_MAX_AGE_SEC * 1000 - 1)).toBe(true);
    expect(isMonitorSessionValid(sessionId, now + MONITOR_SESSION_MAX_AGE_SEC * 1000)).toBe(false);
  });

  it('rejects unknown, empty and cleared session ids', () => {
    const sessionId = issueMonitorSession();

    expect(isMonitorSessionValid(undefined)).toBe(false);
    expect(isMonitorSessionValid('')).toBe(false);
    expect(isMonitorSessionValid('not-a-session')).toBe(false);

    clearMonitorSessions();
    expect(isMonitorSessionValid(sessionId)).toBe(false);
  });
});
