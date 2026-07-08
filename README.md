# 채아무

GitHub Pages에 배포할 개인용 자료 아카이브 사이트입니다.

## Stack

- Vite + React + TypeScript
- GitHub Pages static hosting
- Google Apps Script + Google Sheets API backend
- Cloudflare Turnstile for guestbook writes
- Image archive manifest from `https://cha-amu.github.io/archive/manifest.json`

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Config

Copy `.env.example` to `.env` for local configuration.

Only public frontend values go into Vite env files. Secrets belong in GitHub Actions Secrets and Apps Script Properties.


## Runtime data behavior

Public posts and guestbook entries use browser `localStorage` as a read-through cache. The page renders cached data immediately, then refreshes from Apps Script in the background and merges the authoritative server list. Guestbook create/delete uses optimistic UI and rolls back on failure.

The project intentionally does not create GitHub commits for each guestbook write.
