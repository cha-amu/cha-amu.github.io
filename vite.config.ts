import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const canonicalRoutes = new Set(['/posts', '/guestbook', '/archive', '/search', '/admin']);
const spaRoutes = new Set(['/', '/posts/', '/guestbook/', '/archive/', '/search/', '/admin/']);

function splitUrl(originalUrl = '') {
  const match = originalUrl.match(/^([^?#]*)(.*)$/);
  return { pathname: match?.[1] || '/', suffix: match?.[2] || '' };
}

function redirectCanonicalRoute(
  req: { url?: string },
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: () => void },
  next: () => void
) {
  const { pathname, suffix } = splitUrl(req.url || '');
  if (canonicalRoutes.has(pathname)) {
    res.statusCode = 302;
    res.setHeader('Location', `${pathname}/${suffix}`);
    res.end();
    return;
  }
  next();
}

function rewriteSpaRoute(req: { url?: string }, _res: unknown, next: () => void) {
  const { pathname, suffix } = splitUrl(req.url || '');
  if (pathname !== '/' && spaRoutes.has(pathname)) {
    req.url = `/${suffix}`;
  }
  next();
}

function spaRouting(): Plugin {
  return {
    name: 'cha-amu-spa-routing',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(redirectCanonicalRoute);
      server.middlewares.use(rewriteSpaRoute);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(redirectCanonicalRoute);
      server.middlewares.use(rewriteSpaRoute);
    },
    writeBundle() {
      const indexPath = resolve(__dirname, 'dist/index.html');
      const fallbackPath = resolve(__dirname, 'dist/404.html');
      if (existsSync(indexPath)) copyFileSync(indexPath, fallbackPath);
    }
  };
}

export default defineConfig({
  plugins: [spaRouting(), react()],
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'index.html')
    }
  }
});
