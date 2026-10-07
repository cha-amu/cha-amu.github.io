# 배포와 비밀값 관리

이 문서는 `cha-amu.github.io` 레포를 다시 배포하거나, 설정값과 비밀값을 바꿀 때 보는 운영 절차다.

현재 레포:

```txt
https://github.com/cha-amu/cha-amu.github.io
```

현재 사이트:

```txt
https://cha-amu.github.io/
```

## 1. 배포 구조

2026-10-07부터 이 프로젝트는 두 계층으로 배포한다.

```txt
.github/workflows/pages.yml → 사이트 빌드 후 GitHub Pages 배포
worker/                     → 게이트웨이 Worker(cha-amu-gateway)와 D1(cha-amu-security)
```

방명록, 아무거, 자료 표시 설정, 감사 로그, 요청 제한과 IP 차단 기록은 D1 `cha-amu-security` 하나에 있다. 관리자 로그인은 Worker에서 처리한다. 글은 `cha-amu/storage` repo의 Markdown 파일만을 원본으로 사용한다. frontmatter의 `status: published`만 사이트에 표시하며 `draft`와 `hidden`도 storage repo에서는 공개 파일이다. 글 삭제는 해당 파일을 삭제해 처리한다. 관리자 화면은 자료 탭부터 열리며 자료 표시 설정·아무거·방명록·IP 차단을 관리한다.

`cha-amu/storage`의 `Sync storage repo` workflow는 manifest를 다시 생성하고, 게이트웨이를 통해 D1의 자료 표시 설정만 동기화한다. 규칙은 [storage 작성 문서](storage-authoring.md)를 따른다.

Google Apps Script와 Google Sheets는 2026-10-07 이전 데이터의 백업으로만 남아 있다. 사이트는 더 이상 부르지 않으며, `Deploy Apps Script` workflow는 수동으로만 실행된다. 자세한 내용은 `apps-script/README.md`에 있다.

### 사이트 배포

- 트리거: `main` 브랜치에 push하거나 수동 실행
- 결과: `https://cha-amu.github.io/` 갱신
- 필요한 GitHub Actions Variables:
  - `VITE_API_URL` (기본값: `https://cha-amu-gateway.cha-amu.workers.dev/api`)
  - `VITE_ARCHIVE_MANIFEST_URL`
  - `VITE_ADMIN_IDLE_TIMEOUT_MS`
  - `VITE_TURNSTILE_SITE_KEY` (공개 사이트 키)

### 게이트웨이 Worker와 D1

- Worker: `cha-amu-gateway`, D1: `cha-amu-security`
- 배포: `worker/`에서 `npm ci` 후 `npx wrangler deploy`
- D1 구조 변경: `worker/migrations/`에 SQL 파일을 추가하고 `npm run migrate:remote`
- `0003_drop_post_tables.sql`은 `post_deletions`와 `posts`만 삭제한다. 기존 `0001`, `0002`는 유지한다. 게시글 API를 호출하지 않는 사이트·storage sync·카탈로그와 Worker를 준비한 뒤 운영자가 적용 순서를 정한다.
- 자세한 데이터 구조와 이전 기록: `worker/README.md`

## 2. GitHub 메뉴에서 Secrets/Variables 들어가는 법

1. 브라우저에서 `https://github.com/cha-amu/cha-amu.github.io` 접속
2. 상단 탭에서 **Settings** 클릭
3. 왼쪽 메뉴에서 **Secrets and variables** 클릭
4. 하위 메뉴에서 **Actions** 클릭
5. 화면 안에 두 탭이 있다.
   - **Secrets**: 민감값. 값이 다시 보이지 않는다.
   - **Variables**: 공개 설정값. 값이 보인다.

## 3. GitHub Actions Variables 변경 방법

Variables는 프론트 빌드에 들어가는 공개 설정값이다. 비밀번호/토큰을 넣으면 안 된다.

경로:

```txt
GitHub repo → Settings → Secrets and variables → Actions → Variables 탭
```

### 새 Variable 추가

1. **New repository variable** 클릭
2. `Name` 입력
3. `Value` 입력
4. **Add variable** 클릭

### 기존 Variable 수정

1. Variables 목록에서 바꿀 항목 오른쪽의 연필 아이콘 클릭
2. `Value` 수정
3. **Update variable** 클릭

### 현재 쓰는 Variables

```txt
VITE_API_URL=https://cha-amu-gateway.cha-amu.workers.dev/api
VITE_STORAGE_BASE_URL=https://cha-amu.github.io/storage
VITE_ARCHIVE_MANIFEST_URL=https://cha-amu.github.io/storage/manifests/assets.json
VITE_STORAGE_POSTS_MANIFEST_URL=https://cha-amu.github.io/storage/manifests/posts.json
VITE_ADMIN_IDLE_TIMEOUT_MS=600000
VITE_TURNSTILE_SITE_KEY=0x4AAAAAADzr-jSxSMZf9xcv
```

주의:

- `VITE_`가 붙은 값은 브라우저 번들에 들어가므로 공개값만 넣는다.
- 관리자 비밀번호와 Turnstile secret key는 Variables에 넣지 않는다.


## 4. Worker 비밀값

Worker 비밀값은 GitHub이 아니라 Cloudflare에 있다. `worker/`에서 `npx wrangler secret put <이름>`으로 넣고, 값은 다시 볼 수 없다.

```txt
ADMIN_PASSWORD_HASH      관리자 비밀번호 해시. npm run admin:password가 넣는다.
ADMIN_PASSWORD_PEPPER    관리자 해시용 pepper. 관리자 해시에만 쓰인다.
ADMIN_SESSION_SECRET     관리자 세션 서명 키. 바꾸면 열린 세션이 모두 끊긴다.
GUESTBOOK_SERVER_PEPPER  방명록 삭제 비밀번호 해시용 pepper. 절대 새로 만들지 않는다.
IP_HASH_SECRET           IP HMAC 키. 바꾸면 기존 IP 차단을 확인할 수 없다.
TURNSTILE_SECRET_KEY     Turnstile 서버 키.
STORAGE_SYNC_SECRET      storage 동기화 인증. cha-amu/storage Actions Secret과 같은 값.
```

`GUESTBOOK_SERVER_PEPPER`를 바꾸면 기존 방명록 글을 작성 때의 비밀번호로 지울 수 없다. `IP_HASH_SECRET`을 바꾸면 기존 차단 기록이 어떤 IP의 것인지 알 수 없게 된다. 두 값은 바꾸지 않는다.

비밀값이 아닌 `ADMIN_SESSION_TTL_MS`(10분)와 `GUESTBOOK_PASSWORD_ITERATIONS`는 `worker/wrangler.jsonc`의 `vars`에 있다.

`APPS_SCRIPT_URL`과 `GATEWAY_SHARED_SECRET`은 2026-10-07 이전 Worker 버전용이다. 이전 버전으로 되돌릴 가능성이 없어진 뒤 `npx wrangler secret delete`로 지운다.

## 5. GitHub Actions Secrets

사이트 배포 workflow는 Secret을 쓰지 않는다. 아래 Secret은 백업용 `Deploy Apps Script` workflow에만 쓰이며, Apps Script를 완전히 정리하면 지워도 된다.

```txt
CLASPRC_JSON, CLASP_JSON, APPS_SCRIPT_DEPLOYMENT_ID, SPREADSHEET_ID,
ADMIN_PASSWORD, ADMIN_PASSWORD_PEPPER, ADMIN_SESSION_SECRET,
GATEWAY_SHARED_SECRET, GUESTBOOK_SERVER_PEPPER
```

GitHub Secrets 화면은 `GitHub repo → Settings → Secrets and variables → Actions → Secrets 탭`이다.

## 6. 배포 실행 방법

### 6.1 사이트

`main`에 push하면 `Deploy site to GitHub Pages`가 자동으로 실행된다. 다시 배포하려면 **Actions → Deploy site to GitHub Pages → Run workflow**를 `main`으로 실행한다.

### 6.2 Worker

```sh
cd worker
npm ci
npx wrangler deploy
```

배포하면 새 버전 ID가 출력된다. 문제가 생기면 `npx wrangler deployments list`로 이전 버전을 찾아 `npx wrangler rollback <버전 ID>`로 되돌린다. 되돌리는 것은 코드뿐이고 D1 데이터는 그대로다.

## 7. 관리자 비밀번호 변경 방법

레포 루트의 터미널에서 `npm run admin:password`를 실행하고, 새 비밀번호를 두 번 입력한다. 입력한 글자는 화면에 보이지 않고, 두 입력이 다르면 아무것도 바꾸지 않는다.

스크립트는 `.env`의 `ADMIN_PASSWORD_PEPPER`로 해시를 만들어 Worker의 `ADMIN_PASSWORD_HASH`에 넣는다. 값은 화면에 출력하지 않는다. `.env`가 없거나 pepper가 비어 있으면 새 pepper를 만들어 Worker에 함께 넣고 `.env`에도 저장한다. 관리자 pepper는 관리자 해시에만 쓰이므로 새로 만들어도 다른 데이터에는 영향이 없다. 이미 열린 관리자 세션은 만료될 때까지 유지된다.

`.env`의 `ADMIN_PASSWORD`는 읽지 않는다. 예전 비밀번호가 남아 있을 수 있어서, 실수로 그 값으로 바뀌는 일을 막기 위해서다.

## 8. 배포 후 확인할 것

사이트:

```txt
https://cha-amu.github.io/
https://cha-amu.github.io/posts/
https://cha-amu.github.io/guestbook/
https://cha-amu.github.io/archive/
https://cha-amu.github.io/admin/
```

게이트웨이 상태:

```txt
https://cha-amu-gateway.cha-amu.workers.dev/health
```

글은 storage manifest의 공개 항목과 비교하고, 관리자 화면에 자료·아무거·방명록 탭이 표시되는지 확인한다.

D1 데이터 개수:

```sh
cd worker
npx wrangler d1 execute cha-amu-security --remote --command="SELECT COUNT(*) FROM guestbook_entries; SELECT COUNT(*) FROM things; SELECT COUNT(*) FROM asset_overrides;"
```

## 9. 자주 생기는 문제

### 사이트는 배포됐는데 목록이 안 뜸

- 글은 storage의 `manifests/posts.json`과 Markdown 파일, frontmatter의 `status: published`를 확인

- `https://cha-amu-gateway.cha-amu.workers.dev/health`가 200인지 확인
- GitHub Variables의 `VITE_API_URL`이 Worker `/api` URL인지 확인
- `worker/wrangler.jsonc`의 D1 binding과 `npm run migrate:remote` 적용 여부 확인
- Variables를 바꾼 뒤 사이트 workflow를 다시 실행했는지 확인

### 관리자 로그인이 안 됨

- Worker에 `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_PEPPER`, `ADMIN_SESSION_SECRET`이 있는지 확인(`npx wrangler secret list`)
- Turnstile 위젯 hostname에 `cha-amu.github.io`가 등록됐는지 확인
- `npm run admin:password`로 새 비밀번호를 다시 설정

### 방명록 삭제 비밀번호가 안 맞음

- `GUESTBOOK_SERVER_PEPPER`가 처음 값과 같은지 확인. 바뀌었다면 기존 글은 관리자 화면에서 숨긴다.

### storage 동기화가 실패함

- `cha-amu/storage`의 `STORAGE_SYNC_SECRET`과 Worker 비밀값이 같은지 확인
- `cha-amu/storage → Actions → Sync storage repo`의 로그 확인
