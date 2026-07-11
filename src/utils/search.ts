import type { ArchiveAsset, Post, SearchResult } from '../types';
import { normalizeText } from './strings';

const SEARCH_SNIPPET_LENGTH = 180;

function compactSearchText(value: unknown): string {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`#>*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackSnippet(values: unknown[]): string {
  const value = values.map(compactSearchText).find(Boolean) || '';
  if (value.length <= SEARCH_SNIPPET_LENGTH) return value;
  return `${value.slice(0, SEARCH_SNIPPET_LENGTH).trim()}…`;
}

function matchedSnippet(values: unknown[], query: string, fallbackValues: unknown[]): string {
  for (const value of values) {
    const text = compactSearchText(value);
    const matchIndex = normalizeText(text).indexOf(query);
    if (matchIndex < 0) continue;

    const start = Math.max(0, matchIndex - 64);
    const end = Math.min(text.length, matchIndex + query.length + 104);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
  }
  return fallbackSnippet(fallbackValues);
}

export function buildSearchResults(posts: Post[], assets: ArchiveAsset[], query: string): SearchResult[] {
  const q = normalizeText(query);
  if (!q) return [];

  const results: SearchResult[] = [];
  const matches = (parts: string[]) => parts.some((part) => normalizeText(part).includes(q));

  for (const post of posts) {
    const parts = [post.title, post.excerpt || '', post.body, ...post.tags];
    if (matches(parts)) {
      results.push({
        id: post.id,
        type: 'post',
        title: post.title,
        excerpt: matchedSnippet([post.excerpt, post.body], q, [post.excerpt, post.body]),
        tags: post.tags,
        href: `/posts/#${encodeURIComponent(post.id)}`,
        date: post.publishedAt || post.createdAt
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
        excerpt: matchedSnippet([asset.description, asset.fileName, asset.path], q, [asset.description, asset.fileName, asset.path]),
        tags: asset.tags,
        href: `/archive/#${encodeURIComponent(asset.id)}`,
        date: asset.updatedAt || asset.createdAt,
        fileName: asset.fileName,
        imageUrl: asset.imageUrl,
        kind: asset.kind
      });
    }
  }

  return results;
}
