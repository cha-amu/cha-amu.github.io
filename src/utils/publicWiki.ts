export interface PublicWikiDocument {
  id: string;
  title: string;
  kind: 'concept' | 'project' | 'decision' | 'question';
  tags: string[];
  body: string;
  links: { target: string; type: 'related' | 'uses' | 'supports' | 'supersedes' }[];
  sources: { label: string; url: string }[];
  updated: string;
}

export interface PublicWikiResource {
  kind: 'post' | 'asset';
  id: string;
  title: string;
  url: string;
  documentIds: string[];
}

export interface PublicWikiIndex {
  version: 1;
  generatedAt: string;
  documents: PublicWikiDocument[];
  resources: PublicWikiResource[];
}

export const DEFAULT_WIKI_BASE_URL = 'https://cha-amu.github.io/wiki/';
export const DEFAULT_WIKI_EMBED_URL = 'https://cha-amu.github.io/amuwiki/';
export const DEFAULT_WIKI_INDEX_URL = 'https://cha-amu.github.io/amuwiki/wiki.json';
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Fail closed for entries outside the public contract, including private metadata.
function fields(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function shortText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
    && !UNSAFE_TEXT.test(value) && !/[\ud800-\udfff]/u.test(value);
}

export function isWikiDocumentId(value: unknown): value is string {
  return shortText(value, 80) && value === value.trim();
}

export function isWikiResourceId(value: unknown): value is string {
  return shortText(value, 512) && value === value.trim();
}

export function safeWikiUrl(value: unknown): string | null {
  if (!shortText(value, 4096)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function wikiBaseUrl(value: unknown): string {
  const url = new URL(safeWikiUrl(value) || DEFAULT_WIKI_BASE_URL);
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

export function wikiDocumentUrl(baseUrl: string, id: string): string {
  if (!isWikiDocumentId(id)) return wikiBaseUrl(baseUrl);
  return `${wikiBaseUrl(baseUrl)}#${encodeURIComponent(id)}`;
}

export function wikiResourceKey(kind: PublicWikiResource['kind'], id: string): string {
  return `${kind}:${id}`;
}

export interface WikiGraphUrlOptions {
  /** Small inline map in the blog body or sidebar. */
  compact?: boolean;
  lang?: 'ko' | 'en';
  /** Draw only the posts/assets the blog reports as currently visible. */
  parentResources?: boolean;
}

export function wikiGraphUrl(
  baseUrl: string,
  kind: 'doc' | 'post' | 'asset' | 'all',
  id: string,
  scope: 'local' | 'all',
  options: WikiGraphUrlOptions = {}
): string {
  if (!['doc', 'post', 'asset', 'all'].includes(kind)) return '';
  if (kind === 'doc' ? !isWikiDocumentId(id) : kind !== 'all' && !isWikiResourceId(id)) return '';
  const url = new URL(wikiBaseUrl(baseUrl));
  url.searchParams.set('embed', 'graph');
  if (kind !== 'all') url.searchParams.set('focus', `${kind}:${id}`);
  url.searchParams.set('scope', kind === 'all' ? 'all' : scope);
  if (options.parentResources) url.searchParams.set('resources', 'parent');
  if (options.compact) url.searchParams.set('compact', '1');
  if (options.lang === 'en') url.searchParams.set('lang', 'en');
  return url.href;
}

function parseDocument(value: unknown): PublicWikiDocument | null {
  if (!record(value) || !fields(value, ['id', 'title', 'kind', 'tags', 'body', 'links', 'sources', 'updated'])) return null;
  if (!isWikiDocumentId(value.id) || !shortText(value.title, 300)
    || !['concept', 'project', 'decision', 'question'].includes(String(value.kind))
    || !Array.isArray(value.tags) || value.tags.length > 100
    || !value.tags.every((tag) => shortText(tag, 100))
    || typeof value.body !== 'string' || value.body.length > 1_000_000
    || !Array.isArray(value.links) || !Array.isArray(value.sources)
    || typeof value.updated !== 'string' || value.updated.length > 80) return null;

  const links: PublicWikiDocument['links'] = [];
  for (const link of value.links) {
    if (!record(link) || !fields(link, ['target', 'type']) || typeof link.target !== 'string'
      || !isWikiDocumentId(link.target.replace(/^doc:/, ''))
      || !['related', 'uses', 'supports', 'supersedes'].includes(String(link.type))) continue;
    links.push({ target: link.target, type: link.type as PublicWikiDocument['links'][number]['type'] });
  }
  const sources: PublicWikiDocument['sources'] = [];
  for (const source of value.sources) {
    if (!record(source) || !fields(source, ['label', 'url']) || !shortText(source.label, 300)) continue;
    const url = safeWikiUrl(source.url);
    if (url) sources.push({ label: source.label.trim(), url });
  }
  return {
    id: value.id, title: value.title.trim(), kind: value.kind as PublicWikiDocument['kind'],
    tags: [...new Set((value.tags as string[]).map((tag) => tag.trim()))], body: value.body,
    links, sources, updated: Number.isFinite(Date.parse(value.updated)) ? value.updated : ''
  };
}

export function parsePublicWikiIndex(value: unknown): PublicWikiIndex | null {
  if (!record(value) || !fields(value, ['version', 'generatedAt', 'documents', 'resources'])
    || value.version !== 1 || !shortText(value.generatedAt, 80)
    || !Array.isArray(value.documents) || value.documents.length > 20_000
    || !Array.isArray(value.resources) || value.resources.length > 40_000) return null;

  const documents: PublicWikiDocument[] = [];
  const ids = new Set<string>();
  for (const candidate of value.documents) {
    const document = parseDocument(candidate);
    if (!document || ids.has(document.id)) continue;
    ids.add(document.id);
    documents.push(document);
  }
  for (const document of documents) {
    document.links = document.links.filter((link) => ids.has(link.target.replace(/^doc:/, '')));
  }

  const resources: PublicWikiResource[] = [];
  const keys = new Set<string>();
  for (const candidate of value.resources) {
    if (!record(candidate) || !fields(candidate, ['kind', 'id', 'title', 'url', 'documentIds'])
      || (candidate.kind !== 'post' && candidate.kind !== 'asset')
      || !isWikiResourceId(candidate.id) || !shortText(candidate.title, 300)
      || !Array.isArray(candidate.documentIds)) continue;
    const url = safeWikiUrl(candidate.url);
    const key = `${candidate.kind}:${candidate.id}`;
    if (!url || keys.has(key)) continue;
    keys.add(key);
    resources.push({
      kind: candidate.kind, id: candidate.id, title: candidate.title.trim(), url,
      documentIds: [...new Set(candidate.documentIds.filter((id): id is string => isWikiDocumentId(id) && ids.has(id)))]
    });
  }
  return { version: 1, generatedAt: value.generatedAt, documents, resources };
}

export function connectedWikiResource(index: PublicWikiIndex | null, kind: PublicWikiResource['kind'], id: string) {
  if (!index || !isWikiResourceId(id)) return null;
  const ids = new Set(index.documents.map((document) => document.id));
  return index.resources.find((resource) => resource.kind === kind && resource.id === id
    && resource.documentIds.some((documentId) => ids.has(documentId))) || null;
}

function isWikiFrameMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frameWindow: Window | null, baseUrl: string, type: string) {
  return Boolean(frameWindow) && event.source === frameWindow && event.origin === new URL(wikiBaseUrl(baseUrl)).origin
    && record(event.data) && event.data.type === type;
}

export function isWikiEscapeMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frameWindow: Window | null, baseUrl: string) {
  return isWikiFrameMessage(event, frameWindow, baseUrl, 'amuwiki:escape');
}

/** The embed asks for the visible resource list once it can receive it. */
export function isWikiReadyMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frameWindow: Window | null, baseUrl: string) {
  return isWikiFrameMessage(event, frameWindow, baseUrl, 'amuwiki:ready');
}
