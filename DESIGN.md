# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-10
- Primary product surfaces: 홈, 아무 글, 자료, 방명록, 통합 검색, 관리자 화면
- Evidence reviewed: `docs/ui-spec.md`, `docs/github-pages-archive-brief.md`, `src/styles/global.css`, `src/components/AppLayout.tsx`, `src/components/SiteTools.tsx`, `src/components/SearchForm.tsx`, `src/entries/home.tsx`, `docs/assets/ui/*`

## Brand
- Personality: 밝고 느슨한 개인 채널, 손그림/두들 감성.
- Trust signals: 단순한 구조, 명확한 상태 메시지, 삭제/관리 동작의 구분.
- Avoid: 픽셀아트처럼 딱딱한 장식, 카드만 반복하는 단조로운 레이아웃, 페이지별 폭 흔들림.

## Product goals
- Goals: 관리자는 커밋 없이 글을 올리고, 방문자는 자료/글을 찾고 방명록을 남긴다.
- Non-goals: 자체 결제, 쇼핑몰, 복잡한 소셜 기능, 모바일 우선 재설계.
- Success signals: 모든 공개 페이지에서 검색/방명록/설정 접근 가능, 글/자료 외곽 레일 일관성, 모바일에서 버튼 잘림 없음.

## Personas and jobs
- Primary personas: 사이트 관리자, 익명 방문자.
- User jobs: 글 읽기, 자료 검색, 방명록 작성/삭제, 관리자 글 작성/방명록 관리.
- Key contexts of use: 데스크톱 중심이지만 모바일 브라우저에서도 모든 기능 수행.

## Information architecture
- Primary navigation: 채널명/로고는 사이트 상단 전역줄 왼쪽에 둔다. `아무 글`, `자료`는 그 아래 줄에서 채널명/본문 레일과 같은 시작선에 큰 정사각형 메뉴로 두고, `방명록`, `검색`, `설정`은 사이트 상단 오른쪽 공통 도구로 둔다.
- Core routes/screens: `/`, `/posts/`, `/archive/`, `/guestbook/`, `/search/`, `/admin/`.
- Content hierarchy: 페이지 제목 반복보다 즉시 할 일/목록/검색을 먼저 보여준다. 공통 검색은 상단 아이콘에서 열리는 오버레이로 분리하고 결과는 `/search/` 본문에서 보여준다. 아무 글과 자료의 로컬 검색은 콘텐츠 위의 짧은 필터바로 상단바와 본문을 나누고, 태그 탐색은 우측 보조 레일에서 개수와 함께 제공한다.

## Design principles
- Principle 1: 같은 위계는 같은 크기와 위치 규칙을 쓴다. 특히 채널명과 공통 도구는 모든 페이지에서 전체 뷰포트 기준 fixed 상단 레일을 공유하고, 주요 탭은 그 아래 별도 행에서 본문 시작선과 연결되며 위쪽 헤더보다 아래 콘텐츠에 더 가깝게 둔다.
- Principle 2: 홈은 중앙 검색이 있으므로 우측 도구에서 검색을 반복하지 않는다.
- Tradeoffs: 작은 화면에서는 상단 도구가 한 줄 아래로 내려가도 잘림 없는 접근성을 우선한다.

## Visual language
- Color: primary `#B7DDBF`, background `#F9F9F9`, danger `#F88A87`.
- Typography: 시스템 산세리프, 한국어 가독성 우선.
- Spacing/layout rhythm: `--layout-page` 본문 레일과 `--layout-gutter`를 공유한다.
- Shape/radius/elevation: 검은 손그림 느낌 테두리, 둥근 모서리, 과한 그림자 지양.
- Motion: 필수 상태 전환만 사용한다.
- Imagery/iconography: 주요 콘텐츠 메뉴는 제공된 손그림 아이콘을 사용하고, 검색/방명록/설정 공통 도구는 같은 결의 Lucide 계열 SVG 벡터 아이콘으로 만든다.

## Components
- Existing components to reuse: `AppLayout`, `Header`, `SiteTools`, `SearchForm`, `PageState`, `TagList`.
- New/changed components: `Header`는 홈을 제외한 모든 페이지의 상단바 단일 소스이고, `SiteTools`는 검색/방명록/설정 공통 도구를 담당한다. 공통 검색은 상단 입력창이 아니라 아이콘 버튼과 포털 오버레이로 열며, 제출 시 통합 검색 본문으로 이동한다. 개별 페이지에서 상단바를 복제하지 않는다. `TagFilterPanel`은 아무 글/자료의 우측 태그 필터를 담당하며, 태그는 많은 순으로 표시하고 다중 선택은 선택 태그를 모두 포함하는 항목으로 좁힌다.
- Variants and states: `SiteTools`는 홈에서 검색을 숨기는 `showSearch=false` 변형을 쓴다.
- Token/component ownership: 레이아웃 폭/색/버튼 크기는 `src/styles/global.css` 토큰과 공통 클래스에서 관리한다.

## Accessibility
- Target standard: 키보드와 스크린리더 기본 사용 가능 수준.
- Keyboard/focus behavior: 링크/버튼은 기본 포커스 가능, 검색 오버레이는 열릴 때 입력창에 포커스한다. 검색 오버레이와 설정 사이드바는 Escape/닫기/배경 클릭으로 닫는다.
- Contrast/readability: 밝은 배경 위 검은 텍스트/테두리 중심.
- Screen-reader semantics: 주요 메뉴는 `nav`, 검색은 `role="search"`, 설정은 `role="dialog"`.
- Reduced motion and sensory considerations: 자동 애니메이션을 필수로 두지 않는다.

## Responsive behavior
- Supported breakpoints/devices: 데스크톱 기본, 760px/430px 이하에서 축소·줄바꿈.
- Layout adaptations: 공통 도구를 fixed 상단 레일에 유지하고, 헤더 콘텐츠를 도구 줄 아래로 내려 겹침을 막는다. 좁은 화면에서도 검색은 상단 오버레이 폭을 뷰포트 안에 제한한다. 우측 태그 필터 패널은 한 컬럼에서 목록 위로 이동한다.
- Touch/hover differences: 아이콘 버튼은 터치 가능한 크기를 유지한다. fixed 오버레이의 빈 레일은 아래 메뉴 클릭을 막지 않되, 설정 사이드바는 최상위 전체-뷰포트 오버레이로 열려 클릭/닫기/배경 클릭/Escape를 받는다.

## Interaction states
- Loading: 기존 상태 컴포넌트로 표시.
- Empty: 빈 결과 안내와 다음 행동 제공.
- Error: 재시도 가능 메시지.
- Success: 저장/반영 완료 상태 표시.
- Disabled: 아직 미구현인 설정은 disabled 버튼으로 표시.
- Offline/slow network, if applicable: 로컬 캐시를 먼저 보여주고 서버 응답으로 갱신한다.

## Content voice
- Tone: 짧고 직접적인 한국어.
- Terminology: `아무 글`, `자료`, `방명록`, `설정`, `검색`을 고정 사용.
- Microcopy rules: 관리자/방문자 기능을 혼동하지 않게 분리해서 적는다.

## Implementation constraints
- Framework/styling system: Vite + React + TypeScript, 전역 CSS 토큰.
- Design-token constraints: 색상/폭/버튼 크기는 공통 토큰 변경을 우선한다.
- Performance constraints: GitHub Pages 정적 호스팅, Apps Script 응답은 캐시 우선 표시.
- Compatibility constraints: React SPA 라우팅, GitHub Pages `404.html` fallback, 경로 직접 입력/새로고침, trailing slash 보정 유지.
- Test/screenshot expectations: UI/라우팅 변경 후 typecheck/build, 직접 URL 진입, 내부 링크 무reload 이동, 주요 DOM 구조 확인.

## Open questions
- [ ] 실제 다국어/다크테마를 언제 활성화할지 / 관리자 / 낮음
- [ ] 설정 사이드바에 표시할 추가 방문자 옵션 / 관리자 / 낮음
