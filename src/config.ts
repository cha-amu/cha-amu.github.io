import { DEFAULT_WIKI_BASE_URL, DEFAULT_WIKI_EMBED_URL, DEFAULT_WIKI_INDEX_URL, safeWikiUrl, wikiBaseUrl } from './utils/publicWiki';

const DEFAULT_PRODUCTION_API_URL = 'https://cha-amu-gateway.cha-amu.workers.dev/api';
const explicitApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const gatewayBaseUrl = (import.meta.env.VITE_GATEWAY_URL || '').replace(/\/$/, '');
const configuredGatewayUrl = explicitApiUrl || (gatewayBaseUrl
  ? `${gatewayBaseUrl}${gatewayBaseUrl.endsWith('/api') ? '' : '/api'}`
  : '');
const gatewayUrl = configuredGatewayUrl || DEFAULT_PRODUCTION_API_URL;

export const config = {
  wikiBaseUrl: typeof window === 'undefined' ? DEFAULT_WIKI_BASE_URL : new URL('/wiki/', window.location.origin).href,
  wikiEmbedUrl: wikiBaseUrl(import.meta.env.VITE_WIKI_EMBED_URL || DEFAULT_WIKI_EMBED_URL),
  wikiIndexUrl: safeWikiUrl(import.meta.env.VITE_WIKI_INDEX_URL) || DEFAULT_WIKI_INDEX_URL,
  apiUrl: gatewayUrl,
  gatewayUrl,
  storageBaseUrl: (import.meta.env.VITE_STORAGE_BASE_URL || 'https://cha-amu.github.io/storage').replace(/\/$/, ''),
  archiveManifestUrl:
    import.meta.env.VITE_ARCHIVE_MANIFEST_URL || 'https://cha-amu.github.io/storage/manifests/assets.json',
  storagePostsManifestUrl:
    import.meta.env.VITE_STORAGE_POSTS_MANIFEST_URL || 'https://cha-amu.github.io/storage/manifests/posts.json',
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY || '',
  adminIdleTimeoutMs: Number(import.meta.env.VITE_ADMIN_IDLE_TIMEOUT_MS || 600_000)
};

export const isApiConfigured = Boolean(config.apiUrl);
export const isTurnstileConfigured = Boolean(config.turnstileSiteKey);
