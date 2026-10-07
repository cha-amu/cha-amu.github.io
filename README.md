# 채아무

GitHub Pages에 배포할 개인용 자료 아카이브 사이트입니다.

## Stack

- Vite + React + TypeScript
- GitHub Pages static hosting
- Cloudflare Worker gateway (`worker/`) with D1 for guestbook, admin, post status, things and asset override data
- Cloudflare Turnstile for guestbook writes
- Storage manifests from `https://cha-amu.github.io/storage/manifests/*.json`

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Routing

The site is built as a React SPA. `npm run build` emits a single `index.html` and a matching `404.html` fallback so GitHub Pages can handle direct visits such as `/posts/`, `/archive/`, `/guestbook/`, `/search/?q=...`, and `/admin/`. Internal navigation uses the History API to avoid full document reloads.

## Config

Copy `.env.example` to `.env` for local configuration.

Only public frontend values go into Vite env files. Server secrets are Worker secrets (`npx wrangler secret put` in `worker/`); see `worker/README.md`.

## Public wiki integration

The wiki reading screen is this blog's `/wiki/` route. It uses the same header, navigation, content width and article cards as `/posts/`, with its connection map above the existing tag panel. Menu links, search results and wiki document links use the blog router. A separate public repository stores the public snapshot and serves the embeddable graph; repository separation does not create a separate reader website.

`VITE_WIKI_EMBED_URL` defaults to `https://cha-amu.github.io/amuwiki/` and `VITE_WIKI_INDEX_URL` to `https://cha-amu.github.io/amuwiki/wiki.json`. Override these two absolute HTTP(S) URLs for local data/widget previews. Reader links always stay at the current blog's `/wiki/` route.

Only the version 1 public index is fetched, without credentials or persisted caching. A post/asset graph appears only when its exact `kind` and `id` match a resource whose `documentIds` contain an existing public document, and only while that post/asset is in the blog's current public list. Wiki pages likewise list, link and map only posts/assets the blog shows now, so a post hidden after the wiki snapshot was published never appears as a dead link. A document map appears only when the document has at least one connection. Tags never create relationships. Invalid entries are excluded; failed or invalid index requests hide graphs and report a partial search result. Graph rendering belongs to the wiki iframe; this repo does not contain a graph implementation or publish wiki documents.

The iframe receives `?embed=graph&focus=doc:<id>&scope=local` (or `post:<id>` / `asset:<id>`) plus `resources=parent`, `compact=1` for inline maps and `lang=en` in English; the wiki overview and expanded overlay use `scope=all`. When the embed posts `{ type: 'amuwiki:ready' }`, the blog replies with `{ type: 'amuwiki:resources', keys }` listing the visible `post:<id>`/`asset:<id>` keys, and the embed draws no other posts/assets. Messages are accepted only from the active iframe and the configured embed origin. Document links in the embed target the blog's `/wiki/#<id>` with `_top`; in a same-origin embed the blog routes those clicks itself and closes the expanded overlay. For Escape while focused inside a cross-origin iframe, the embed sends `parent.postMessage({ type: 'amuwiki:escape' }, '<blog origin>')`. Same-origin embeds also have a direct Escape listener.

Run `npm test` and `npm run build` for validation. `node tests/wiki-preview.mjs` serves disposable blog/index/iframe fixtures at `http://localhost:5186/`, with no production data or writes. `WIKI_FIXTURE_CROSS_ORIGIN=1` serves the iframe on port 5187; `WIKI_FIXTURE_MODE=empty` or `error` checks empty/failed indexes. The iframe fixture is a focus/navigation stub; actual graph rendering must also be checked against the public graph widget. Verify `/wiki/#wiki-one`, wiki search/body/backlinks, navigation back to posts, header/body alignment, graph placement above tags, and dialog keyboard/focus/scroll restoration.


## Deployment / 운영

배포, GitHub Actions Variables 변경, Worker 비밀값, 관리자 비밀번호 변경 절차는 아래 문서를 따른다.

- [배포와 GitHub Secrets/Variables 관리](docs/deployment.md)
- [storage repo 포스트/자료 작성 규칙](docs/storage-authoring.md)

현재 GitHub 레포는 `cha-amu/cha-amu.github.io`이고, 사이트는 `https://cha-amu.github.io/`로 배포된다. 정적 포스트/자료 원본과 미러는 `cha-amu/storage` repo를 사용한다.

관리자 비밀번호는 로컬 `.env`의 `ADMIN_PASSWORD`에 새 비밀번호를 적고 `npm run admin:password`를 실행해 바꾼다. 게이트웨이 Worker의 `ADMIN_PASSWORD_HASH`가 바뀐다.

## Runtime data behavior

Public posts, guestbook entries, and archive manifest data use browser `localStorage` plus an in-memory SPA public data store. The app preloads public data once at startup, pages render cached/in-memory data immediately, and gateway refreshes run in the background. The gateway reads D1 directly, so a write is visible on the next read. Guestbook create/delete uses optimistic UI and rolls back on failure.

The project intentionally does not create GitHub commits for each guestbook write.
