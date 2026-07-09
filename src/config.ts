export const config = {
  appsScriptUrl: import.meta.env.VITE_APPS_SCRIPT_URL || '',
  storageBaseUrl: (import.meta.env.VITE_STORAGE_BASE_URL || 'https://cha-amu.github.io/storage').replace(/\/$/, ''),
  archiveManifestUrl:
    import.meta.env.VITE_ARCHIVE_MANIFEST_URL || 'https://cha-amu.github.io/storage/manifests/assets.json',
  storagePostsManifestUrl:
    import.meta.env.VITE_STORAGE_POSTS_MANIFEST_URL || 'https://cha-amu.github.io/storage/manifests/posts.json',
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY || '',
  adminIdleTimeoutMs: Number(import.meta.env.VITE_ADMIN_IDLE_TIMEOUT_MS || 60_000)
};

export const isAppsScriptConfigured = Boolean(config.appsScriptUrl);
export const isTurnstileConfigured = Boolean(config.turnstileSiteKey);
