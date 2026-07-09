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

GitHub Actions가 파일 경로를 기준으로 자동 id를 만든다.

```txt
assets/images/2026/sample.png -> asset:assets/images/2026/sample.png
posts/2026/my-first-post.md   -> post:posts/2026/my-first-post.md
```

## Sheets와 sync 규칙

GitHub Actions가 `cha-amu/storage`와 Google Sheets를 맞춘다.

- storage repo에 직접 push한 글은 즉시 Sheets에 본문까지 복사된다.
- Sheets에만 있거나 Sheets 쪽 `updatedAt`이 더 최신인 글은 주기적 sync 때 `posts/YYYY/title.md`로 storage repo에 반영된다.
- storage에만 있는 글은 Sheets에 `source=storage`, `storagePath=...`, `syncStatus=synced` 표시와 함께 본문까지 추가된다.
- storage에만 있는 자료 파일은 Sheets asset override에 link-only 행으로 추가한다.
- 사이트에서 글을 표시할 때는 Sheets의 `updatedAt`이 storage의 `updatedAt`보다 최신이면 Sheets 본문을 쓰고, 같거나 storage가 최신이면 storage Markdown을 쓴다.
- GitHub push로 실행된 sync는 사람이 frontmatter `updatedAt`을 직접 바꾸지 않아도 storage 파일을 최신으로 보고 Sheets에 반영한다.
- Sheets에서 `hidden`이나 `deleted`로 둔 항목은 그 상태의 `updatedAt`이 최신이면 공개 사이트에서 숨긴다.

## 직접 편집하지 않는 파일

아래 파일은 자동 생성물이다.

```txt
manifests/posts.json
manifests/assets.json
manifest.json
```

필요하면 GitHub Actions의 `Sync storage repo` workflow를 수동 실행한다.
