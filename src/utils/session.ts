import { config } from '../config';
import type { AdminSession } from '../types';

const STORAGE_KEY = 'cha-amu-admin-session';

interface StoredAdminSession extends AdminSession {
  lastActiveAt: number;
}

export function loadAdminSession(): StoredAdminSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as StoredAdminSession;
    if (!session.token || getAdminSessionRemainingMs(session) <= 0) {
      clearAdminSession();
      return null;
    }
    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

export function saveAdminSession(session: AdminSession, lastActiveAt = Date.now()): StoredAdminSession {
  const stored = { ...session, lastActiveAt };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export function refreshAdminSession(): StoredAdminSession | null {
  const session = loadAdminSession();
  if (!session) return null;
  session.lastActiveAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearAdminSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAdminSessionRemainingMs(
  session: Pick<StoredAdminSession, 'expiresAt' | 'lastActiveAt'>,
  now = Date.now()
): number {
  const idleDeadline = session.lastActiveAt + config.adminIdleTimeoutMs;
  const serverDeadline = Date.parse(session.expiresAt || '');
  const deadline = Number.isFinite(serverDeadline)
    ? Math.min(idleDeadline, serverDeadline)
    : idleDeadline;
  return Math.max(0, deadline - now);
}
