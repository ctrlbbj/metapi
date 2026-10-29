import { randomBytes } from 'node:crypto';

// Opaque ids for the monitor iframe cookie, so the admin token never travels in Set-Cookie.
export const MONITOR_SESSION_MAX_AGE_SEC = 2 * 60 * 60;
const MONITOR_SESSION_MAX_COUNT = 1000;

const monitorSessions = new Map<string, number>();

function pruneExpiredSessions(nowMs: number): void {
  for (const [sessionId, expiresAt] of monitorSessions) {
    if (expiresAt <= nowMs) monitorSessions.delete(sessionId);
  }
}

export function issueMonitorSession(nowMs = Date.now()): string {
  pruneExpiredSessions(nowMs);
  while (monitorSessions.size >= MONITOR_SESSION_MAX_COUNT) {
    const oldest = monitorSessions.keys().next().value;
    if (oldest === undefined) break;
    monitorSessions.delete(oldest);
  }
  const sessionId = randomBytes(32).toString('base64url');
  monitorSessions.set(sessionId, nowMs + MONITOR_SESSION_MAX_AGE_SEC * 1000);
  return sessionId;
}

export function isMonitorSessionValid(sessionId: string | undefined, nowMs = Date.now()): boolean {
  if (!sessionId) return false;
  const expiresAt = monitorSessions.get(sessionId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= nowMs) {
    monitorSessions.delete(sessionId);
    return false;
  }
  return true;
}

// Called when the admin token changes so sessions issued under the old token stop working.
export function clearMonitorSessions(): void {
  monitorSessions.clear();
}
