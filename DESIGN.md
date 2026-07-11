# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-11
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
- Primary navigation: 채널명/로고는 사이트 상단 전역줄 왼쪽에 둔다. `아무 글`, `자료`는 초기 상태에서 그 아래 줄의 큰 정사각형 메뉴로 시작하고, 스크롤이 진행되면 채널명 텍스트가 제자리에서 흐려지면서 같은 위치를 로고 오른쪽의 아이콘 compact 탭이 대체한다. `방명록`, `검색`, `설정`은 사이트 상단 오른쪽 공통 도구로 둔다.
- Core routes/screens: `/`, `/posts/`, `/archive/`, `/guestbook/`, `/search/`, `/admin/`.
- Content hierarchy: 페이지 제목 반복보다 즉시 할 일/목록/검색을 먼저 보여준다. 공통 검색은 상단 아이콘에서 열리는 오버레이로 분리하고 결과는 `/search/` 본문에서 보여준다. 아무 글과 자료의 로컬 검색은 콘텐츠 위의 짧은 필터바로 상단바와 본문을 나누고, 태그 탐색은 우측 보조 레일에서 개수와 함께 제공한다. 관리자 화면은 공개 페이지의 외곽선과 색을 유지하되 목록과 편집기를 master-detail 구조로 배치하고, 미리보기는 편집기 아래에 누적하지 않고 전환해서 본다.

## Design principles
- Principle 1: 같은 위계는 같은 크기와 위치 규칙을 쓴다. 특히 채널명과 공통 도구는 모든 페이지에서 전체 뷰포트 기준 fixed 상단 레일을 공유하고, 주요 탭은 첫 화면에서는 본문 시작선과 연결된 별도 행으로 보이되 스크롤 후에는 상단 레일 안의 compact 상태로 수렴한다. 탭-필터, 필터-본문 간격은 같은 gap 값을 쓴다.
- Principle 2: 홈은 중앙 검색이 있으므로 우측 도구에서 검색을 반복하지 않는다.
- Tradeoffs: 작은 화면에서는 상단 도구가 한 줄 아래로 내려가도 잘림 없는 접근성을 우선한다.

## Visual language
- Color: primary `#B7DDBF`, background `#F9F9F9`, danger `#F88A87`.
- Typography: 시스템 산세리프, 한국어 가독성 우선.
- Spacing/layout rhythm: `--layout-page` 본문 레일과 `--layout-gutter`를 공유한다.
- Shape/radius/elevation: 검은 손그림 느낌 테두리를 유지한다. 카드는 큰 둥근 모서리, 한 줄 입력은 pill, 여러 줄 입력은 둥근 사각형, 아이콘 버튼은 원형으로 구분하고 과한 그림자는 지양한다.
- Motion: 필수 상태 전환만 사용한다. 주요 탭의 compact 전환은 스크롤 진행률에 맞춰 위치, 크기, 투명도만 보간하고, 채널명 텍스트는 폭을 줄이지 않고 제자리에서 페이드한다.
- Imagery/iconography: 주요 콘텐츠 메뉴는 제공된 손그림 아이콘을 사용하고, 검색/방명록/설정 공통 도구는 같은 결의 Lucide 계열 SVG 벡터 아이콘으로 만든다.

## Components
- Existing components to reuse: `AppLayout`, `Header`, `SiteTools`, `SearchForm`, `PageState`, `TagList`.
- New/changed components: `Header`는 홈을 제외한 모든 페이지의 상단바 단일 소스이고, 스크롤 진행률에 맞춰 큰 `아무 글`/`자료` 메뉴와 상단 아이콘 compact 메뉴를 교차 전환한다. `SiteTools`는 검색/방명록/설정 공통 도구를 담당한다. 공통 검색은 상단 입력창이 아니라 아이콘 버튼과 포털 오버레이로 열며, 제출 시 통합 검색 본문으로 이동한다. 개별 페이지에서 상단바를 복제하지 않는다. `TagFilterPanel`은 아무 글/자료의 우측 태그 필터를 담당하며, 태그는 많은 순으로 표시하고 다중 선택은 선택 태그를 모두 포함하는 항목으로 좁힌다. 방명록 작성 영역은 공통 `2px` 카드 외곽선 안에서 기본 접힘 상태로 시작하고, 펼치면 메시지 입력을 먼저 보여준다. 이름은 `이름 (선택)` 플레이스홀더와 스크린리더용 `label`을 유지하고, 비우면 서버에서 `ㅇㅁ`으로 저장한다. 방명록 항목은 메시지를 먼저 표시하고 이름·날짜·지우기를 하단 메타 행에 둔다. 이름은 메시지와 같은 글자 크기를 유지하되 낮은 대비로 위계를 낮춘다. 글 지우기는 하단 메타 행 끝의 테두리 없는 휴지통 아이콘으로 제공하되 hover/focus 상태와 접근 가능한 이름을 유지한다. 관리자 방명록은 공개 목록 API가 아니라 관리자 전용 전체 목록을 사용하며 `글 목록`과 `IP 차단` 화면을 전환한다. 글 목록에서는 공개/숨김/삭제 상태를 필터링하고 숨긴 글을 복구하며, IP 차단 화면에서는 활성 차단의 시각·사유·연결 글 맥락과 해제 동작을 제공하되 실제 IP와 IP 해시는 표시하지 않는다. 관리자 글·자료 목록은 패널 높이를 넘으면 패널 안에서 독립적으로 스크롤한다. 관리자 글 상태는 `공개`/`임시저장`/`숨김`을 한 번에 보고 직접 누르는 3분할 라디오 컨트롤을 사용하며 공개는 초록, 임시저장은 노랑, 숨김은 회색으로 현재 상태를 구분한다. 세션 활동 기록은 입력 컨트롤을 불필요하게 재렌더링하지 않는다. 자료 모달은 외곽 프레임과 내부 스크롤 영역을 분리해 스크롤바가 검은 외곽선을 침범하지 않게 한다. `IncrementalLoadMore`는 전체 데이터의 순서와 정확도는 유지하고 아무 글·자료·방명록의 렌더링 항목만 묶어서 늘린다. `BackToTopButton`은 이들 긴 목록에서 스크롤이 충분히 내려간 뒤에만 표시한다.
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
- Layout adaptations: 공통 도구를 fixed 상단 레일에 유지하고, 헤더 콘텐츠를 도구 줄 아래로 내려 겹침을 막는다. 스크롤 후 compact 메뉴는 기존 fixed 상단 레일 안으로 들어가며 별도 sticky 줄을 추가하지 않는다. 좁은 화면에서도 검색은 상단 오버레이 폭을 뷰포트 안에 제한한다. 우측 태그 필터 패널은 한 컬럼에서 목록 위로 이동한다. 포스팅 본문의 일반 문장, 긴 URL, 공백 없는 문자열은 포스팅 카드의 안쪽 폭에서 자동 줄바꿈하고, 줄 구조를 보존해야 하는 코드 블록만 내부 가로 스크롤을 사용한다. 관리자 화면은 모바일에서 목록과 편집기를 한 열로 바꾸고 목록 자체의 높이를 제한해 편집기까지의 이동 거리를 통제한다.
- Touch/hover differences: 아이콘 버튼은 터치 가능한 크기를 유지한다. fixed 오버레이의 빈 레일은 아래 메뉴 클릭을 막지 않되, 설정 사이드바는 최상위 전체-뷰포트 오버레이로 열려 클릭/닫기/배경 클릭/Escape를 받는다.

## Interaction states
- Loading: 기존 상태 컴포넌트로 표시.
- Empty: 빈 결과 안내와 다음 행동 제공.
- Error: 재시도 가능 메시지.
- Success: 저장/반영 완료 상태 표시.
- Disabled: 실제 동작이 없는 관리자 탭은 노출하지 않는다.
- Offline/slow network, if applicable: 로컬 캐시를 먼저 보여주고 서버 응답으로 갱신한다.

## Content voice
- Tone: 짧고 직접적인 한국어.
- Terminology: `아무 글`, `자료`, `방명록`, `설정`, `검색`을 고정 사용.
- Microcopy rules: 관리자/방문자 기능을 혼동하지 않게 분리해서 적는다. 방명록 이름은 `이름 (선택)`과 `비우면 ㅇㅁ으로 표시돼요.`로 선택 항목임을 밝힌다. 비밀번호는 `비밀번호`로 짧게 표기하고 `방명록을 지울 때 사용해요.`라는 보조 문구로 용도를 설명한다.

## Implementation constraints
- Framework/styling system: Vite + React + TypeScript, 전역 CSS 토큰.
- Design-token constraints: 색상/폭/버튼 크기는 공통 토큰 변경을 우선한다.
- Performance constraints: GitHub Pages 정적 호스팅, Apps Script 응답은 캐시 우선 표시. 아무 글/자료는 전체 데이터를 메모리에 둔 채 검색과 태그를 전체 대상으로 수행하고, DOM 렌더링만 초기 묶음과 추가 묶음으로 제한한다.
- Compatibility constraints: React SPA 라우팅, GitHub Pages `404.html` fallback, 경로 직접 입력/새로고침, trailing slash 보정 유지.
- Test/screenshot expectations: UI/라우팅 변경 후 typecheck/build, 직접 URL 진입, 내부 링크 무reload 이동, 주요 DOM 구조 확인.

## Open questions
- [ ] 실제 다국어/다크테마를 언제 활성화할지 / 관리자 / 낮음
- [ ] 설정 사이드바에 표시할 추가 방문자 옵션 / 관리자 / 낮음
