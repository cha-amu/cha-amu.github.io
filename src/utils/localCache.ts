const PREFIX = 'cha-amu:';

interface CachePayload<T> {
  savedAt: string;
  data: T;
}

function isStorageAvailable() {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch (_) {
    return false;
  }
}

export function readCache<T>(key: string): T | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload<T>;
    return parsed.data ?? null;
  } catch (_) {
    return null;
  }
}

export function writeCache<T>(key: string, data: T) {
  if (!isStorageAvailable()) return;
  try {
    const payload: CachePayload<T> = { savedAt: new Date().toISOString(), data };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(payload));
  } catch (_) {
    // Cache failures must not break page behavior.
  }
}
