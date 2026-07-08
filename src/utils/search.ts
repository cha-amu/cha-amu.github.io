import type { ArchiveAsset, Post, SearchResult } from '../types';
import { excerpt, normalizeText } from './strings';

export function buildSearchResults(posts: Post[], assets: ArchiveAsset[], query: string): SearchResult[] {
  const q = normalizeText(query);
  const results: SearchResult[] = [];
  const matches = (parts: string[]) => !q || parts.some((part) => normalizeText(part).includes(q));

  for (const post of posts) {
    const parts = [post.title, post.excerpt || '', post.body, ...post.tags];
    if (matches(parts)) {
      results.push({
        id: post.id,
        type: 'post',
        title: post.title,
        excerpt: post.excerpt || excerpt(post.body),
        tags: post.tags,
        href: `/posts/#${encodeURIComponent(post.id)}`
      });
    }
  }

  for (const asset of assets) {
    const parts = [asset.title, asset.description || '', asset.fileName, asset.path, ...asset.tags];
    if (matches(parts)) {
      results.push({
        id: asset.id,
        type: 'asset',
        title: asset.title,
        excerpt: asset.description || asset.path,
        tags: asset.tags,
        href: `/archive/#${encodeURIComponent(asset.id)}`
      });
    }
  }

  return results;
}
