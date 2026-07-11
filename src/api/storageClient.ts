import { config } from '../config';
import { translate } from '../i18n';
import type { Post } from '../types';
import { excerpt } from '../utils/strings';

interface StoragePostEntry {
  id?: string;
  path?: string;
  url?: string;
  title?: string;
  excerpt?: string;
  tags?: string[] | string;
  status?: Post['status'];
  date?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  body?: string;
}

interface StoragePostsManifest {
  version?: number;
  generatedAt?: string;
  posts?: StoragePostEntry[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).map((tag) => tag.trim()).filter(Boolean);
  const text = asString(value).trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return text.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function statusFrom(value: unknown): Post['status'] {
  return value === 'published' || value === 'draft' || value === 'hidden' || value === 'deleted' ? value : 'published';
}

function absoluteStorageUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.replace(/^\/+/, '');
  return `${config.storageBaseUrl}/${path}`;
}

function dirname(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

function idFromPath(pathOrUrl: string): string {
  const withoutQuery = pathOrUrl.split(/[?#]/)[0];
  const normalized = withoutQuery.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '');
  return `post:${normalized}`;
}

function parseFrontmatter(markdown: string): { meta: Record<string, string>; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta: {}, body: markdown };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: markdown };

  const meta: Record<string, string> = {};
  const header = normalized.slice(4, end).trim();
  for (const line of header.split('\n')) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) meta[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return { meta, body: normalized.slice(end + 4).replace(/^\n+/, '') };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: 'GET', cache: 'no-cache' });
  if (!response.ok) throw new Error(`Storage manifest request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { method: 'GET', cache: 'no-cache' });
  if (!response.ok) throw new Error(`Storage post request failed: ${response.status}`);
  return response.text();
}

async function loadStoragePost(entry: StoragePostEntry): Promise<Post | null> {
  const path = asString(entry.path || entry.url).trim();
  const urlSource = asString(entry.url || entry.path).trim();
  if (!path && !urlSource) return null;
  const url = absoluteStorageUrl(urlSource);

  const rawMarkdown = entry.body ?? await fetchText(url);
  const { meta, body } = parseFrontmatter(rawMarkdown);
  const title = asString(entry.title || meta.title).trim() || translate('common.untitled');
  const date = asString(entry.publishedAt || entry.date || meta.publishedAt || meta.date || entry.createdAt || meta.createdAt).trim();
  const publishedAt = asString(entry.publishedAt || meta.publishedAt || date).trim() || undefined;
  const createdAt = asString(entry.createdAt || meta.createdAt || date || new Date().toISOString());
  const updatedAt = asString(entry.updatedAt || meta.updatedAt || publishedAt || createdAt).trim() || undefined;

  return {
    id: asString(entry.id || meta.id).trim() || idFromPath(path || url),
    slug: asString(meta.slug).trim() || undefined,
    title,
    excerpt: asString(entry.excerpt || meta.excerpt).trim() || excerpt(body),
    body,
    tags: normalizeTags(entry.tags ?? meta.tags),
    status: statusFrom(entry.status || meta.status),
    createdAt,
    updatedAt,
    publishedAt,
    source: 'storage',
    storagePath: path || undefined,
    bodyUrl: url,
    markdownBaseUrl: dirname(url),
    markdownRootUrl: config.storageBaseUrl
  };
}

export async function listStoragePosts(): Promise<Post[]> {
  const manifest = await fetchJson<StoragePostsManifest>(config.storagePostsManifestUrl);
  const entries = Array.isArray(manifest.posts) ? manifest.posts : [];
  const posts = await Promise.all(entries.map((entry) => loadStoragePost(entry).catch(() => null)));
  return posts.filter((post): post is Post => Boolean(post));
}
