import { parsePublicWikiIndex, safeWikiUrl, type PublicWikiIndex } from '../utils/publicWiki';

export interface WikiSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  index: PublicWikiIndex | null;
}

// In-memory only: a failed refresh must not leave a previously connected graph visible.
export function createPublicWikiClient(indexUrl: string, request: typeof fetch = fetch) {
  let snapshot: WikiSnapshot = { status: 'idle', index: null };
  let pending: Promise<void> | null = null;
  let checkedAt = 0;
  const listeners = new Set<() => void>();
  const publish = (next: WikiSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const load = (force = false): Promise<void> => {
    if (pending) return pending;
    if (!force && checkedAt && Date.now() - checkedAt < 60_000) return Promise.resolve();
    publish({ status: 'loading', index: null });
    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const url = safeWikiUrl(indexUrl);
        if (!url) throw new Error('Invalid public index URL');
        const response = await request(url, {
          credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', signal: controller.signal
        });
        if (!response.ok || Number(response.headers.get('content-length')) > 8_000_000) throw new Error('Unavailable public index');
        const source = await response.text();
        if (source.length > 8_000_000) throw new Error('Public index too large');
        const index = parsePublicWikiIndex(JSON.parse(source));
        if (!index) throw new Error('Invalid public index');
        publish({ status: 'ready', index });
      } catch {
        publish({ status: 'error', index: null });
      } finally {
        clearTimeout(timeout);
        checkedAt = Date.now();
      }
    })().finally(() => { pending = null; });
    return pending;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load
  };
}
