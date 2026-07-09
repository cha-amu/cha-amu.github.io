# 배포와 GitHub Secrets/Variables 관리

이 문서는 `cha-amu.github.io` 레포를 나중에 다시 배포하거나, GitHub Actions 설정값을 바꿀 때 보는 운영 절차다.

현재 레포:

```txt
https://github.com/cha-amu/cha-amu.github.io
```

현재 사이트:

```txt
https://cha-amu.github.io/
```

## 1. 배포 구조

이 프로젝트는 GitHub Actions workflow 2개로 배포한다.

```txt
.github/workflows/pages.yml       → 사이트 빌드 후 GitHub Pages 배포
.github/workflows/apps-script.yml → Apps Script 코드 배포
.github/workflows/storage-sync.yml → Google Sheets와 cha-amu/storage repo 주기적 동기화
```

### 사이트 배포

- 트리거: `main` 브랜치에 push하거나 수동 실행
- 결과: `https://cha-amu.github.io/` 갱신
- 필요한 GitHub Actions Variables:
  - `VITE_APPS_SCRIPT_URL`
  - `VITE_ARCHIVE_MANIFEST_URL`
  - `VITE_ADMIN_IDLE_TIMEOUT_MS`
  - `VITE_TURNSTILE_SITE_KEY`는 Turnstile 적용 전에는 없어도 됨

### Apps Script 배포

- 트리거: `apps-script/**` 또는 workflow 파일 변경 후 `main`에 push하거나 수동 실행
- 결과: Google Apps Script 코드 갱신
- 필요한 GitHub Actions Secrets:
  - `CLASPRC_JSON`
  - `CLASP_JSON`
  - `APPS_SCRIPT_DEPLOYMENT_ID`
  - `SPREADSHEET_ID`
  - `ADMIN_PASSWORD`는 로컬 없이 GitHub Actions로 관리자 비밀번호를 바꿀 때만 필요
  - `STORAGE_REPO_TOKEN`은 `cha-amu/storage` repo에 push할 수 있는 토큰

`APPS_SCRIPT_DEPLOYMENT_ID`를 넣어두면 기존 `/exec` URL을 유지한 채 배포만 갱신한다. 이 값을 빼면 Actions가 새 Web App deployment를 만들 수 있으므로, 기존 사이트 URL을 유지하려면 보통 넣어둔다.

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
VITE_APPS_SCRIPT_URL=<Apps Script Web App /exec URL>
VITE_STORAGE_BASE_URL=https://cha-amu.github.io/storage
VITE_ARCHIVE_MANIFEST_URL=https://cha-amu.github.io/storage/manifests/assets.json
VITE_STORAGE_POSTS_MANIFEST_URL=https://cha-amu.github.io/storage/manifests/posts.json
VITE_ADMIN_IDLE_TIMEOUT_MS=60000
VITE_TURNSTILE_SITE_KEY=<Turnstile 적용 전에는 만들지 않아도 됨>
```

주의:

- `VITE_`가 붙은 값은 브라우저 번들에 들어가므로 공개값만 넣는다.
- 관리자 비밀번호, clasp 인증 정보, Turnstile secret key는 Variables에 넣지 않는다.

## 4. GitHub Actions Secrets 변경 방법

Secrets는 민감값이다. 등록 후에는 GitHub 화면에서 값을 다시 볼 수 없다. 바꾸려면 새 값으로 덮어쓴다.

경로:

```txt
GitHub repo → Settings → Secrets and variables → Actions → Secrets 탭
```

### 새 Secret 추가

1. **New repository secret** 클릭
2. `Name` 입력
3. `Secret` 입력
4. **Add secret** 클릭

### 기존 Secret 수정

1. Secrets 목록에서 바꿀 항목 오른쪽의 **Update** 클릭
2. 새 값을 입력
3. **Update secret** 클릭

### 현재 필요한 Secrets

```txt
CLASPRC_JSON=<~/.clasprc.json 전체 내용>
CLASP_JSON=<Apps Script 프로젝트 연결 JSON>
APPS_SCRIPT_DEPLOYMENT_ID=<기존 Apps Script Web App deployment id>
SPREADSHEET_ID=<Google Sheet ID>
ADMIN_PASSWORD=<GitHub에서 관리자 비밀번호를 변경할 때 사용할 새 비밀번호>
STORAGE_REPO_TOKEN=<cha-amu/storage repo push 권한 토큰>
```

`SPREADSHEET_ID`는 공개 repo 파일에 적지 않고 Secret으로 둔다. `ADMIN_PASSWORD`는 사이트 빌드나 Apps Script 일반 배포에는 필요 없다. 로컬 `.env`를 잃어버렸거나 GitHub UI만으로 관리자 비밀번호를 바꿔야 할 때 `Update admin password` workflow가 사용한다.

## 5. 각 Secret 값 만드는 법

### 5.1 `CLASPRC_JSON`

`CLASPRC_JSON`은 clasp가 Google 계정으로 Apps Script에 접근하기 위한 OAuth 인증 정보다.

로컬에서 Google 계정 로그인이 필요하다.

```bash
npx @google/clasp login
```

로그인이 끝나면 보통 아래 파일이 생긴다.

```txt
~/.clasprc.json
```

이 파일의 **전체 내용**을 GitHub Secret `CLASPRC_JSON` 값으로 넣는다.

확인만 할 때:

```bash
cat ~/.clasprc.json
```

주의:

- 이 값은 민감정보다. README, 이슈, 커밋에 붙이면 안 된다.
- Google 계정을 바꾸거나 clasp 로그인이 깨지면 이 Secret을 새 값으로 다시 등록한다.

### 5.2 `CLASP_JSON`

`CLASP_JSON`은 어떤 Apps Script 프로젝트에 코드를 push할지 알려주는 값이다.

현재 로컬 `.clasp.json`에는 로컬 작업 경로용 값이 들어있다. GitHub Actions에서는 `apps-script` 폴더 안에서 clasp를 실행하므로 `rootDir`을 `.`로 둔다.

형식:

```json
{
  "scriptId": "<Apps Script 프로젝트 ID>",
  "rootDir": ".",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [],
  "skipSubdirectories": false
}
```

`scriptId` 확인 방법:

1. https://script.google.com/ 접속
2. 해당 프로젝트 열기
3. 왼쪽 톱니바퀴 **Project Settings** 클릭
4. **Script ID** 복사

또는 로컬에 이미 연결돼 있으면:

```bash
cat .clasp.json
```

여기서 `scriptId`만 확인하고, GitHub Secret에는 위 형식처럼 `rootDir`을 `.`로 맞춰 넣는다.

### 5.3 `APPS_SCRIPT_DEPLOYMENT_ID`

기존 Apps Script Web App URL을 계속 유지하려면 필요하다.

현재 Web App URL이 아래처럼 생겼다면:

```txt
https://script.google.com/macros/s/<여기가 deployment id>/exec
```

`/s/`와 `/exec` 사이 값이 `APPS_SCRIPT_DEPLOYMENT_ID`다.

로컬 clasp로도 확인할 수 있다.

```bash
npx @google/clasp deployments
```

목록에서 현재 웹앱 URL에 해당하는 `AKfy...` 값을 `APPS_SCRIPT_DEPLOYMENT_ID`로 넣는다.


### 5.4 `SPREADSHEET_ID`

Google Sheet URL이 아래처럼 생겼다면:

```txt
https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
```

`/d/`와 `/edit` 사이 값이 `SPREADSHEET_ID`다.

주의:

- 이 값은 비밀번호급 secret은 아니지만 공개 repo에는 적지 않는다.
- GitHub Actions에서는 Repository Secret `SPREADSHEET_ID`로 넣는다.
- Apps Script 런타임에서는 Script Properties `SPREADSHEET_ID`로 읽는다.

## 6. 배포 실행 방법

### 6.1 코드 수정 후 자동 배포

일반적으로는 아래 흐름이다.

```bash
git add .
git commit -m "..."
git push origin main
```

그러면 GitHub Actions가 자동으로 실행된다.

확인 경로:

```txt
GitHub repo → Actions
```

- 사이트만 바뀌면 `Deploy site to GitHub Pages` 확인
- Apps Script도 바뀌면 `Deploy Apps Script` 확인

### 6.2 수동으로 사이트 다시 배포

1. GitHub repo 접속
2. 상단 **Actions** 클릭
3. 왼쪽 workflow 목록에서 **Deploy site to GitHub Pages** 클릭
4. 오른쪽 **Run workflow** 클릭
5. Branch가 `main`인지 확인
6. 초록색 **Run workflow** 버튼 클릭

### 6.3 수동으로 Apps Script 다시 배포

1. GitHub repo 접속
2. 상단 **Actions** 클릭
3. 왼쪽 workflow 목록에서 **Deploy Apps Script** 클릭
4. 오른쪽 **Run workflow** 클릭
5. Branch가 `main`인지 확인
6. 초록색 **Run workflow** 버튼 클릭

완료 후 `Deploy Apps Script`가 success인지 확인한다.

## 7. 관리자 비밀번호 변경 방법

관리자 비밀번호 변경 방법은 2개다.

- 로컬 `.env`가 있으면 로컬에서 변경
- 로컬 자료가 없어졌으면 GitHub Secret + 수동 workflow로 변경

원문 비밀번호는 repo 파일에 저장하지 않는다.

### 7.1 로컬 `.env`가 있을 때

1. 로컬 `.env` 파일에서 아래 값 변경

```txt
ADMIN_PASSWORD=<새 관리자 비밀번호>
```

2. 로컬에서 실행

```bash
npm run sync:apps-script-env
```

이 명령이 하는 일:

- `ADMIN_PASSWORD_HASH` 생성
- `ADMIN_PASSWORD_PEPPER` 생성 또는 유지
- `ADMIN_SESSION_SECRET` 생성 또는 유지
- `GUESTBOOK_SERVER_PEPPER` 생성 또는 유지
- `.env`의 `SPREADSHEET_ID`를 Apps Script Properties에 반영
- Apps Script Properties에 반영

주의:

- `.env`는 `.gitignore`에 들어있고 커밋하면 안 된다.
- `ADMIN_PASSWORD`에 `VITE_` 접두사를 붙이면 브라우저에 노출되므로 절대 쓰지 않는다.

### 7.2 로컬 `.env`가 없어졌을 때: GitHub UI만으로 변경

로컬 자료를 잃어버렸거나 다른 컴퓨터에서 비밀번호만 바꿔야 하면 아래 방식으로 한다.

1. GitHub repo 접속

```txt
https://github.com/cha-amu/cha-amu.github.io
```

2. 새 관리자 비밀번호를 Secret으로 넣기

```txt
Settings → Secrets and variables → Actions → Secrets 탭
```

- 이미 `ADMIN_PASSWORD`가 있으면 오른쪽 **Update** 클릭
- 없으면 **New repository secret** 클릭

입력값:

```txt
Name: ADMIN_PASSWORD
Secret: <새 관리자 비밀번호>
```

3. 비밀번호 갱신 workflow 실행

```txt
Actions → Update admin password → Run workflow → Branch: main → Run workflow
```

4. workflow가 success인지 확인

```txt
Actions → Update admin password → 가장 최근 실행 → success
```

이 workflow가 하는 일:

- GitHub Secret `ADMIN_PASSWORD`와 `SPREADSHEET_ID`를 읽음
- hash/pepper/session secret을 생성 또는 갱신
- Apps Script Properties에 반영
- 기존 Apps Script Web App deployment id를 유지한 채 임시 설정 endpoint를 열었다 닫음

5. `/admin/`에서 새 비밀번호로 로그인 확인

```txt
https://cha-amu.github.io/admin/
```

선택 사항:

- 원문 비밀번호를 GitHub Secret에 계속 두기 싫으면 workflow 성공 후 `Settings → Secrets and variables → Actions → Secrets`에서 `ADMIN_PASSWORD`를 삭제해도 된다.
- 다음에 또 GitHub UI로 비밀번호를 바꾸려면 `ADMIN_PASSWORD`를 다시 만들어야 한다.
- `SPREADSHEET_ID`는 workflow 실행에 계속 필요하므로 삭제하지 않는다.

## 8. Apps Script Properties를 GitHub UI에서 바꾸는 게 아닌 이유

Apps Script 런타임 비밀값은 GitHub repo의 Secrets와 별개다.

- GitHub Secrets: GitHub Actions가 배포할 때 쓰는 값
- Apps Script Properties: 실제 Apps Script API가 실행 중에 읽는 값

예를 들어 관리자 비밀번호 hash, pepper, session secret은 Apps Script Properties에 있어야 한다. 그래서 관리자 비밀번호를 바꿀 때는 `npm run sync:apps-script-env`로 Apps Script Properties를 갱신한다.

## 9. 배포 후 확인할 것

사이트 확인:

```txt
https://cha-amu.github.io/
https://cha-amu.github.io/posts/
https://cha-amu.github.io/guestbook/
https://cha-amu.github.io/archive/
https://cha-amu.github.io/admin/
```

Apps Script health 확인:

```txt
<Apps Script Web App URL>?action=health
```

정상 응답 예:

```json
{
  "ok": true,
  "data": {
    "name": "cha-amu-api",
    "sheets": [
      { "name": "posts", "exists": true }
    ]
  }
}
```

## 10. 자주 생기는 문제

### `Update admin password`가 실패함

확인할 것:

- GitHub Secret `ADMIN_PASSWORD`가 있는지 확인
- GitHub Secret `CLASPRC_JSON`이 있는지 확인
- GitHub Secret `CLASP_JSON`이 있는지 확인
- GitHub Secret `APPS_SCRIPT_DEPLOYMENT_ID`가 기존 `/exec` URL의 deployment id와 같은지 확인
- `CLASP_JSON`의 `scriptId`가 현재 Apps Script 프로젝트 ID인지 확인

### Actions에서 `Deploy Apps Script`가 실패함

대부분 아래 중 하나다.

- `CLASPRC_JSON` 누락 또는 만료
- `CLASP_JSON`의 `scriptId`가 틀림
- `CLASP_JSON`의 `rootDir`이 `.`가 아님
- `APPS_SCRIPT_DEPLOYMENT_ID`가 잘못됨
- Google 계정에 Apps Script 프로젝트 권한이 없음

### 사이트는 배포됐는데 API가 안 붙음

확인할 것:

- GitHub Variables의 `VITE_APPS_SCRIPT_URL`이 현재 `/exec` URL인지 확인
- Variables 수정 후 `Deploy site to GitHub Pages` workflow를 다시 실행했는지 확인
- Apps Script URL의 health endpoint가 정상인지 확인

### 관리자 로그인이 안 됨

확인할 것:

- Apps Script Properties에 `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_PEPPER`, `ADMIN_SESSION_SECRET`이 있는지 확인
- 로컬에서 `npm run sync:apps-script-env`를 다시 실행했는지 확인
- Apps Script Web App 배포가 최신 코드인지 확인
