const PREFIX = 'cha-amu:';

export interface CachePayload<T> {
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

export function readCachePayload<T>(key: string): CachePayload<T> | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload<T>;
    if (!parsed || !('data' in parsed)) return null;
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      data: parsed.data
    };
  } catch (_) {
    return null;
  }
}

export function readCache<T>(key: string): T | null {
  return readCachePayload<T>(key)?.data ?? null;
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
