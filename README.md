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


## Deployment / 운영

배포, GitHub Actions Secrets/Variables 변경, Apps Script 배포, 관리자 비밀번호 변경 절차는 아래 문서를 따른다.

- [배포와 GitHub Secrets/Variables 관리](docs/deployment.md)

현재 GitHub 레포는 `cha-amu/cha-amu.github.io`이고, 사이트는 `https://cha-amu.github.io/`로 배포된다.

관리자 비밀번호는 두 방식으로 바꿀 수 있다.

- 로컬 `.env`가 있으면 `.env`의 `ADMIN_PASSWORD` 수정 후 `npm run sync:apps-script-env`
- 로컬 자료가 없으면 GitHub `ADMIN_PASSWORD` Secret을 만들고 **Actions → Update admin password → Run workflow** 실행

## Runtime data behavior

Public posts and guestbook entries use browser `localStorage` as a read-through cache. The page renders cached data immediately, then refreshes from Apps Script in the background and merges the authoritative server list. Guestbook create/delete uses optimistic UI and rolls back on failure.

The project intentionally does not create GitHub commits for each guestbook write.
