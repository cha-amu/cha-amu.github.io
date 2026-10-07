// Manual browser fixture: node tests/wiki-preview.mjs (never included in dist).
// WIKI_FIXTURE_MODE=empty|error and WIKI_FIXTURE_CROSS_ORIGIN=1 cover failure/iframe cases.
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';

const blogOrigin = 'http://localhost:5186';
const wikiOrigin = process.env.WIKI_FIXTURE_CROSS_ORIGIN ? 'http://localhost:5187' : blogOrigin;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/public-wiki.json', import.meta.url), 'utf8'));
Object.assign(process.env, {
  VITE_API_URL: `${blogOrigin}/__fixture__/api`,
  VITE_STORAGE_BASE_URL: blogOrigin,
  VITE_STORAGE_POSTS_MANIFEST_URL: `${blogOrigin}/__fixture__/posts.json`,
  VITE_ARCHIVE_MANIFEST_URL: `${blogOrigin}/__fixture__/assets.json`,
  VITE_WIKI_EMBED_URL: `${wikiOrigin}/amuwiki/`,
  VITE_WIKI_INDEX_URL: `${blogOrigin}/__fixture__/wiki.json`
});
const posts = ['connected', 'unconnected', 'missing-document', 'missing-resource'].map((id, index) => ({
  id, path: `posts/${id}.md`, title: `Fixture ${id}`, body: '---\nstatus: published\n---\n# Fixture body\n\n' + 'Scroll preservation fixture.\n\n'.repeat(22),
  tags: ['fixture'], status: 'published', createdAt: `2026-10-0${7 - index}`
}));
const assets = ['connected-asset', 'unconnected-asset'].map((id) => ({
  id, title: `Fixture ${id}`, path: 'assets/ui/guestbook-icon.png', imageUrl: `${blogOrigin}/assets/ui/guestbook-icon.png`,
  description: 'Fixture asset description.\n\n'.repeat(12), tags: ['fixture'], status: 'visible'
}));

function middleware(req, res, next = () => { res.statusCode = 404; res.end(); }) {
  const url = new URL(req.url, blogOrigin);
  const json = (value, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/__fixture__/api') {
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      json({ ok: true, data: [] });
    });
  } else if (url.pathname === '/__fixture__/posts.json') json({ posts });
  else if (url.pathname === '/__fixture__/assets.json') json({ version: 1, assets });
  else if (url.pathname === '/__fixture__/wiki.json') {
    if (process.env.WIKI_FIXTURE_MODE === 'error') json({}, 503);
    else json(process.env.WIKI_FIXTURE_MODE === 'empty' ? { ...fixture, documents: [], resources: [] } : fixture);
  } else if (url.pathname === '/amuwiki/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A focus/navigation stub, deliberately not a second graph implementation.
    res.end(`<!doctype html><html lang="en"><title>Wiki iframe test fixture</title><style>body{font:16px system-ui;background:#f0f7f1;padding:16px;margin:0}a,button{display:block;margin:12px 0}</style><p id="scope"></p><a href="${blogOrigin}/wiki/#wiki-one" target="_top">Wiki fixture document</a><button>Iframe focus target</button><script>document.querySelector('#scope').textContent = new URLSearchParams(location.search).get('scope') || 'Graph fixture';document.addEventListener('keydown',event=>{if(event.key==='Escape'&&parent!==window)parent.postMessage({type:'amuwiki:escape'},'${blogOrigin}');});</script></html>`);
  } else next();
}

if (wikiOrigin !== blogOrigin) createHttpServer(middleware).listen(5187, 'localhost');
const server = await createServer({
  server: { host: 'localhost', port: 5186, strictPort: true },
  plugins: [{ name: 'wiki-test-fixtures', configureServer(server) { server.middlewares.use(middleware); } }]
});
await server.listen();
console.log(`Wiki integration fixture: ${blogOrigin}/posts/#connected`);
