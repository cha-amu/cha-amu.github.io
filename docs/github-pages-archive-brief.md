# GitHub Pages 자료 아카이브 기획 정리

## 현재 상태

이 문서는 구현물이 아니라, 대화에서 확정된 방향을 기록한 기획 문서다.

기획 내용은 대화에서 확정된 사항을 기준으로 정리한다. 세부 UI 문서는 `docs/ui-spec.md`에 작성되어 있고, 데이터 스키마와 이미지 manifest/override 구조도 이 문서에 확정값으로 기록되어 있다.

## 만들고 싶은 것

GitHub Pages에 배포할 개인용 자료 아카이브 페이지.

주요 목적은 이미지나 자료를 저장/정리하고, 태그나 이름으로 검색할 수 있게 하는 것이다. 추가로 방문자가 글을 남길 수 있는 방명록과, 작성자가 커밋 없이 Markdown 비슷한 방식으로 글을 작성해서 올릴 수 있는 기능도 필요하다.

## 확정된 방향

- 배포 대상은 GitHub Pages다.
- GitHub 같은 사이트를 만드는 것이 아니라, GitHub Pages에 올릴 웹페이지를 만드는 것이다.
- Firebase, Supabase 같은 전형적인 BaaS는 우선 사용하지 않는다.
- 방명록과 글 저장은 Google Sheets + Google Apps Script 연결 방식을 검토한다.
- 이미지는 사이트 repo와 분리된 이미지 전용 GitHub repo에 저장하고, 사이트에서는 해당 이미지 URL을 링크해서 사용한다.
- Telegram 채널/봇을 이미지 저장소처럼 쓰는 아이디어는 현재 구현 범위에서 제외한다.
- “MVP”가 아니라 배포 가능한 완성본을 목표로 한다.

## 고려 중인 구조

```txt
GitHub Pages
  ├─ 자료/이미지 표시 페이지
  ├─ 태그·이름 검색 UI
  ├─ 방명록 UI
  └─ Markdown 글 작성/조회 UI
        ↓
Google Apps Script Web App
        ↓
Google Sheets
```

## Google Sheets / Apps Script 역할

Google Sheets는 다음 데이터를 저장하는 후보로 본다.

- 자료 메타데이터
  - 이름
  - 설명
  - 태그
  - 이미지 경로 또는 URL
  - 작성일
- 방명록
  - 작성자 이름
  - 메시지
  - 작성일
- 글
  - 제목
  - 본문 Markdown
  - 태그
  - 작성일

Apps Script는 GitHub Pages에서 직접 Google Sheets에 쓰기 권한을 노출하지 않기 위한 중간 API 역할을 한다.

## Telegram 저장소 아이디어

초기 아이디어:

- Telegram 채널을 이미지 저장소처럼 사용한다.
- 봇을 통해 이미지를 올리거나 가져온다.
- 장기적으로 무료 대용량 저장소처럼 활용할 수 있는지 검토한다.

현재 판단:

- 1차 구현 범위에서는 제외한다.
- 무료 무한 용량을 전제로 설계하지 않는다.
- Telegram Bot API의 파일 크기 제한, 링크 만료, 정책 변경, 계정/채널 리스크가 있다.
- 나중에 별도 실험 과제로 분리해서 검토한다.

## 주요 설계 결정

### 구현 언어 / 프레임워크

스택은 공개 페이지와 관리자 페이지를 억지로 분리하지 않고, 하나로 통일하는 방향이 더 낫다.

확정된 방향:

```txt
Frontend: Vite + React + TypeScript
Deploy: GitHub Pages 정적 배포
Backend: Google Apps Script
Data: Google Sheets
Image hosting: 별도 이미지 전용 GitHub Pages repo
```

이유:

- 관리자 페이지는 필수이고, 상태 관리가 단순하지 않다.
- 관리자 기능에는 글 작성/수정/삭제, 자료 추가/수정/삭제, 방명록 숨김/삭제, Markdown 미리보기, 저장 상태, 에러 처리 등이 필요하다.
- 이 정도 관리자 화면을 Vanilla JS로 오래 유지하면 코드가 커지고 꼬일 가능성이 있다.
- 어차피 React/TypeScript를 관리자에 도입한다면 공개 페이지와 관리자 페이지를 서로 다른 방식으로 관리할 이유가 크지 않다.
- React + TypeScript로 통일하면 컴포넌트, 타입, API 클라이언트, 폼 처리, 에러 처리 방식을 공유할 수 있다.
- Next.js나 Astro까지는 필요 없지만, Vite + React + TypeScript 정도는 과한 프레임워크라기보다 정적 사이트용 빌드 도구와 UI 구조화 도구로 볼 수 있다.

#### 라우팅/배포 원칙

GitHub Pages에서 새로고침과 직접 접근이 동작하면서도 페이지 이동 깜빡임을 줄이기 위해 React SPA와 `404.html` fallback을 사용한다.

확정 경로:

```txt
/
/posts/
/guestbook/
/archive/
/admin/
/search/
```

구현 방식:

- React SPA + `404.html` fallback 방식으로 확정한다.
- 하나의 앱 엔트리에서 클라이언트 라우팅을 처리한다.
- GitHub Pages는 서버 rewrite가 없으므로 빌드 시 `dist/index.html`을 `dist/404.html`로 복사한다.
- `/posts/`, `/guestbook/`, `/archive/`, `/admin/`, `/search/` 직접 입력/새로고침은 fallback HTML을 받은 뒤 React 라우터가 현재 주소를 읽어 해당 화면을 렌더링한다.
- `/posts`처럼 trailing slash가 빠진 경로는 앱/로컬 미들웨어에서 `/posts/`로 보정한다.

#### 예상 파일 구조

```txt
/index.html              # 단일 SPA entry
/404.html                # GitHub Pages 직접 URL fallback; 빌드 산출물에서 index와 동일
/src/
  api/
    appsScriptClient.ts
  components/
    Header.tsx
    SearchBox.tsx
    MarkdownView.tsx
    Toast.tsx
    ConfirmDialog.tsx
  main.tsx              # SPA router
  entries/              # route component implementations
    home.tsx
    posts.tsx
    guestbook.tsx
    archive.tsx
    admin.tsx
    search.tsx
  styles/
    main.css
  types/
    asset.ts
    post.ts
    guestbook.ts
```

#### React를 쓰더라도 지켜야 할 것

- SPA로 통합하되 공개 페이지는 읽기/검색 중심으로 가볍게 유지한다.
- 공통 상단 도구와 설정 사이드바는 앱 최상위에서 일관되게 동작해야 한다.
- 관리자 화면은 React의 장점을 적극 사용한다.
- 결제/판매 기능은 직접 구현하지 않고 Fourthwall 같은 외부 서비스 링크를 우선한다.
- GitHub Pages 정적 배포와 Apps Script API 연동이라는 기본 구조를 유지한다.

현재 결론은 “Vite + React + TypeScript로 프론트 스택을 확정하고, Next.js/Astro 같은 상위 프레임워크는 쓰지 않는다”이다.

### 페이지 구조

사이트는 홈, 3개 공개 주요 페이지, 관리자 페이지, 통합 검색 페이지로 나눈다. 주소는 아래 값으로 확정한다. GitHub Pages 호환성과 URL 입력 편의성을 위해 경로는 영문 소문자로 고정한다.

```txt
/
  - 채아무 로고/아이콘
  - 문구: "그냥 아무거나 올리는 채널"
  - 주요 메뉴: [아무글] [방명록] [자료] [검색]
  - 검색 영역

/posts/
  - 상단바: [채아무 로고] [아무글] [방명록] [자료]
  - 본문: 작성자가 올린 글 목록/상세

/guestbook/
  - 상단바: [채아무 로고] [아무글] [방명록] [자료]
  - 본문: 방문자 방명록 목록 + 작성 폼

/archive/
  - 상단바: [채아무 로고] [아무글] [방명록] [자료]
  - 본문: 이미지/자료 목록 + 태그/이름 검색

/admin/
  - 관리자 로그인
  - 아무글 작성/수정/삭제
  - 자료 자동 인덱스 확인/숨김 관리
  - 방명록 글 숨김/삭제

/search/
  - 사이트 전체 통합 검색
  - 아무글 + 자료 검색 결과 표시
```

#### 홈 `/`

홈은 사이트의 입구 역할을 한다.

포함 요소:

- 채아무 로고 또는 간단한 아이콘
- 사이트 설명 문구: `그냥 아무거나 올리는 채널`
- 주요 이동 버튼
  - 아무글
  - 방명록
  - 자료
- 검색 입력창

홈 검색은 `/search/?q=검색어`로 이동하는 전체 통합 검색 진입점으로 둔다.

#### 아무글 페이지 `/posts/`

역할:

- 작성자가 올린 Markdown 기반 글을 보여준다.
- 글 데이터는 Google Sheets + Apps Script에서 불러오는 방향을 검토한다.
- 글 작성/수정/삭제는 공개 페이지가 아니라 `/admin/` 관리자 페이지에서만 한다.

기본 구조:

```txt
상단바
  [채아무 로고] [아무글] [방명록] [자료]

본문
  - 글 목록
  - 글 제목
  - 작성일
  - 태그
  - Markdown 렌더링 본문
```

#### 방명록 페이지 `/guestbook/`

역할:

- 방문자가 글을 남길 수 있다.
- 방명록 데이터는 Google Sheets에 저장하고 Apps Script를 통해 읽고 쓴다.

기본 구조:

```txt
상단바
  [채아무 로고] [아무글] [방명록] [자료]

본문
  - 방명록 목록
  - 이름 입력
  - 메시지 입력
  - 작성 버튼
```

검토 필요:

- 익명 작성 허용 여부
- 스팸 방지 방식
- 삭제/숨김 같은 관리 기능 필요 여부

#### 자료 페이지 `/archive/`

역할:

- 이미지나 자료를 카드/목록 형태로 보여준다.
- 이름, 태그, 설명으로 검색할 수 있다.
- 이미지는 별도 이미지 전용 GitHub Pages repo의 URL을 참조한다.
- 자료 목록은 이미지 전용 repo에서 자동으로 들어오게 한다. Google Sheets는 숨김/표시명/태그 보정 같은 선택적 override에만 사용한다.

기본 구조:

```txt
상단바
  [채아무 로고] [아무글] [방명록] [자료]

본문
  - 검색 입력창
  - 태그 필터
  - 자료 카드 목록
    - 이미지
    - 이름
    - 설명
    - 태그
```

#### 관리자 페이지 `/admin/`

관리자 페이지는 필수다.

역할:

- 관리자 로그인 또는 관리자 인증
- 아무글 작성
- 아무글 수정
- 아무글 삭제/숨김
- 자료 자동 인덱스 확인
- 자료 숨김 관리
- 태그/표시명 보정
- 방명록 글 삭제/숨김
- 태그 정리

기본 구조:

```txt
관리자 로그인 상태 확인

관리 메뉴
  - 아무글 관리
  - 자료 관리
  - 방명록 관리

아무글 관리
  - 제목
  - 본문 Markdown
  - 태그
  - 저장/수정/삭제

자료 관리
  - 이름
  - 설명
  - 태그
  - 이미지 URL
  - 원본 URL
  - 저장/수정/삭제

방명록 관리
  - 목록
  - 숨김/삭제
```

관리자 페이지는 방문자에게 메뉴로 노출하지 않을 수 있다. 예를 들어 `/admin/` 주소를 직접 입력해서 접근하게 하고, 인증에 실패하면 관리자 기능을 보여주지 않는다.

#### 통합 검색 페이지 `/search/`

통합 검색은 별도 페이지로 둔다.

역할:

- 홈 검색창 또는 상단 검색창에서 입력한 검색어를 받아 전체 검색 결과를 보여준다.
- 검색 대상은 아무글과 자료다.
- 방명록은 기본적으로 통합 검색 대상에서 제외한다.

주소 형식:

```txt
/search/?q=검색어
```

검색 대상:

```txt
아무글
  - title
  - body excerpt
  - tags
  - createdAt
  - url

자료
  - name
  - description
  - tags
  - imageUrl
  - url
```

검색 결과 기본 구조:

```txt
검색어 표시
결과 개수

[아무글 결과]
  - 제목
  - 본문 일부
  - 태그
  - 작성일

[자료 결과]
  - 썸네일
  - 이름
  - 설명
  - 태그
```

결과 클릭 시:

```txt
아무글 결과 → /posts/#post-id
자료 결과 → /archive/#asset-id
```

#### 통합 검색 인덱스

SPA 구조에서도 통합 검색은 공통 검색 인덱스/API 응답을 기반으로 처리한다. 검색 URL은 `/search/?q=검색어`를 유지하고 내부 이동은 History API로 처리한다.

검색 인덱스 후보 구조:

```json
[
  {
    "type": "post",
    "id": "post-001",
    "title": "글 제목",
    "text": "본문 일부 또는 검색용 텍스트",
    "tags": ["note"],
    "url": "/posts/#post-001",
    "createdAt": "2026-07-09"
  },
  {
    "type": "asset",
    "id": "asset-001",
    "title": "자료 이름",
    "text": "자료 설명",
    "tags": ["reference"],
    "imageUrl": "https://cha-amu.github.io/archive/images/2026/sample.webp",
    "url": "/archive/#asset-001",
    "createdAt": "2026-07-09"
  }
]
```

인덱스 생성 방식:

- 아무글 데이터는 Google Sheets/App Script에서 가져온다.
- 자료 데이터는 `archive/manifest.json`과 Sheets override를 합쳐 만든다.
- `/search/` 페이지는 이 인덱스를 불러와 클라이언트에서 필터링한다.

구현 후보:

```txt
GET Apps Script?action=searchIndex
```

또는 프론트에서 직접 조합:

```txt
GET Apps Script?action=posts
GET https://cha-amu.github.io/archive/manifest.json
GET Apps Script?action=assetOverrides
→ 프론트에서 searchIndex 구성
```

초기 구현은 단순성을 위해 프론트에서 직접 조합해도 된다. 데이터가 많아지면 Apps Script가 `searchIndex`를 만들어주는 방식으로 옮길 수 있다.

#### 공통 상단바

홈을 제외한 주요 페이지에는 같은 상단바를 둔다.

```txt
[채아무 로고]  [아무글] [방명록] [자료] [검색]
```

상단바 요구사항:

- 로고 클릭 시 홈으로 이동한다.
- 현재 보고 있는 메뉴는 시각적으로 표시한다.
- 모바일에서는 메뉴가 줄바꿈되거나 간단한 메뉴 버튼으로 바뀔 수 있다.

#### 라우팅 방식

확정 경로:

- `/` → 홈
- `/posts/` → 아무글
- `/guestbook/` → 방명록
- `/archive/` → 자료
- `/admin/` → 관리자
- `/search/` → 통합 검색

구현 방식은 단일 SPA entry 방식이다.

```txt
/index.html      # 단일 앱 entry
/404.html        # GitHub Pages 직접 URL fallback; index와 동일한 빌드 산출물
/src/main.tsx    # 현재 pathname/search/hash를 읽어 route component 선택
```

GitHub Pages에서 `/posts/` 같은 직접 URL은 실제 파일이 없어도 `404.html`을 내려주고, React 라우터가 현재 주소를 기준으로 해당 페이지를 렌더링한다. 내부 링크 이동은 History API로 처리해 전체 문서 reload와 화면 깜빡임을 피한다.

### 디자인 방향

디자인 방향은 아래처럼 확정한다.

- 테마는 우선 밝은 테마만 만든다.
- 모바일 우선 설계는 하지 않는다.
- 다만 모바일 환경에서도 모든 핵심 동작은 가능해야 한다.
  - 메뉴 이동
  - 검색
  - 자료 열람
  - 방명록 작성
  - 글 열람
- 카드형 UI를 고집하지 않는다.
- 내용과 맥락에 따라 적합한 UI를 선택한다.
  - 이미지/자료는 카드, 그리드, 목록 중 적합한 형태를 선택한다.
  - 아무글은 글 목록/본문 읽기에 적합한 레이아웃을 우선한다.
  - 방명록은 입력과 읽기가 편한 목록형 UI를 우선한다.

### 권한 / 보안

권한 정책은 아래처럼 확정한다.

#### 방명록

방명록은 방문자가 익명으로 작성할 수 있게 한다.

방명록 작성 시 입력값:

- 이름
  - 실제 로그인 이름이 아니라 사용자가 직접 적는 아무 이름이다.
- 글 내용
- 삭제용 비밀번호
  - 작성자가 나중에 자기 글을 삭제할 때 사용하는 비밀번호다.
  - 공개 화면에는 표시하지 않는다.
  - 평문 저장하지 않는다.
  - Apps Script 쪽에서 salt를 생성하고 해시한 뒤 `passwordHash`, `passwordSalt`만 Google Sheets에 저장한다.

방명록 삭제:

- 작성자가 입력한 삭제용 비밀번호가 일치하면 삭제할 수 있게 한다.
- 삭제 요청 시 Apps Script가 해당 글의 `passwordSalt`를 가져와 입력 비밀번호를 같은 방식으로 해시하고 `passwordHash`와 비교한다.
- 일치하면 기본적으로 완전 삭제가 아니라 숨김 처리한다.
- 공개 페이지에서는 `status = visible`인 글만 보여준다.
- 관리자 페이지에서는 숨김/삭제 상태를 확인하고 관리할 수 있다.

방명록 저장 컬럼 방향:

```txt
id
name
message
passwordHash
passwordSalt
createdAt
status
userType
userId
```

초기 익명 모드에서는 `userType = anonymous`, `userId`는 비워둘 수 있다. 나중에 Google 로그인 모드로 전환하면 `userType = google`, `userId`에 Google 계정 식별자를 저장하는 식으로 확장한다.

`salt` 의미:

- salt는 비밀번호를 해시하기 전에 섞는 임의의 문자열이다.
- 같은 비밀번호라도 글마다 다른 salt를 쓰면 저장되는 해시값이 달라진다.
- 그래서 누군가 Google Sheets 내용을 보더라도 같은 비밀번호를 쓴 글을 쉽게 묶거나, 미리 만들어둔 해시 목록으로 역추적하기 어렵게 만든다.
- salt는 비밀값이 아니므로 `passwordSalt` 컬럼에 저장해도 된다.
- 비밀로 지켜야 하는 것은 원본 비밀번호이며, 원본 비밀번호는 저장하지 않는다.

확정 알고리즘:

```txt
passwordHash = SHA-256(passwordSalt + ":" + password + ":" + serverPepper)
```

저장값:

```txt
passwordHash
passwordSalt
passwordHashAlgorithm = "SHA-256+salt+pepper"
passwordHashIterations = 1
```

정책:

- 비밀번호 원문은 저장하지 않는다.
- 해시는 프론트엔드가 아니라 Apps Script에서 수행한다.
- `passwordSalt`는 글마다 새로 생성한다.
- `serverPepper`는 Google Sheets에 저장하지 않는다. 원본은 GitHub Secrets에 두고, Apps Script 런타임 값은 Apps Script Properties에 주입한다.
- 해시 결과는 base64 또는 hex 문자열로 저장한다.
- 삭제 비밀번호 검증 시 같은 알고리즘으로 다시 계산해 비교한다. 과거 PBKDF2 행은 호환 검증만 유지하되, 새 글은 빠른 SHA-256 방식으로 저장한다.

#### 방명록 스팸 방지

방명록 작성 시 봇/스팸 방지를 적용한다.

우선 선택은 Cloudflare Turnstile로 한다.

이유:

- 무료 개인/소규모 사이트에 적합하다.
- reCAPTCHA보다 사용자 마찰이 적은 편이다.
- 별도 Google Cloud 과금 설정 부담이 적다.
- 개인정보/추적 부담 면에서 reCAPTCHA보다 가볍게 가져가기 좋다.
- GitHub Pages 같은 정적 사이트에서도 위젯을 붙이고, Apps Script에서 검증 요청을 보내는 구조로 사용할 수 있다.

Cloudflare Turnstile로 구현한다.

문제가 생기면 구현 중에 상황을 보고 대안을 판단한다. 별도의 사전 전환 기준은 두지 않는다.

구현 원칙:

- Turnstile secret key는 GitHub Pages 프론트엔드에 넣지 않는다.
- 검증은 Apps Script 쪽에서 수행한다.
- 방명록 제출 시 `turnstileToken`을 함께 보내고, Apps Script가 Cloudflare 검증 API에 서버 측 요청을 보낸 뒤 성공한 경우에만 Google Sheets에 저장한다.

#### 방명록 권한 전환 기능

익명 방명록이 스팸을 충분히 막지 못할 경우를 대비해, 나중에 Google 로그인 사용자만 방명록 작성 가능하도록 전환할 수 있는 구조를 둔다.

따라서 방명록 작성 정책은 설정값으로 분리한다.

```txt
guestbookWriteMode = "anonymous" | "google-login"
```

초기값:

```txt
guestbookWriteMode = "anonymous"
```

전환 후:

```txt
guestbookWriteMode = "google-login"
```

이 전환을 위해 Apps Script 쪽에서도 작성자 인증 모드를 바꿀 수 있게 설계한다.

#### 아무글 / 자료 작성 권한

방명록을 제외한 기능은 관리자만 작성/수정할 수 있다.

관리자 전용 기능:

- 아무글 작성
- 아무글 수정
- 아무글 삭제/숨김
- 자료 자동 인덱스 확인
- 자료 숨김 관리
- 태그/표시명 보정

방문자는 다음만 가능하다.

- 자료 열람
- 자료 검색
- 아무글 열람
- 아무글 검색
- 방명록 작성
- 본인이 작성한 방명록 삭제 요청 또는 삭제

#### 관리자 인증

관리자 인증은 Apps Script 기반 관리자 세션으로 확정한다.

확정 방향:

```txt
/admin/ 직접 접속
  ↓
로그인 화면 표시
  ↓ 관리자 비밀번호 입력
Apps Script
  ↓ 서버 측 검증
서명된 관리자 세션 토큰 발급
  ↓
브라우저 localStorage에 세션 저장
  ↓
관리자 기능 사용
```

관리자 페이지 접근 정책:

- 공개 상단바와 홈 메뉴에는 관리자 버튼을 만들지 않는다.
- 관리자는 `/admin/` 주소로 직접 들어가며, 로그인 폼은 `/admin/` 안에서만 보여준다.
- `/admin`처럼 끝 슬래시 없이 들어오면 `/admin/`으로 보정한다.
- 로그인하지 않았거나 세션이 만료되면 `/admin/` 안에서 로그인 화면을 보여준다.
- 로그인 성공 후 관리자 화면을 보여준다.
- 로그인 유지는 가능해야 한다.
- 활동 중에는 클라이언트 idle 시간만 늘리는 것이 아니라 Apps Script 세션 토큰도 주기적으로 재발급해서, 글 작성 중 서버 세션이 먼저 만료되지 않게 한다.
- 관리자 글 편집 중인 내용은 브라우저 localStorage에 임시 저장해, 세션 만료나 새로고침 후에도 복구할 수 있게 한다.
- 서버 세션이 이미 만료된 경우 관리자 API 에러를 감지해 localStorage 세션을 지우고 `/admin/` 로그인 화면으로 되돌린다.

세션 정책:

```txt
Session storage: browser localStorage
Session format: signed token
Signing: HMAC-SHA256
Runtime secret storage: Apps Script Properties
Secret source of truth: GitHub Actions Secrets
Production idle timeout: 10 hours
Initial test timeout: 1 minute
Refresh policy: 관리자 API 요청 성공 시 새 만료 시간으로 토큰 재발급
```

세션 저장 방식 설명:

- 브라우저에는 세션 토큰만 저장한다.
- 관리자 비밀번호 원문은 브라우저에 저장하지 않는다.
- Apps Script는 토큰 서명과 만료 시간을 검증한다.
- 토큰 서명 키는 Apps Script Properties에 둔다.
- 활동이 있으면 Apps Script가 새 만료 시간이 들어간 토큰을 다시 내려준다.
- 활동 없이 만료 시간이 지나면 다시 로그인해야 한다.
- 테스트 단계에서는 만료 시간을 1분으로 두고, 운영 시 10시간으로 바꾼다.

이유:

- 현재 백엔드 역할은 Apps Script가 맡고 있다.
- GitHub OAuth를 쓰려면 OAuth App 등록, callback URL, client secret 보관, state 검증, access token 교환, GitHub 사용자 확인, 별도 세션 발급이 필요하다.
- GitHub OAuth의 client secret은 GitHub Pages 프론트엔드에 둘 수 없다.
- 따라서 GitHub 로그인을 쓰더라도 Apps Script가 중간 인증 서버 역할을 해야 한다.
- 이 프로젝트의 관리자 수가 적다면 GitHub OAuth는 초기 구현 대비 복잡도가 크다.

GitHub 로그인은 현재 관리자 인증 방식에서 제외한다. 필요해질 경우 후속 고급 옵션으로만 다시 검토한다.

GitHub OAuth를 도입할 경우 구조:

```txt
/admin/에서 GitHub 로그인 클릭
  ↓
GitHub OAuth authorize
  ↓
Apps Script callback으로 code 전달
  ↓
Apps Script가 client secret으로 access token 교환
  ↓
GitHub /user API로 로그인 사용자 확인
  ↓
허용된 GitHub 계정이면 관리자 세션 발급
```

GitHub OAuth를 선택할 만한 경우:

- 관리자 계정을 GitHub 계정과 강하게 묶고 싶을 때
- 여러 관리자를 GitHub username 기준으로 관리하고 싶을 때
- GitHub API를 사용해 이미지 repo commit 자동화까지 관리자 기능에 포함할 때

기본 원칙:

- 관리자 권한에 필요한 비밀값은 GitHub Pages 정적 코드에 하드코딩하지 않는다.
- GitHub OAuth client secret, 관리자 토큰, 세션 서명 키 등은 GitHub Secrets에 원본을 두고, Apps Script 런타임에는 Apps Script Properties로 동기화한다.
- 관리자 세션은 만료 시간을 가진다.
- 관리자 API 호출은 매번 세션을 검증한다.

### 이미지 저장 방식

이미지는 사이트 코드가 있는 GitHub Pages repo에 직접 넣지 않는다.

확정 방향:

- 이미지 전용 GitHub repo는 `cha-amu/archive`로 확정한다.
- `archive` repo는 이미지 전용 GitHub Pages repo로 사용하고 GitHub Pages를 켠다.
- 이미지 URL은 `raw.githubusercontent.com`이 아니라 GitHub Pages URL을 사용한다.
- 사이트의 `/archive/` 자료 페이지는 이미지 repo에 추가된 이미지를 자동으로 자료 목록에 포함한다.
- 관리자가 `/admin/`에서 이미지 repo에 직접 접근하거나 업로드하지 않는다.
- 이미지 추가는 이미지 전용 repo에 직접 파일을 추가하는 방식이다.

예상 구조:

```txt
cha-amu-site
  - GitHub Pages 사이트 코드
  - 글/방명록/자료 UI
  - Apps Script/Sheets 연동

archive
  - 이미지 파일 전용 repo
  - GitHub Pages 활성화
  - 예: /images/2026/filename.webp
  - 예: /manifest.json
```

이미지 URL 확정 형식:

```txt
https://cha-amu.github.io/archive/<path>
```

예시:

```txt
https://cha-amu.github.io/archive/images/2026/aurora.webp
```

#### 자료 자동 등록 방식

GitHub Pages는 정적 파일을 서빙하지만, 브라우저에서 폴더 목록을 안정적으로 자동 탐색하는 용도로 쓰기는 어렵다. 따라서 이미지 repo에는 자료 목록용 manifest를 둔다.

확정 방향:

```txt
archive/manifest.json
```

`/archive/` 페이지는 이 manifest를 읽어서 자료 목록을 만든다.

```txt
https://cha-amu.github.io/archive/manifest.json
```

manifest 예시:

```json
[
  {
    "id": "2026-aurora",
    "name": "Aurora Palette",
    "description": "색감 참고 이미지",
    "tags": ["color", "aurora", "reference"],
    "imageUrl": "https://cha-amu.github.io/archive/images/2026/aurora.webp",
    "createdAt": "2026-07-09"
  }
]
```

manifest 생성 방식:

- 이미지 repo에 이미지 파일을 추가한다.
- 이미지 repo의 GitHub Actions가 이미지 파일 목록을 읽어 `manifest.json`을 자동 생성/갱신한다.
- 사이트의 `/archive/`는 별도 관리자 입력 없이 최신 manifest를 불러온다.

즉, 관리자가 이미지 repo에 이미지를 추가하면 자료 페이지에 자동으로 들어오는 구조다.

#### 이미지 표시명/태그 정책

자동 생성만으로 부족할 수 있으므로 두 단계를 둔다.

1. 기본값 자동 생성
   - 파일명에서 `name` 생성
   - 폴더명에서 기본 태그 생성
   - 파일 경로에서 `id` 생성

2. 선택적 보정
   - 이미지 repo 안의 별도 메타데이터 파일 또는 Google Sheets override로 표시명, 설명, 태그를 보정할 수 있다.
   - 단, 기본 동작은 “이미지 repo에 추가하면 자동으로 자료에 들어감”이다.

후보 override 방식:

```txt
archive/metadata.json
```

또는 Google Sheets:

```txt
assetOverrides
  - imagePath
  - displayName
  - description
  - tags
  - hidden
```

기본 구현에서는 `manifest.json` 자동 생성 + 필요 시 Google Sheets override를 검토한다.

#### 관리자 페이지와 이미지 repo 관계

관리자 페이지는 이미지 repo에 직접 업로드하거나 commit하지 않는다.

관리자 페이지가 할 수 있는 일:

- 자동 인덱싱된 자료 확인
- 특정 자료 숨김 처리
- 표시명/설명/태그 보정

관리자 페이지가 하지 않는 일:

- 이미지 파일 업로드
- 이미지 repo commit
- GitHub 토큰을 통한 이미지 repo 접근

따라서 이미지 repo용 GitHub 토큰은 기본 구조에서 필요 없다.

#### 아무글의 이미지

아무글에서 사용하는 이미지는 반드시 `archive` repo의 이미지일 필요가 없다.

정책:

- Markdown 본문 안의 외부 이미지 URL을 허용한다.
- 예: `![설명](https://example.com/image.webp)`
- 이미지 repo URL도 사용할 수 있고, 다른 공개 이미지 URL도 사용할 수 있다.
- 단, 악성/깨진 이미지나 추적성 외부 리소스 문제를 줄이기 위해 관리자 작성 글에 한정한다.

#### 장점

- 사이트 코드 repo가 이미지 파일로 무거워지지 않는다.
- 이미지 추가와 사이트 구현이 분리된다.
- 관리자 페이지에 GitHub 업로드 기능을 만들 필요가 없다.
- GitHub 토큰을 프론트/Apps Script에 둘 필요가 줄어든다.
- 나중에 Telegram, 다른 CDN, 다른 저장소로 바꿀 때 manifest 생성 규칙만 바꾸면 된다.

#### 주의점

- 이미지 repo는 public이어야 GitHub Pages 사이트에서 표시하기 쉽다.
- 이미지 repo의 GitHub Pages 배포 지연이 있을 수 있다.
- manifest 자동 생성을 위해 이미지 repo 쪽 GitHub Actions 설정이 필요하다.
- 이미지가 많아질 경우 GitHub repo 용량/트래픽/관리 부담이 생길 수 있다.

## Apps Script 배포 정책

Apps Script 코드는 Apps Script 웹 에디터에서 직접 관리하지 않고, GitHub repo에서 관리한다.

확정 방향:

```txt
GitHub repo
  ↓ GitHub Actions
clasp
  ↓
Google Apps Script project
  ↓
Apps Script Web App deployment
```

즉, Apps Script 코드도 사이트 코드와 함께 버전 관리한다.

예상 구조:

```txt
/apps-script/
  appsscript.json
  src/
    Code.ts
    router.ts
    sheets.ts
    auth.ts
    guestbook.ts
    posts.ts
    assets.ts
    turnstile.ts
.github/workflows/deploy-apps-script.yml
```

배포 흐름:

```txt
main 브랜치 push 또는 수동 workflow 실행
  ↓
GitHub Actions 실행
  ↓
clasp push
  ↓
clasp deploy
  ↓
Apps Script Web App 갱신
  ↓
GitHub Secrets 값을 Apps Script Properties로 주입
```

운영 원칙:

- Apps Script 웹 에디터는 긴급 확인/디버깅용으로만 사용한다.
- 실제 수정은 GitHub repo에서 한다.
- Apps Script 코드 변경 이력은 Git으로 관리한다.
- Apps Script 프로젝트가 꼬이면 GitHub Actions로 다시 배포한다.
- 비밀값은 GitHub Secrets를 원본으로 두고, 배포 시 Apps Script Properties에 주입한다.

필요한 GitHub Secrets 예시:

```txt
CLASP_CREDENTIALS
CLASP_TOKEN
APPS_SCRIPT_ID
APPS_SCRIPT_DEPLOYMENT_ID
ADMIN_PASSWORD_HASH
ADMIN_SESSION_SECRET
GUESTBOOK_SERVER_PEPPER
TURNSTILE_SECRET_KEY
```

정확한 `clasp` 인증 secret 이름과 형식은 구현 시 사용하는 clasp/GitHub Actions 방식에 맞춰 조정한다.

참고 근거:

- Apps Script는 `clasp`와 GitHub Actions로 CI/CD를 구성할 수 있다: https://developers.google.com/apps-script/guides/clasp
- GitHub Actions Secrets는 workflow에서 사용할 민감 정보 저장 기능이다: https://docs.github.com/en/actions/concepts/security/secrets

## 비밀값 관리 정책

비밀값은 Google Sheets에 저장하지 않는다.

확정 방향:

```txt
GitHub Actions Secrets = 비밀값 원본/백업
Apps Script Properties = Apps Script 실행 중 사용하는 런타임 복사본
Google Sheets = 공개/운영 데이터만 저장
GitHub Pages frontend = 비밀값 저장 금지
```

이유:

- GitHub Actions Secrets는 워크플로에서 사용하는 민감 정보를 저장하는 용도다.
- Apps Script Properties는 Apps Script 실행 시 값을 읽기 위한 런타임 저장소다.
- GitHub Pages 프론트엔드는 정적 파일이므로 비밀값을 넣으면 공개되는 것과 같다.
- Apps Script가 Turnstile 검증, 관리자 세션 서명, 비밀번호 pepper 처리를 하려면 런타임에서 비밀값을 읽을 수 있어야 한다.
- 따라서 GitHub Secrets만으로는 런타임 처리가 불가능하고, Apps Script Properties에도 배포 시 복사본이 필요하다.

관리할 비밀값:

```txt
ADMIN_PASSWORD_HASH 또는 ADMIN_PASSWORD
ADMIN_SESSION_SECRET
GUESTBOOK_SERVER_PEPPER
TURNSTILE_SECRET_KEY
```

권장 배포 흐름:

```txt
GitHub Actions Secrets
  ↓ deploy/sync workflow
Apps Script Properties
  ↓ runtime
Apps Script Web App
```

운영 원칙:

- 비밀값 원본은 GitHub Secrets에 둔다.
- Apps Script Properties는 런타임 복사본으로 본다.
- Apps Script가 꼬이거나 새 프로젝트로 복구해야 할 때 GitHub Actions Secrets에서 다시 주입한다.
- Apps Script Properties를 수동으로만 관리하지 않는다.
- 문서나 repo 파일에는 실제 비밀값을 쓰지 않는다.

참고 근거:

- GitHub Actions Secrets는 워크플로에서 쓰는 민감 정보 저장 기능이다: https://docs.github.com/en/actions/concepts/security/secrets
- Apps Script Properties는 스크립트 범위 key-value 저장소다: https://developers.google.com/apps-script/guides/properties
- Apps Script는 `clasp`와 GitHub Actions로 배포 자동화를 구성할 수 있다: https://developers.google.com/apps-script/guides/clasp

## Google Sheets 컬럼 구조

Google Sheets는 기능별로 시트를 나누는 방향이 좋다. 방명록, 아무글, 자료 보정 데이터는 성격과 권한이 다르므로 한 시트에 섞지 않는다.

확정된 시트 구성:

```txt
posts
guestbook
assetOverrides
settings
auditLog
```

관리자 비밀번호, 세션 서명 키, serverPepper, Turnstile secret key 같은 비밀값은 Google Sheets에 저장하지 않는다. 비밀값의 백업/배포 원천은 GitHub Secrets로 두고, Apps Script 런타임에서 필요한 값은 배포 시 Apps Script Properties로 주입한다.

### `posts` 시트

아무글 데이터를 저장한다. 작성/수정/삭제는 관리자만 가능하다.

```txt
id
slug
title
bodyMarkdown
excerpt
tags
status
createdAt
updatedAt
publishedAt
```

컬럼 설명:

- `id`: 내부 식별자. 예: `post_20260709_abcd`
- `slug`: URL/hash 또는 공유용 짧은 식별자
- `title`: 글 제목
- `bodyMarkdown`: Markdown 본문
- `excerpt`: 목록/검색에 쓸 요약문. 비워두면 본문에서 자동 생성 가능
- `tags`: 쉼표 구분 문자열 또는 JSON 문자열
- `status`: `draft`, `published`, `hidden`, `deleted`
- `createdAt`: 생성 시각
- `updatedAt`: 수정 시각
- `publishedAt`: 공개 시각

공개 페이지에서는 기본적으로 `status = published`인 글만 보여준다. 관리자 새 글 작성의 기본 상태는 `published`로 두고, 저장 성공 시 브라우저 공개 글 캐시도 즉시 갱신한다. 관리자 글 작성 화면의 Markdown 입력 영역과 공개 글 미리보기는 실제 `/posts/` 본문과 같은 읽기 폭을 사용해 작성 중 줄바꿈과 이미지 배치를 확인할 수 있게 한다.

### `guestbook` 시트

방명록 데이터를 저장한다. 방문자는 작성과 본인 글 숨김/삭제 요청이 가능하고, 관리자는 숨김/삭제 관리가 가능하다.

```txt
id
name
message
passwordHash
passwordSalt
passwordHashAlgorithm
passwordHashIterations
userType
userId
status
createdAt
updatedAt
hiddenAt
hiddenReason
turnstileVerifiedAt
```

컬럼 설명:

- `id`: 방명록 글 식별자
- `name`: 방문자가 입력한 이름
- `message`: 방명록 내용
- `passwordHash`: 삭제용 비밀번호 해시
- `passwordSalt`: 삭제용 비밀번호 salt
- `passwordHashAlgorithm`: 예: `SHA-256+salt+pepper`
- `passwordHashIterations`: 예: `1`
- `userType`: `anonymous` 또는 추후 `google`
- `userId`: 익명 모드에서는 비움. Google 로그인 모드에서는 계정 식별자
- `status`: `visible`, `hidden`, `deleted`
- `createdAt`: 생성 시각
- `updatedAt`: 수정 시각
- `hiddenAt`: 숨김/삭제 처리 시각
- `hiddenReason`: 관리자 숨김 사유 또는 사용자 삭제 표시
- `turnstileVerifiedAt`: Turnstile 검증 성공 시각

공개 페이지에서는 `status = visible`인 글만 보여준다.

### `assetOverrides` 시트

이미지 전용 repo의 `manifest.json`에 자동으로 들어온 자료를 보정하는 시트다. 이미지 자체를 저장하지 않는다.

```txt
assetId
imagePath
displayName
description
tags
sourceUrl
status
sortOrder
updatedAt
```

컬럼 설명:

- `assetId`: manifest의 `id`와 매칭
- `imagePath`: 이미지 repo 내부 경로. 예: `images/2026/aurora.webp`
- `displayName`: 자동 생성 이름 대신 표시할 이름
- `description`: 자료 설명
- `tags`: 보정 태그
- `sourceUrl`: 원본 출처 URL이 있으면 저장
- `status`: `visible`, `hidden`
- `sortOrder`: 수동 정렬이 필요할 때 사용
- `updatedAt`: 보정 데이터 수정 시각

자료 페이지는 다음 순서로 데이터를 합친다.

```txt
archive/manifest.json
  + assetOverrides
  = archive 표시 데이터
```

### `settings` 시트

공개해도 되는 운영 설정을 저장한다. 비밀값은 저장하지 않는다.

```txt
key
value
updatedAt
```

예시:

```txt
guestbookWriteMode | anonymous | 2026-07-09T00:00:00Z
siteTitle | 채아무 | 2026-07-09T00:00:00Z
```

주의:

- 관리자 비밀번호
- session signing secret
- Turnstile secret key
- serverPepper

이런 값은 `settings`가 아니라 Apps Script Properties에 저장한다.

### `auditLog` 시트

관리자 작업 기록을 남기는 선택 시트다. 초기 구현에 넣는 것이 좋다.

```txt
id
actor
action
targetType
targetId
detail
createdAt
```

예시 action:

```txt
post.create
post.update
post.hide
assetOverride.update
guestbook.hide
admin.login
```

`auditLog`는 문제가 생겼을 때 원인을 추적하기 위한 용도다.

### 시트 분리 이유

- 방명록은 방문자 입력이므로 스팸/삭제 비밀번호/Turnstile 정보가 필요하다.
- 아무글은 관리자 콘텐츠이므로 Markdown 본문, 공개 상태, 발행 시각이 중요하다.
- 자료는 이미지 repo manifest가 원본이고, Sheets는 보정/숨김만 담당한다.
- 설정과 감사 로그는 운영 성격이 다르므로 별도 시트가 낫다.

## 현재 결론

현재 확정된 것은 GitHub Pages 기반 자료 아카이브, Vite + React + TypeScript 프론트, GitHub Actions + clasp 기반 Apps Script 배포, Google Apps Script + Google Sheets 저장 구조, GitHub Secrets 원본 + Apps Script Properties 런타임 비밀값 관리, Apps Script 관리자 세션, 별도 이미지 GitHub Pages repo + manifest 자동 인덱싱, Cloudflare Turnstile 스팸 방지, 그리고 필수 관리자 페이지다.

각 페이지 세부 UI 문서는 `docs/ui-spec.md`에 작성되어 있다. Google Sheets 컬럼 구조와 이미지 manifest/override 구조는 확정했다. 프론트 스택은 Vite + React + TypeScript로 확정했고, 관리자 인증은 Apps Script 서명 세션 방식으로 확정했다. 이제 구현하면서 필요한 세부 UI 값은 문서와 함께 갱신한다.


## 공개 데이터 캐시 전략

확정: 방명록과 일반 글의 읽기 성능은 SPA 전역 public data store, 브라우저 localStorage 캐시, Apps Script `CacheService` 공개 응답 캐시로 개선한다. 글 작성/삭제마다 GitHub repo에 커밋하거나 GitHub Pages용 JSON 파일을 갱신하지 않는다.

이유:

- 글 작성마다 GitHub 커밋이 생기면 스팸 상황에서 커밋 폭증/충돌/히스토리 오염이 생긴다.
- GitHub Pages JSON 캐시는 첫 방문 속도에는 유리하지만, 지금 단계에서는 구조가 늘어나고 최신성 지연을 따로 관리해야 한다.
- 현재 요구에는 “재방문/새로고침/작성 직후 체감 속도”가 더 중요하므로 SPA 전역 store + localStorage 우선 표시가 더 단순하다.
- 첫 방문 서버 응답은 Apps Script `CacheService`로 Sheet 반복 read를 줄인다.

흐름:

```txt
읽기
1. 앱 시작 시 localStorage 캐시를 SPA 전역 store에 적재
2. 화면은 전역 store 데이터를 즉시 표시
3. Apps Script 최신 목록을 백그라운드 요청
4. Apps Script는 공개 목록을 CacheService에서 먼저 확인하고, miss 시 Sheets를 읽어 캐시 저장
5. 서버 목록 기준으로 병합
   - 새 글 추가
   - 숨김/삭제된 글 제거
   - 수정된 글 교체
6. 전역 store와 localStorage 캐시 갱신

쓰기/삭제
1. 화면과 localStorage에 낙관적으로 먼저 반영
2. Apps Script 요청
3. 성공 시 서버 결과로 확정
4. 실패 시 이전 상태 복구
```

제약:

- 완전 첫 방문자는 브라우저 캐시가 없으므로 Apps Script 응답 대기 시간이 남는다. 단, Apps Script 공개 캐시가 살아 있으면 Sheets read 없이 더 빠르게 응답할 수 있다.
- `CacheService` 값은 만료 전에도 사라질 수 있으므로 miss fallback이 필수다.
- 0.2초급 “항상 최신 첫 로딩”은 Apps Script 직접 호출만으로는 기대하지 않는다.
- 서버 응답이 최종 기준이다. 서버 목록에 없는 항목은 숨김/삭제 상태로 간주해 로컬 캐시에서 제거한다.
