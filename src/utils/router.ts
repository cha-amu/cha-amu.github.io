const CANONICAL_ROUTES = new Set(['/posts', '/guestbook', '/archive', '/search', '/admin']);

export interface AppLocation {
  pathname: string;
  search: string;
  hash: string;
  key: string;
}

export function readAppLocation(): AppLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    key: `${window.location.pathname}${window.location.search}${window.location.hash}`
  };
}

export function canonicalizeUrl(pathname: string, search = '', hash = ''): string {
  const normalizedPath = pathname || '/';
  const path = CANONICAL_ROUTES.has(normalizedPath) ? `${normalizedPath}/` : normalizedPath;
  return `${path}${search}${hash}`;
}

export function canonicalizeCurrentUrl(): boolean {
  const nextUrl = canonicalizeUrl(window.location.pathname, window.location.search, window.location.hash);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return false;
  window.history.replaceState({}, '', nextUrl);
  return true;
}

export function notifyRouteChange() {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateTo(url: string, options: { replace?: boolean } = {}) {
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin) {
    window.location.href = target.href;
    return;
  }

  const nextUrl = canonicalizeUrl(target.pathname, target.search, target.hash);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;

  if (options.replace) window.history.replaceState({}, '', nextUrl);
  else window.history.pushState({}, '', nextUrl);
  notifyRouteChange();
}

export function isPlainInternalNavigation(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  const url = new URL(anchor.href, window.location.href);
  return url.origin === window.location.origin;
}
