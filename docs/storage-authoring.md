# Storage repo 작성 규칙

`cha-amu/storage`는 메인 사이트가 읽는 정적 원본/미러 저장소다. 메인 사이트의 자료 화면 주소는 계속 `/archive/`이고, 실제 파일 URL은 `https://cha-amu.github.io/storage/...`를 쓴다.

## 폴더 구조

```txt
posts/
  2026/
    first-post.md

assets/
  images/
    2026/
      sample.png
  files/
    2026/
      sample.pdf

manifests/
  posts.json
  assets.json

manifest.json
```

- `posts/`에는 직접 작성한 Markdown 글을 둔다.
- `assets/images/`에는 이미지 파일을 둔다.
- `assets/files/`에는 PDF, ZIP, TXT 같은 일반 파일을 둔다.
- `manifests/`와 `manifest.json`은 GitHub Actions가 생성하므로 직접 편집하지 않는다.

## 포스트 작성 양식

파일명은 사람이 읽을 수 있게 쓴다. UUID를 직접 만들 필요 없다.

```txt
posts/2026/my-first-post.md
```

본문은 frontmatter와 Markdown으로 작성한다.

```md
---
title: 첫 글
date: 2026-07-09
tags: [기록, 테스트]
status: published
excerpt: 목록과 검색에 보일 짧은 설명
---

본문을 Markdown으로 쓴다.

![이미지](../../assets/images/2026/sample.png)

[PDF 파일](../../assets/files/2026/sample.pdf)
```

## Frontmatter 필드

```txt
title      필수. 글 제목.
date       권장. YYYY-MM-DD 또는 ISO 날짜.
tags       선택. [태그1, 태그2] 형식.
status     선택. published, draft, hidden 중 하나. 기본값은 published.
excerpt    선택. 비워두면 본문에서 자동 생성.
id         선택. 보통 쓰지 않는다. 없으면 posts/... 경로로 자동 생성.
```

## 이미지와 파일 링크

포스트 안에서는 상대경로를 권장한다.

```md
![이미지](../../assets/images/2026/sample.png)
[첨부파일](../../assets/files/2026/sample.pdf)
```

메인 사이트는 이 상대경로를 `https://cha-amu.github.io/storage/...` URL로 풀어서 표시한다.

외부 URL도 가능하다.

```md
![외부 이미지](https://example.com/image.png)
[외부 링크](https://example.com/file.pdf)
```

## 자료 파일 업로드

이미지는 `assets/images/YYYY/` 아래에 둔다.

```txt
assets/images/2026/sample.png
```

이미지가 아닌 파일은 `assets/files/YYYY/` 아래에 둔다.

```txt
assets/files/2026/sample.pdf
assets/files/2026/reference.zip
```

자료 파일명은 아래 형식을 권장한다.

```txt
검색이름--태그1+태그2+태그3--짧은설명.확장자
```

예시:

```txt
assets/images/2026/고양이포즈--동물+레퍼런스--측면자세.webp
assets/files/2026/설정자료--pdf+설정집--캐릭터 문서.pdf
```

- `검색이름`은 자료 카드 제목이 된다.
- `태그1+태그2`는 자료 태그가 된다.
- `짧은설명`은 자료 설명이 된다.
- 필드 구분자는 `--`, 태그 구분자는 `+`를 쓴다.
- 파일명 안의 `_`는 표시할 때 공백처럼 처리한다.
- URL, 긴 설명, 여러 줄 메모는 파일명에 넣지 말고 같은 이름의 `.md` 파일에 넣는다.

생략도 가능하다.

```txt
검색이름--태그1+태그2.확장자
검색이름----짧은설명.확장자
--태그1+태그2--짧은설명.확장자
검색이름.확장자
```

모두 생략한 `.확장자` 파일명은 숨김 파일처럼 보일 수 있으므로 쓰지 않는다. 최소한 `untitled.png`처럼 이름을 둔다.

GitHub Actions가 파일 경로를 기준으로 자동 id를 만든다.

```txt
assets/images/2026/sample.png -> asset:assets/images/2026/sample.png
posts/2026/my-first-post.md   -> post:posts/2026/my-first-post.md
```

## 자료 긴 설명 사이드카

자료 파일과 같은 경로에 같은 파일명의 `.md`를 두면, 그 `.md`는 별도 자료로 노출되지 않고 해당 자료의 메타데이터로 사용된다.

```txt
assets/images/2026/고양이포즈--동물+레퍼런스--측면자세.webp
assets/images/2026/고양이포즈--동물+레퍼런스--측면자세.md
```

사이드카 예시:

```md
---
title: 고양이 포즈 참고
tags: [동물, 레퍼런스, 포즈]
sourceUrl: https://example.com/original-page
status: visible
sortOrder: 20
---

측면 자세 참고용 이미지.

- 여러 줄 설명 가능
- [관련 링크](https://example.com)
- 같은 폴더 파일 링크도 가능: [원본](./source.pdf)
```

사이드카가 있으면 아래 값은 파일명보다 우선한다.

```txt
title       자료 제목
tags        자료 태그. [태그1, 태그2] 형식
description 짧은 설명. 없으면 본문 전체를 설명으로 사용
sourceUrl   원본/출처 URL
status      visible, hidden, deleted
sortOrder   낮을수록 먼저 표시
```

본문은 Markdown으로 표시된다. 상대 링크는 storage repo의 같은 경로 기준으로 해석된다.

같은 이름의 실제 자료가 있으면 `.md`는 사이드카로 처리된다. 같은 이름의 실제 자료가 없으면 `.md`도 일반 파일 자료로 등록된다.

## Sheets와 sync 규칙

GitHub Actions가 `cha-amu/storage`와 Google Sheets를 맞춘다.

- sync는 메인 사이트 repo가 아니라 `cha-amu/storage` repo의 `Sync storage repo` GitHub Actions에서 돈다.
- `posts/**`, `assets/**`, sync 스크립트, `package.json`, sync workflow가 `main`에 push되면 즉시 실행된다.
- 주기 sync는 매주 월요일 03:17 KST에 실행된다. GitHub cron 기준으로는 일요일 18:17 UTC다.
- storage repo에 직접 push한 글은 즉시 Sheets에 본문까지 복사된다.
- Sheets에만 있거나 Sheets 쪽 `updatedAt`이 더 최신인 글은 주기적 sync 때 `posts/YYYY/title.md`로 storage repo에 반영된다.
- storage에만 있는 글은 Sheets에 `source=storage`, `storagePath=...`, `syncStatus=synced` 표시와 함께 본문까지 추가된다.
- storage에만 있는 자료 파일은 Sheets asset override에 link-only 행으로 추가한다.
- 사이트에서 글을 표시할 때는 Sheets의 `updatedAt`이 storage의 `updatedAt`보다 최신이면 Sheets 본문을 쓰고, 같거나 storage가 최신이면 storage Markdown을 쓴다.
- GitHub push로 실행된 sync는 사람이 frontmatter `updatedAt`을 직접 바꾸지 않아도 storage 파일을 최신으로 보고 Sheets에 반영한다.
- Sheets에서 `hidden`이나 `deleted`로 둔 항목은 그 상태의 `updatedAt`이 최신이면 공개 사이트에서 숨긴다.

## 수동 sync 실행

GitHub 웹에서 실행한다.

```txt
1. https://github.com/cha-amu/storage 로 이동
2. Actions 탭 클릭
3. Sync storage repo 선택
4. Run workflow 클릭
5. Branch가 main인지 확인
6. Run workflow 실행
```

수동 실행 후 같은 Actions 화면에서 초록색 체크로 끝나면 성공이다. 실행 중 새 manifest나 Markdown 파일 변경이 생기면 `github-actions[bot]`이 `Sync storage manifests` 커밋을 자동으로 만든다.

## sync 확인 방법

Actions 실행 상태:

```txt
cha-amu/storage > Actions > Sync storage repo
```

사이트 반영 상태:

```txt
https://cha-amu.github.io/storage/manifests/assets.json
https://cha-amu.github.io/storage/manifests/posts.json
```

각 manifest의 `generatedAt`이 최근 시간으로 바뀌고, 새 파일 경로가 `assets` 또는 `posts` 배열에 들어 있으면 storage Pages 쪽 반영은 끝난 것이다. 메인 사이트 `/archive/`는 이 manifest를 읽는다.

로컬에서 Sheets를 건드리지 않고 manifest 생성만 확인하려면 storage repo에서 dry-run을 실행한다.

```sh
STORAGE_SYNC_DRY_RUN=1 npm run sync
```

실제 Sheets까지 쓰는 로컬 sync는 `API_URL`, `ADMIN_PASSWORD`, `STORAGE_SYNC_SECRET`이 필요하므로, 보통은 GitHub Actions 수동 실행을 쓴다. `API_URL`은 Apps Script 원본이 아니라 `https://cha-amu-gateway.yiyaaang.workers.dev/api`를 사용한다.

## 직접 편집하지 않는 파일

아래 파일은 자동 생성물이다.

```txt
manifests/posts.json
manifests/assets.json
manifest.json
```

필요하면 GitHub Actions의 `Sync storage repo` workflow를 수동 실행한다.
