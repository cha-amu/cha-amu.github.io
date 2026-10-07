import {
  isWikiDocumentId,
  isWikiResourceId,
  safeWikiUrl,
  type PublicWikiDocument,
  type PublicWikiIndex,
  type PublicWikiResource
} from './publicWiki';
import { normalizeText } from './strings';
import { renderMarkdown } from './markdown';

export const NATIVE_WIKI_PATH = '/wiki/';
const BLOG_ORIGIN = 'https://cha-amu.github.io';

/** Decode the route once. A document ID itself is never decoded or deprefixed. */
export function wikiDocumentIdFromHash(hash: string): string {
  if (!hash.startsWith('#')) return '';
  try {
    const id = decodeURIComponent(hash.slice(1));
    return isWikiDocumentId(id) ? id : '';
  } catch {
    return '';
  }
}

export function nativeWikiDocumentUrl(id: string): string {
  return isWikiDocumentId(id) ? `${NATIVE_WIKI_PATH}#${encodeURIComponent(id)}` : '';
}

export function findWikiDocument(documents: readonly PublicWikiDocument[], id: string): PublicWikiDocument | null {
  return isWikiDocumentId(id) ? documents.find((document) => document.id === id) || null : null;
}

export function filterWikiDocuments(
  documents: readonly PublicWikiDocument[],
  query: string,
  selectedTags: readonly string[] = []
): PublicWikiDocument[] {
  const normalizedQuery = normalizeText(query);
  return documents.filter((document) => (
    selectedTags.every((tag) => document.tags.includes(tag))
    && (!normalizedQuery || [
      document.id, document.title, document.body, ...document.tags,
      ...document.sources.flatMap((source) => [source.label, source.url])
    ].some((part) => normalizeText(part).includes(normalizedQuery)))
  ));
}

export interface WikiResolvedLink {
  href: string;
  target?: '_self' | '_blank';
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function htmlText(html: string): string {
  return html
    // KaTeX's visually hidden MathML repeats the visible formula.
    .replace(/<math\b[^>]*>[\s\S]*?<\/math>/gi, '')
    .replace(/<\/?(?:p|h[1-6]|pre|div|ul|ol|li|tr|td|th)\b[^>]*>|<br\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
      const named = HTML_ENTITIES[entity.toLowerCase()];
      if (named) return named;
      const code = entity.slice(0, 2).toLowerCase() === '#x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Summarize a document by its opening paragraphs, as rendered: from the first paragraph up
 * to the next heading, so heading text and hrefs never become summary text. Code was escaped
 * by the renderer and is decoded only after tags are removed, preserving literal Markdown/HTML
 * examples. Documents without a paragraph fall back to their body text without headings.
 */
export function wikiExcerpt(markdown: string, options: {
  maxLength?: number;
  resolveLink?: (href: string) => WikiResolvedLink | null;
} = {}): string {
  if (!markdown.trim()) return '';
  const html = renderMarkdown(markdown, { resolveLink: options.resolveLink });
  const opening = html.slice(Math.max(0, html.search(/<p\b/i)));
  const nextHeading = opening.search(/<h[1-6]\b/i);
  const lead = Array.from((nextHeading >= 0 ? opening.slice(0, nextHeading) : opening).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (match) => htmlText(match[1]))
    .filter(Boolean)
    .join(' ');
  const text = lead || htmlText(html.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ' '));
  const characters = Array.from(text);
  const maxLength = options.maxLength ?? 120;
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join('').trimEnd()}…` : text;
}

function blogDetailTarget(url: URL, currentOrigin: string): { kind: 'post' | 'asset'; id: string } | null {
  if ((url.origin !== BLOG_ORIGIN && url.origin !== currentOrigin) || url.hash.length < 2) return null;
  const kind = /^\/posts\/?$/.test(url.pathname) ? 'post' : /^\/archive\/?$/.test(url.pathname) ? 'asset' : null;
  if (!kind) return null;
  try {
    const id = decodeURIComponent(url.hash.slice(1));
    return isWikiResourceId(id) ? { kind, id } : null;
  } catch {
    return null;
  }
}

/** Called for parsed Markdown links, never as a replacement over Markdown text.
 * `visibleResourceKeys` is the set of posts/assets the blog shows now (null while it loads).
 * When given, links to blog posts/assets outside that set resolve to null, so a post hidden
 * after the wiki snapshot was published never appears as a link.
 */
export function createWikiLinkResolver(
  documents: readonly PublicWikiDocument[],
  origin = BLOG_ORIGIN,
  resources: readonly PublicWikiResource[] = [],
  visibleResourceKeys?: ReadonlySet<string> | null
) {
  const ids = new Set(documents.map((document) => document.id));
  const currentOrigin = new URL(origin).origin;
  const resourceLinks = new Map<string, string>();
  for (const resource of resources) {
    const source = safeWikiUrl(resource.url);
    const href = wikiResourceUrl(resource);
    if (source && href) resourceLinks.set(source, href);
  }
  return (href: string): WikiResolvedLink | null => {
    const value = href.trim();
    if (!value || /[\u0000-\u001f\u007f-\u009f\\]/u.test(value)) return null;
    let url: URL;
    try {
      url = new URL(value, `${currentOrigin}${NATIVE_WIKI_PATH}`);
    } catch {
      return null;
    }
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) return null;
    if ((url.origin === BLOG_ORIGIN || url.origin === currentOrigin) && /^\/(wiki|amuwiki)\/?$/.test(url.pathname)) {
      if (!url.hash) return { href: NATIVE_WIKI_PATH, target: '_self' };
      const id = wikiDocumentIdFromHash(url.hash);
      return ids.has(id) ? { href: nativeWikiDocumentUrl(id), target: '_self' } : null;
    }
    const detail = blogDetailTarget(url, currentOrigin);
    if (detail && visibleResourceKeys !== undefined) {
      if (!visibleResourceKeys?.has(`${detail.kind}:${detail.id}`)) return null;
      return { href: `${detail.kind === 'post' ? '/posts/' : '/archive/'}#${encodeURIComponent(detail.id)}`, target: '_self' };
    }
    const resourceHref = resourceLinks.get(url.href);
    if (resourceHref) return { href: resourceHref, target: '_self' };
    return { href: value, target: url.origin === currentOrigin ? '_self' : '_blank' };
  };
}

export interface WikiDocumentConnection {
  document: PublicWikiDocument;
  types: PublicWikiDocument['links'][number]['type'][];
}

/** The public index is authoritative; shared tags or body mentions are not edges. */
export function wikiDocumentRelations(index: PublicWikiIndex, id: string): {
  outgoing: WikiDocumentConnection[];
  backlinks: WikiDocumentConnection[];
  resources: PublicWikiResource[];
} {
  const documents = new Map(index.documents.map((document) => [document.id, document]));
  const selected = documents.get(id);
  if (!selected) return { outgoing: [], backlinks: [], resources: [] };
  const outgoing = new Map<string, WikiDocumentConnection>();
  const backlinks: WikiDocumentConnection[] = [];
  for (const link of selected.links) {
    const target = documents.get(link.target.replace(/^doc:/, ''));
    if (!target) continue;
    const connection = outgoing.get(target.id) || { document: target, types: [] };
    if (!connection.types.includes(link.type)) connection.types.push(link.type);
    outgoing.set(target.id, connection);
  }
  for (const document of index.documents) {
    const types = [...new Set(document.links.filter((link) => link.target.replace(/^doc:/, '') === id).map((link) => link.type))];
    if (types.length) backlinks.push({ document, types });
  }
  return {
    outgoing: [...outgoing.values()],
    backlinks,
    resources: index.resources.filter((resource) => resource.documentIds.includes(id) && safeWikiUrl(resource.url))
  };
}

/** Public resource IDs are the blog detail-route IDs, including asset paths. */
export function wikiResourceUrl(resource: PublicWikiResource): string | null {
  if (!['post', 'asset'].includes(resource.kind) || !isWikiResourceId(resource.id) || !safeWikiUrl(resource.url)) return null;
  const route = resource.kind === 'post' ? '/posts/' : '/archive/';
  return `${route}#${encodeURIComponent(resource.id)}`;
}
