# 채아무

GitHub Pages에 배포할 개인용 자료 아카이브 사이트입니다.

## Stack

- Vite + React + TypeScript
- GitHub Pages static hosting
- Google Apps Script + Google Sheets API backend
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

Only public frontend values go into Vite env files. Secrets belong in GitHub Actions Secrets and Apps Script Properties.

## Public wiki integration

`VITE_WIKI_BASE_URL` defaults to `https://cha-amu.github.io/amuwiki/` and `VITE_WIKI_INDEX_URL` to `https://cha-amu.github.io/amuwiki/wiki.json`. Override both with absolute HTTP(S) URLs when previewing the independent wiki locally. Wiki links use native navigation, including when the blog and wiki share an origin.

Only the version 1 public index is fetched, without credentials or persisted caching. A post/asset graph appears only when its exact `kind` and `id` match a resource whose `documentIds` contain an existing public document. Tags never create relationships. Invalid entries are excluded; failed or invalid index requests hide graphs and report a partial search result. Graph rendering belongs to the wiki iframe; this repo does not contain a graph implementation or publish wiki documents.

The iframe receives `?embed=graph&focus=post:<id>&scope=local` (or `asset:<id>`); the overlay uses `scope=all`. Document links in the wiki embed must target `_top`. For Escape while focused inside a cross-origin iframe, the wiki embed must send `parent.postMessage({ type: 'amuwiki:escape' }, '<blog origin>')` on `keydown` with `key === 'Escape'`. The blog accepts this only from the active iframe and the configured wiki origin. Same-origin embeds also have a direct Escape listener.

Run `npm test` and `npm run build` for validation. `node tests/wiki-preview.mjs` serves disposable blog/index/iframe fixtures at `http://localhost:5186/`, with no production data or writes. `WIKI_FIXTURE_CROSS_ORIGIN=1` serves the iframe on port 5187; `WIKI_FIXTURE_MODE=empty` or `error` checks empty/failed indexes. The iframe fixture is a focus/navigation stub, so actual graph rendering must be checked against the independent wiki app during integration. Check `/posts/#connected`, `#unconnected`, `#missing-document`, `#missing-resource`, `/archive/#connected-asset`, and `/search/?q=fixture`; verify modal Tab/Escape, focus return, unchanged scroll, and native wiki navigation.


## Deployment / 운영

배포, GitHub Actions Secrets/Variables 변경, Apps Script 배포, 관리자 비밀번호 변경 절차는 아래 문서를 따른다.

- [배포와 GitHub Secrets/Variables 관리](docs/deployment.md)
- [storage repo 포스트/자료 작성 규칙](docs/storage-authoring.md)

현재 GitHub 레포는 `cha-amu/cha-amu.github.io`이고, 사이트는 `https://cha-amu.github.io/`로 배포된다. 정적 포스트/자료 원본과 미러는 `cha-amu/storage` repo를 사용한다.

관리자 비밀번호는 두 방식으로 바꿀 수 있다.

- 로컬 `.env`가 있으면 `.env`의 `ADMIN_PASSWORD` 수정 후 `npm run sync:apps-script-env`
- 로컬 자료가 없으면 GitHub `ADMIN_PASSWORD` Secret을 만들고 **Actions → Update admin password → Run workflow** 실행

## Runtime data behavior

Public posts, guestbook entries, and archive manifest data use browser `localStorage` plus an in-memory SPA public data store. The app preloads public data once at startup, pages render cached/in-memory data immediately, and Apps Script refreshes run in the background. Apps Script also caches public list responses with `CacheService` and invalidates those caches on writes. Guestbook create/delete uses optimistic UI and rolls back on failure.

The project intentionally does not create GitHub commits for each guestbook write.
