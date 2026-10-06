import { useEffect, useSyncExternalStore } from 'react';
import { createPublicWikiClient } from '../api/publicWikiClient';
import { config } from '../config';

const client = createPublicWikiClient(config.wikiIndexUrl);
export const refreshPublicWiki = (force = false) => client.load(force);

export function usePublicWiki(enabled = true) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    if (enabled) void client.load();
  }, [enabled]);
  return snapshot;
}
