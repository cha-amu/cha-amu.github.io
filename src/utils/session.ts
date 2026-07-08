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
    if (!session.token || isSessionIdle(session)) {
      clearAdminSession();
      return null;
    }
    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

export function saveAdminSession(session: AdminSession): StoredAdminSession {
  const stored = { ...session, lastActiveAt: Date.now() };
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

export function isSessionIdle(session: StoredAdminSession): boolean {
  return Date.now() - session.lastActiveAt > config.adminIdleTimeoutMs;
}
