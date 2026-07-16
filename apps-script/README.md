# Apps Script 연결 절차

연결할 Google Sheet:

```txt
SPREADSHEET_ID=<SPREADSHEET_ID>
```

## 1. Apps Script 프로젝트 생성

1. https://script.google.com/ 접속
2. 새 프로젝트 생성
3. `apps-script/Code.js` 내용을 `Code.gs`에 붙여넣기
4. `apps-script/appsscript.json` 내용을 매니페스트에 반영

GitHub Actions + clasp 배포를 쓸 경우에는 `CLASPRC_JSON`, `CLASP_JSON`를 GitHub Secrets에 설정한 뒤 `.github/workflows/apps-script.yml`로 푸시/배포한다. 기존 웹앱 배포를 계속 갱신하려면 `APPS_SCRIPT_DEPLOYMENT_ID`도 추가한다.


## GitHub Actions로 Apps Script 배포하는 방식

수동으로 Apps Script 편집기에 붙여넣지 않고 GitHub에서 배포하려면 아래 Secret이 필요하다.

```txt
CLASPRC_JSON=<Google OAuth 인증 정보. 로컬 clasp login 후 생성되는 ~/.clasprc.json 내용>
CLASP_JSON={"scriptId":"<Apps Script 프로젝트 ID>","rootDir":"."}
APPS_SCRIPT_DEPLOYMENT_ID=<기존 웹앱 deployment id. 있으면 같은 /exec 배포를 갱신>
```

흐름:

1. Google 계정으로 Apps Script 프로젝트를 한 번 만든다.
2. 그 프로젝트 ID로 `CLASP_JSON`을 만든다.
3. `CLASPRC_JSON`에는 clasp OAuth 인증값을 넣는다.
4. GitHub Actions가 `apps-script/Code.js`를 push한다.
5. Actions가 Apps Script 버전을 만들고,
   - `APPS_SCRIPT_DEPLOYMENT_ID`가 있으면 기존 웹앱 배포를 갱신한다.
   - 없으면 첫 배포를 새로 만든다.

즉, GitHub에서 배포할 수는 있지만 Google OAuth 인증값과 Apps Script 프로젝트 ID는 한 번 필요하다.

## 2. 최초 시트 초기화

Apps Script 편집기에서 아래 함수를 한 번 실행한다.

```js
setupChaAmu
```

이 함수가 하는 일:

- Script Properties에 `SPREADSHEET_ID` 저장
- 필요한 시트 생성
  - `posts`
  - `guestbook`
  - `assetOverrides`
  - `settings`
  - `auditLog`
- 각 시트의 헤더 행 생성
- `settings` 기본값 일부 생성

## 3. Script Properties 설정

아래 값은 Apps Script의 Project Settings > Script Properties에 넣는다.

```txt
SPREADSHEET_ID=<SPREADSHEET_ID>
ADMIN_PASSWORD_HASH=<generated>
ADMIN_PASSWORD_PEPPER=<generated>
ADMIN_SESSION_SECRET=<generated>
GUESTBOOK_SERVER_PEPPER=<generated>
GUESTBOOK_PASSWORD_ITERATIONS=1
ADMIN_SESSION_TTL_MS=60000
GATEWAY_SHARED_SECRET=<Worker와 동일한 32자 이상 비밀값>
```

관리자 비밀번호 관련 값은 로컬에서 생성한다.

```bash
npm run secrets:apps-script
```

GitHub Actions로 배포할 때는 `ADMIN_PASSWORD_PEPPER`, `ADMIN_SESSION_SECRET`, `GUESTBOOK_SERVER_PEPPER`도 Repository Secrets에 같은 값으로 보관한다. 특히 `GUESTBOOK_SERVER_PEPPER`를 재생성하면 기존 방명록의 삭제 비밀번호를 더 이상 검증할 수 없다.

## 4. 웹앱 배포

Apps Script에서 Deploy > New deployment > Web app:

```txt
Execute as: Me
Who has access: Anyone
```

배포 후 `/exec`로 끝나는 Web App URL을 복사한다.

## 5. 프론트 연결

로컬 `.env` 또는 GitHub Pages Actions Variables에 설정한다.

```txt
VITE_API_URL=https://cha-amu-gateway.cha-amu.workers.dev/api
VITE_TURNSTILE_SITE_KEY=0x4AAAAAADzr-jSxSMZf9xcv
VITE_STORAGE_BASE_URL=https://cha-amu.github.io/storage
VITE_ARCHIVE_MANIFEST_URL=https://cha-amu.github.io/storage/manifests/assets.json
VITE_STORAGE_POSTS_MANIFEST_URL=https://cha-amu.github.io/storage/manifests/posts.json
VITE_ADMIN_IDLE_TIMEOUT_MS=60000
```

## 6. 연결 확인

브라우저에서 확인:

```txt
https://cha-amu-gateway.cha-amu.workers.dev/health
```

응답 예시:

```json
{
  "ok": true,
  "data": {
    "name": "cha-amu-api"
  }
}
```

## 보안 게이트웨이

브라우저는 Apps Script Web App을 직접 호출하지 않는다. 모든 프론트 API 요청은 Cloudflare Worker를 거치며, Apps Script는 공개 조회 외 액션에 `GATEWAY_SHARED_SECRET`을 요구한다. Worker/D1 배포와 비밀값 목록은 `worker/README.md`를 따른다.

## 현재 배포 URL

```txt
https://script.google.com/macros/s/AKfycbwn-qQpt3j2bxyzNtQeKSodJdo0Apvust80TPAxlp7U0jg2bZ0GI0FoJF3c4ZOTnQjt/exec
```

## 관리자 비밀번호 설정

직접 입력할 값은 하나뿐이다. 로컬 `.env`에 관리자 비밀번호만 넣는다.

```txt
ADMIN_PASSWORD=<관리자 로그인 비밀번호>
```

그 다음 아래 명령을 실행하면 hash/pepper/session secret은 자동 생성되고 Apps Script Properties에 자동 반영된다.

```bash
npm run sync:apps-script-env
```

`VITE_` 접두사를 붙이면 프론트 번들에 노출되므로 관리자 비밀번호에는 절대 붙이지 않는다.
