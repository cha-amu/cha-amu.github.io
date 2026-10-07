import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createPublicWikiClient } from '../api/publicWikiClient';
import { config } from '../config';
import { usePublicResource, type PublicResource } from '../stores/publicDataStore';
import { wikiResourceKey } from '../utils/publicWiki';

const client = createPublicWikiClient(config.wikiIndexUrl);
export const refreshPublicWiki = (force = false) => client.load(force);

export function usePublicWiki(enabled = true) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    if (enabled) void client.load();
  }, [enabled]);
  return snapshot;
}

export interface VisibleWikiResources {
  /** False until both public lists have loaded or failed; callers hide resource links meanwhile. */
  ready: boolean;
  keys: ReadonlySet<string>;
}

const settled = (resource: PublicResource<unknown>) => resource.items.length > 0 || resource.status === 'ready' || resource.status === 'error';

/**
 * Posts and assets the blog shows right now. A wiki snapshot can be older than a
 * hide/delete on the blog, so wiki links and map nodes must be filtered by this set.
 */
export function useVisibleWikiResources(): VisibleWikiResources {
  const posts = usePublicResource('posts');
  const archive = usePublicResource('archive');
  return useMemo(() => {
    const keys = new Set<string>();
    for (const post of posts.items) keys.add(wikiResourceKey('post', post.id));
    for (const asset of archive.items) keys.add(wikiResourceKey('asset', asset.id));
    return { ready: settled(posts) && settled(archive), keys };
  }, [posts, archive]);
}
