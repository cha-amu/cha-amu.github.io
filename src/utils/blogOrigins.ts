// The blog, the storage repository and the wiki publication share one GitHub Pages host.
// The custom domain comes first; cha-amu.github.io serves the same pages if the domain is
// ever removed from the Pages settings, and links written before the move still name it.
export const BLOG_ORIGINS: readonly string[] = ['https://blog.chaamu.net', 'https://cha-amu.github.io'];
export const PRIMARY_BLOG_ORIGIN = BLOG_ORIGINS[0];

export function isBlogOrigin(origin: string): boolean {
  return BLOG_ORIGINS.includes(origin);
}

/** The blog address serving this page, so storage and the wiki are read from the same host.
 * GitHub's redirect between the two addresses carries no CORS header, so a read through it
 * from the other address would fail. Local development falls back to the primary address. */
export function servingBlogOrigin(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return isBlogOrigin(origin) ? origin : PRIMARY_BLOG_ORIGIN;
}

/** Resolves a storage path, and moves a storage URL on either blog address onto `storageBaseUrl`. */
export function storageUrl(pathOrUrl: string, storageBaseUrl: string): string {
  if (!/^https?:\/\//i.test(pathOrUrl)) return `${storageBaseUrl}/${pathOrUrl.replace(/^\/+/, '')}`;
  for (const origin of BLOG_ORIGINS) {
    const root = `${origin}/storage`;
    if (pathOrUrl === root || pathOrUrl.startsWith(`${root}/`)) return `${storageBaseUrl}${pathOrUrl.slice(root.length)}`;
  }
  return pathOrUrl;
}
