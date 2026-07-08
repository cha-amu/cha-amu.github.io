import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const canonicalRoutes = new Set(['/posts', '/guestbook', '/archive', '/search', '/admin']);

function redirectCanonicalRoute(req: { url?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: () => void }, next: () => void) {
  const originalUrl = req.url || '';
  const [pathname, suffix = ''] = originalUrl.split(/(?=[?#])/);
  if (canonicalRoutes.has(pathname)) {
    res.statusCode = 302;
    res.setHeader('Location', `${pathname}/${suffix}`);
    res.end();
    return;
  }
  next();
}

function trailingSlashRedirect(): Plugin {
  return {
    name: 'cha-amu-trailing-slash-redirect',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(redirectCanonicalRoute);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(redirectCanonicalRoute);
    }
  };
}

export default defineConfig({
  plugins: [trailingSlashRedirect(), react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        posts: resolve(__dirname, 'posts/index.html'),
        guestbook: resolve(__dirname, 'guestbook/index.html'),
        archive: resolve(__dirname, 'archive/index.html'),
        search: resolve(__dirname, 'search/index.html'),
        admin: resolve(__dirname, 'admin/index.html')
      }
    }
  }
});
