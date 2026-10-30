import { DEFAULT_WIKI_BASE_URL, safeWikiUrl, wikiBaseUrl } from './utils/publicWiki';
import { servingBlogOrigin } from './utils/blogOrigins';

const DEFAULT_PRODUCTION_API_URL = 'https://cha-amu-gateway.cha-amu.workers.dev/api';
const explicitApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const gatewayBaseUrl = (import.meta.env.VITE_GATEWAY_URL || '').replace(/\/$/, '');
const configuredGatewayUrl = explicitApiUrl || (gatewayBaseUrl
  ? `${gatewayBaseUrl}${gatewayBaseUrl.endsWith('/api') ? '' : '/api'}`
  : '');
const gatewayUrl = configuredGatewayUrl || DEFAULT_PRODUCTION_API_URL;
// Storage and the wiki publication are read from the blog address serving the page.
const blogOrigin = servingBlogOrigin();
const storageBaseUrl = (import.meta.env.VITE_STORAGE_BASE_URL || `${blogOrigin}/storage`).replace(/\/$/, '');

export const config = {
  wikiBaseUrl: typeof window === 'undefined' ? DEFAULT_WIKI_BASE_URL : new URL('/wiki/', window.location.origin).href,
  wikiEmbedUrl: wikiBaseUrl(import.meta.env.VITE_WIKI_EMBED_URL || `${blogOrigin}/amuwiki/`),
  wikiIndexUrl: safeWikiUrl(import.meta.env.VITE_WIKI_INDEX_URL) || `${blogOrigin}/amuwiki/wiki.json`,
  apiUrl: gatewayUrl,
  gatewayUrl,
  storageBaseUrl,
  archiveManifestUrl: import.meta.env.VITE_ARCHIVE_MANIFEST_URL || `${storageBaseUrl}/manifests/assets.json`,
  storagePostsManifestUrl: import.meta.env.VITE_STORAGE_POSTS_MANIFEST_URL || `${storageBaseUrl}/manifests/posts.json`,
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY || '',
  adminIdleTimeoutMs: Number(import.meta.env.VITE_ADMIN_IDLE_TIMEOUT_MS || 600_000)
};

export const isApiConfigured = Boolean(config.apiUrl);
export const isTurnstileConfigured = Boolean(config.turnstileSiteKey);
