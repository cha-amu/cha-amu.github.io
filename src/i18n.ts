import { useCallback, useSyncExternalStore } from 'react';

export type LanguagePreference = 'auto' | 'ko' | 'en';
export type AppLanguage = Exclude<LanguagePreference, 'auto'>;

const STORAGE_KEY = 'cha-amu:language-preference:v1';

const ko = {
  'brand.name': '그냥 아무거나 올리는 채널',
  'brand.tagline': '그냥 아무거나 올리는 채널',
  'nav.posts': '아무 글',
  'nav.archive': '자료',
  'nav.guestbook': '방명록',
  'nav.search': '검색',
  'nav.settings': '설정',
  'nav.admin': '관리자',
  'aria.mainMenu': '주요 메뉴',
  'aria.topMenu': '상단 주요 메뉴',
  'aria.home': '홈으로 이동',
  'aria.tools': '공통 도구',
  'common.loading': '불러오는 중입니다.',
  'common.retry': '재시도',
  'common.close': '닫기',
  'common.save': '저장',
  'common.saving': '저장 중',
  'common.cancel': '취소',
  'common.reset': '초기화',
  'common.untitled': '(제목 없음)',
  'common.noDate': '날짜 없음',
  'common.count': '{count}개',
  'common.showing': '{count}개 표시 중',
  'common.showingOf': '{total}개 중 {shown}개 표시',
  'common.backToTop': '맨 위로',
  'common.source': '출처',
  'common.all': '전체',
  'search.title': '검색',
  'search.open': '검색 열기',
  'search.close': '검색 닫기',
  'search.query': '통합 검색어',
  'search.placeholder': '검색어',
  'search.inputPlaceholder': '검색창',
  'settings.open': '설정 열기',
  'settings.close': '설정 닫기',
  'settings.title': '설정',
  'settings.language': '언어',
  'settings.languageHelp': '브라우저 설정을 따르거나 표시 언어를 직접 고를 수 있습니다.',
  'settings.auto': '자동',
  'settings.korean': '한국어',
  'settings.english': 'English',
  'settings.languageKorean': '한국어',
  'settings.languageEnglish': '영어',
  'settings.autoStatus': '브라우저 설정에 따라 {language}로 표시 중입니다.',
  'settings.fixedStatus': '{language}로 표시 중입니다.',
  'settings.theme': '테마',
  'settings.themeHelp': '지금은 밝은 테마만 제공합니다.',
  'settings.lightTheme': '밝은 테마',
  'settings.storageHelp': '선택한 언어는 이 브라우저에 저장되며 관리자 화면에도 적용됩니다.',
  'tags.label': '태그',
  'tags.filter': '{label} 태그 필터',
  'tags.collapse': '태그 접기',
  'tags.more': '태그 {count}개 더보기',
  'home.logoAlt': '그냥 아무거나 올리는 채널 아이콘',
  'home.menu': '주요 메뉴',
  'page.notFound': '없는 페이지입니다.',
  'page.goHome': '홈으로 이동',
  'posts.title': '아무 글',
  'posts.failed': '아무 글 화면을 표시하지 못했습니다.',
  'posts.recovered': '아무 글 화면을 복구했습니다. {message}',
  'posts.empty': '아직 공개된 글이 없습니다.',
  'posts.search': '아무 글 검색',
  'posts.searchQuery': '아무 글 검색어',
  'posts.searchPlaceholder': '글 검색',
  'posts.list': '아무 글 목록',
  'posts.noTagMatch': '선택한 태그에 맞는 글이 없습니다.',
  'posts.loadMore': '글 {count}개 더보기',
  'archive.title': '자료',
  'archive.search': '자료 검색',
  'archive.searchQuery': '자료 검색어',
  'archive.refreshing': '최신 자료 확인 중',
  'archive.empty': '조건에 맞는 자료가 없습니다.',
  'archive.list': '자료 목록',
  'archive.details': '{title} 자료 자세히 보기',
  'archive.dialog': '{title} 자료 상세',
  'archive.loadMore': '자료 {count}개 더보기',
  'search.pageTitle': '통합 검색',
  'search.queryLabel': '검색어:',
  'search.help': '아무 글과 자료를 검색합니다. 방명록은 제외합니다.',
  'search.refreshing': '최신 검색 데이터 확인 중',
  'search.empty': '검색 결과가 없습니다.',
  'search.results': '검색 결과',
  'search.resultPost': '아무글',
  'search.resultArchive': '자료',
  'guestbook.title': '방명록',
  'guestbook.open': '글 남기기',
  'guestbook.form': '방명록 글 남기기',
  'guestbook.message': '메시지',
  'guestbook.name': '이름',
  'guestbook.nameOptional': '이름 (선택)',
  'guestbook.nameHelp': '비우면 ㅇㅁ으로 표시돼요.',
  'guestbook.password': '비밀번호',
  'guestbook.passwordHelp': '방명록을 지울 때 사용해요.',
  'guestbook.website': '웹사이트',
  'guestbook.write': '작성',
  'guestbook.sending': '전송 중',
  'guestbook.required': '메시지와 비밀번호를 입력해야 합니다.',
  'guestbook.humanRequired': '사람인지 확인을 완료해 주세요.',
  'guestbook.optimistic': '전송 중입니다. 글은 먼저 화면에 표시했습니다.',
  'guestbook.saved': '방명록을 남겼습니다.',
  'guestbook.saveFailed': '저장에 실패했습니다.',
  'guestbook.deletePrompt': '글을 지우려면 작성할 때 입력한 비밀번호를 입력하세요.',
  'guestbook.deleteFailed': '삭제에 실패했습니다.',
  'guestbook.list': '방명록 목록',
  'guestbook.empty': '아직 방명록이 없습니다.',
  'guestbook.pending': '서버 반영 확인 중',
  'guestbook.delete': '글 지우기',
  'guestbook.deleteBy': '{name}님의 방명록 글 지우기',
  'guestbook.loadMore': '방명록 {count}개 더보기',
  'turnstile.loadFailed': '보안 확인을 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
  'turnstile.missingKey': 'Turnstile site key가 아직 설정되지 않았습니다. 배포 전 `VITE_TURNSTILE_SITE_KEY`를 설정해야 합니다.',
  'turnstile.label': 'Cloudflare Turnstile',
  'errors.apiRequest': 'API 요청에 실패했습니다. ({status})',
  'errors.invalidApiResponse': 'API 응답 형식이 올바르지 않습니다.',
  'errors.postsLoad': '아무 글을 불러오지 못했습니다.',
  'errors.guestbookLoad': '방명록을 불러오지 못했습니다.',
  'errors.archiveLoad': '자료 목록을 불러오지 못했습니다.',
  'mock.post.title': '그냥 아무거나 올리는 채널 시작 기록',
  'mock.post.excerpt': '사이트가 연결되기 전까지 보이는 예시 글입니다.',
  'mock.post.body': '# 그냥 아무거나 올리는 채널\n\n아무 글은 관리자가 Markdown으로 작성해서 올리는 공간입니다.\n\n- 외부 이미지 URL 사용 가능\n- 태그 검색 가능\n- 관리자 페이지에서 작성 및 수정',
  'mock.guestbook.name': '방문자',
  'mock.guestbook.message': 'Apps Script 연결 전까지 보이는 예시 방명록입니다.',
  'mock.archive.title': '자료 예시',
  'mock.archive.description': '자료 manifest가 연결되기 전까지 보이는 예시 자료입니다.',
  'mock.tag.notice': '공지',
  'mock.tag.example': '예시',
  'mock.tag.archive': '자료',
  'admin.title': '관리자',
  'admin.lead': '글 작성, 자료 표시 정보, 방명록 관리를 처리합니다.',
  'admin.menu': '관리자 메뉴',
  'admin.logout': '로그아웃',
  'admin.sessionExpired': '세션이 만료되었습니다. 다시 로그인하면 작성 중인 화면으로 돌아올 수 있습니다.',
  'admin.login.title': '관리자 로그인',
  'admin.login.lead': '글 작성, 방명록 관리, 자료 표시 정보 수정을 여기서 합니다.',
  'admin.login.password': '관리자 비밀번호',
  'admin.login.checking': '확인 중',
  'admin.login.submit': '로그인',
  'admin.login.humanRequired': '사람인지 확인을 완료해 주세요.',
  'admin.login.failed': '로그인에 실패했습니다.',
  'admin.tab.posts': '아무 글',
  'admin.tab.assets': '자료',
  'admin.tab.guestbook': '방명록',
  'admin.status.published': '공개',
  'admin.status.draft': '임시저장',
  'admin.status.hidden': '숨김',
  'admin.status.visible': '공개',
  'admin.status.deleted': '삭제됨',
  'admin.posts.newMessage': '새 글을 작성합니다. 상태가 공개면 저장 후 /posts/에 표시됩니다.',
  'admin.posts.loadFailed': '글 목록을 불러오지 못했습니다.',
  'admin.posts.bodyRequired': '본문을 입력하세요.',
  'admin.posts.savingMessage': '저장 중입니다.',
  'admin.posts.savedPublished': '저장했습니다. 공개 글 목록에도 바로 반영했습니다.',
  'admin.posts.savedStatus': '저장했습니다. 현재 상태는 {status}입니다.',
  'admin.posts.saveFailed': '저장에 실패했습니다.',
  'admin.posts.previewTitle': '제목 미리보기',
  'admin.posts.manage': '아무 글 관리',
  'admin.posts.help': '상태가 공개인 글만 방문자 `/posts/` 화면에 표시됩니다.',
  'admin.posts.editorTabs': '글 작성 화면',
  'admin.posts.edit': '편집',
  'admin.posts.preview': '미리보기',
  'admin.posts.new': '새 글 작성',
  'admin.posts.list': '글 목록',
  'admin.posts.loading': '불러오는 중',
  'admin.posts.loadingList': '글 목록을 불러오는 중입니다.',
  'admin.posts.empty': '아직 저장된 글이 없습니다.',
  'admin.posts.editTitle': '글 수정',
  'admin.posts.titleField': '제목',
  'admin.posts.statusField': '상태',
  'admin.posts.tagsField': '태그',
  'admin.posts.tagsPlaceholder': '쉼표로 구분',
  'admin.posts.excerptField': '요약',
  'admin.posts.bodyField': '본문 Markdown',
  'admin.posts.draftHelp': '작성 중인 내용은 이 브라우저에 임시 보관됩니다.',
  'admin.posts.previewWidth': '공개 페이지와 같은 너비로 표시됩니다.',
  'admin.posts.previewEmpty': '본문을 입력하면 미리보기가 표시됩니다.',
  'admin.assets.loadFailed': '자료 정보를 불러오지 못했습니다.',
  'admin.assets.saved': '자료 override를 저장했습니다.',
  'admin.assets.saveFailed': '저장에 실패했습니다.',
  'admin.assets.loading': '자료 정보를 불러오는 중입니다.',
  'admin.assets.empty': '등록된 자료가 없습니다.',
  'admin.assets.note': '이미지 파일은 저장소에서 관리합니다. 여기서는 표시 정보만 수정합니다.',
  'admin.assets.search': '자료 검색',
  'admin.assets.list': '자료 목록',
  'admin.assets.noResults': '검색 결과가 없습니다.',
  'admin.assets.displayInfo': '자료 표시 정보',
  'admin.assets.displayName': '표시명',
  'admin.assets.description': '설명',
  'admin.assets.tags': '태그',
  'admin.assets.sourceUrl': '출처 URL',
  'admin.assets.status': '상태',
  'admin.assets.sortOrder': '정렬값',
  'admin.guestbook.loadFailed': '방명록을 불러오지 못했습니다.',
  'admin.guestbook.hidden': '방명록 글을 숨겼습니다.',
  'admin.guestbook.hideFailed': '숨김 처리에 실패했습니다.',
  'admin.guestbook.restored': '방명록 글을 다시 공개했습니다.',
  'admin.guestbook.restoreFailed': '복구에 실패했습니다.',
  'admin.guestbook.blockConfirm': '이 글 작성자의 IP를 방명록 작성 차단 목록에 추가할까요?\n차단 해제 전까지 새 글을 남길 수 없습니다.',
  'admin.guestbook.relatedNote': ' 같은 IP로 연결된 글은 {count}개입니다.',
  'admin.guestbook.blocked': '이 작성자의 IP를 차단했습니다.{note}',
  'admin.guestbook.unblocked': '이 작성자의 IP 차단을 해제했습니다.{note}',
  'admin.guestbook.blockFailed': 'IP 차단에 실패했습니다.',
  'admin.guestbook.unblockFailed': 'IP 차단 해제에 실패했습니다.',
  'admin.guestbook.unblockSourceMissing': '차단 해제에 사용할 연결 글을 찾지 못했습니다.',
  'admin.guestbook.banListLoadFailed': 'IP 차단 목록을 불러오지 못했습니다.',
  'admin.guestbook.manage': '방명록 관리',
  'admin.guestbook.entriesHelp': '작성 내용과 공개 상태를 관리합니다.',
  'admin.guestbook.bansHelp': '현재 차단 중인 항목과 관련 글을 확인하고 해제합니다.',
  'admin.guestbook.screen': '방명록 관리 화면',
  'admin.guestbook.entries': '글 목록',
  'admin.guestbook.bans': 'IP 차단',
  'admin.guestbook.filters': '방명록 상태 필터',
  'admin.guestbook.limited': '전체 관리 목록 연결 전이라 현재는 공개 글만 표시합니다.',
  'admin.guestbook.loading': '방명록을 불러오는 중입니다.',
  'admin.guestbook.emptyStatus': '해당 상태의 방명록 글이 없습니다.',
  'admin.guestbook.hiddenReason': '숨김 사유: {reason}',
  'admin.guestbook.ipBlocked': 'IP 차단 중',
  'admin.guestbook.ipBlockAvailableRelated': 'IP 차단 가능 · 연결 {count}개',
  'admin.guestbook.ipBlockAvailable': 'IP 차단 가능',
  'admin.guestbook.ipUnavailable': 'IP 정보 없음',
  'admin.guestbook.blockBy': '{name} 작성자의 IP 차단',
  'admin.guestbook.unblockBy': '{name} 작성자의 IP 차단 해제',
  'admin.guestbook.block': 'IP 차단',
  'admin.guestbook.unblock': 'IP 차단 해제',
  'admin.guestbook.hide': '숨기기',
  'admin.guestbook.restoring': '복구 중',
  'admin.guestbook.restore': '다시 보이기',
  'admin.guestbook.more': '{count}개 더보기',
  'admin.bans.loading': 'IP 차단 목록을 불러오는 중입니다.',
  'admin.bans.empty': '차단 중인 IP가 없습니다.',
  'admin.bans.list': 'IP 차단 목록',
  'admin.bans.activeCount': '차단 중 {count}개',
  'admin.bans.active': '차단 중',
  'admin.bans.unblocking': '해제 중',
  'admin.bans.sourcePreview': '차단 기준 글',
  'admin.bans.relatedPreview': '연결된 글 미리보기',
  'admin.bans.sourceMissing': '차단 기준 글과 연결된 글을 현재 목록에서 찾지 못했습니다.',
  'admin.bans.reason': '사유',
  'admin.bans.defaultReason': '관리자 수동 차단',
  'admin.bans.relatedEntries': '연결된 글',
  'admin.bans.relatedCount': '{count}개',
  'admin.bans.showRelated': '연결된 글 {count}개 보기',
  'admin.bans.visibleRelated': '현재 방명록 목록에서 {count}개를 확인할 수 있습니다.',
  'admin.hide.title': '방명록 글 숨기기',
  'admin.hide.description': '{name}님의 글을 공개 목록에서 숨깁니다.',
  'admin.hide.reason': '숨김 사유',
  'admin.hide.processing': '처리 중'
} as const;

export type TranslationKey = keyof typeof ko;
export type TranslationParams = Record<string, string | number>;
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const en: Record<TranslationKey, string> = {
  'brand.name': 'Channel amu',
  'brand.tagline': 'A channel for whatever',
  'nav.posts': 'Posts',
  'nav.archive': 'Archive',
  'nav.guestbook': 'Guestbook',
  'nav.search': 'Search',
  'nav.settings': 'Settings',
  'nav.admin': 'Admin',
  'aria.mainMenu': 'Main menu',
  'aria.topMenu': 'Top navigation',
  'aria.home': 'Go home',
  'aria.tools': 'Site tools',
  'common.loading': 'Loading.',
  'common.retry': 'Retry',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.saving': 'Saving',
  'common.cancel': 'Cancel',
  'common.reset': 'Reset',
  'common.untitled': '(Untitled)',
  'common.noDate': 'No date',
  'common.count': '{count}',
  'common.showing': 'Showing {count}',
  'common.showingOf': 'Showing {shown} of {total}',
  'common.backToTop': 'Back to top',
  'common.source': 'Source',
  'common.all': 'All',
  'search.title': 'Search',
  'search.open': 'Open search',
  'search.close': 'Close search',
  'search.query': 'Search query',
  'search.placeholder': 'Search',
  'search.inputPlaceholder': 'Search',
  'settings.open': 'Open settings',
  'settings.close': 'Close settings',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageHelp': 'Follow your browser or choose a display language.',
  'settings.auto': 'Auto',
  'settings.korean': '한국어',
  'settings.english': 'English',
  'settings.languageKorean': 'Korean',
  'settings.languageEnglish': 'English',
  'settings.autoStatus': 'Using {language} from your browser settings.',
  'settings.fixedStatus': 'Displaying in {language}.',
  'settings.theme': 'Theme',
  'settings.themeHelp': 'Only the light theme is available for now.',
  'settings.lightTheme': 'Light theme',
  'settings.storageHelp': 'Your language choice is saved in this browser and also applies to the admin pages.',
  'tags.label': 'Tags',
  'tags.filter': '{label} tag filters',
  'tags.collapse': 'Show fewer tags',
  'tags.more': 'Show {count} more tags',
  'home.logoAlt': 'Channel amu icon',
  'home.menu': 'Main menu',
  'page.notFound': 'Page not found.',
  'page.goHome': 'Go home',
  'posts.title': 'Posts',
  'posts.failed': 'Could not display the posts page.',
  'posts.recovered': 'The posts page recovered. {message}',
  'posts.empty': 'There are no public posts yet.',
  'posts.search': 'Search posts',
  'posts.searchQuery': 'Post search query',
  'posts.searchPlaceholder': 'Search posts',
  'posts.list': 'Post list',
  'posts.noTagMatch': 'No posts match the selected tags.',
  'posts.loadMore': 'Load more posts ({count})',
  'archive.title': 'Archive',
  'archive.search': 'Search archive',
  'archive.searchQuery': 'Archive search query',
  'archive.refreshing': 'Checking for new archive items',
  'archive.empty': 'No archive items match these filters.',
  'archive.list': 'Archive items',
  'archive.details': 'View details for {title}',
  'archive.dialog': '{title} details',
  'archive.loadMore': 'Load more archive items ({count})',
  'search.pageTitle': 'Site search',
  'search.queryLabel': 'Query:',
  'search.help': 'Searches posts and the archive. Guestbook entries are excluded.',
  'search.refreshing': 'Checking for updated search data',
  'search.empty': 'No search results.',
  'search.results': 'Search results',
  'search.resultPost': 'Post',
  'search.resultArchive': 'Archive',
  'guestbook.title': 'Guestbook',
  'guestbook.open': 'Leave a message',
  'guestbook.form': 'Leave a guestbook message',
  'guestbook.message': 'Message',
  'guestbook.name': 'Name',
  'guestbook.nameOptional': 'Name (optional)',
  'guestbook.nameHelp': 'Leave this blank to appear as ㅇㅁ.',
  'guestbook.password': 'Password',
  'guestbook.passwordHelp': 'Used when deleting your message.',
  'guestbook.website': 'Website',
  'guestbook.write': 'Post',
  'guestbook.sending': 'Sending',
  'guestbook.required': 'Enter a message and password.',
  'guestbook.humanRequired': 'Complete the human verification.',
  'guestbook.optimistic': 'Sending. Your message is shown while the server confirms it.',
  'guestbook.saved': 'Your guestbook message was posted.',
  'guestbook.saveFailed': 'Could not save your message.',
  'guestbook.deletePrompt': 'Enter the password you used when posting this message.',
  'guestbook.deleteFailed': 'Could not delete the message.',
  'guestbook.list': 'Guestbook messages',
  'guestbook.empty': 'There are no guestbook messages yet.',
  'guestbook.pending': 'Waiting for server confirmation',
  'guestbook.delete': 'Delete message',
  'guestbook.deleteBy': 'Delete guestbook message by {name}',
  'guestbook.loadMore': 'Load more guestbook messages ({count})',
  'turnstile.loadFailed': 'Could not load the security check. Try again shortly.',
  'turnstile.missingKey': 'The Turnstile site key is not configured. Set `VITE_TURNSTILE_SITE_KEY` before deployment.',
  'turnstile.label': 'Cloudflare Turnstile',
  'errors.apiRequest': 'The API request failed. ({status})',
  'errors.invalidApiResponse': 'The API response format is invalid.',
  'errors.postsLoad': 'Could not load posts.',
  'errors.guestbookLoad': 'Could not load the guestbook.',
  'errors.archiveLoad': 'Could not load the archive.',
  'mock.post.title': 'Starting Channel amu',
  'mock.post.excerpt': 'This sample post is shown until the site data is connected.',
  'mock.post.body': '# Channel amu\n\nPosts are written in Markdown by the administrator.\n\n- External image URLs\n- Tag search\n- Create and edit from the admin page',
  'mock.guestbook.name': 'Visitor',
  'mock.guestbook.message': 'This sample guestbook message is shown until Apps Script is connected.',
  'mock.archive.title': 'Archive sample',
  'mock.archive.description': 'This sample item is shown until the archive manifest is connected.',
  'mock.tag.notice': 'Notice',
  'mock.tag.example': 'Sample',
  'mock.tag.archive': 'Archive',
  'admin.title': 'Admin',
  'admin.lead': 'Manage posts, archive display details, and guestbook entries.',
  'admin.menu': 'Admin menu',
  'admin.logout': 'Log out',
  'admin.sessionExpired': 'Your session expired. Log in again to return to your draft.',
  'admin.login.title': 'Admin login',
  'admin.login.lead': 'Manage posts, guestbook entries, and archive display details here.',
  'admin.login.password': 'Admin password',
  'admin.login.checking': 'Checking',
  'admin.login.submit': 'Log in',
  'admin.login.humanRequired': 'Complete the human verification.',
  'admin.login.failed': 'Login failed.',
  'admin.tab.posts': 'Posts',
  'admin.tab.assets': 'Archive',
  'admin.tab.guestbook': 'Guestbook',
  'admin.status.published': 'Public',
  'admin.status.draft': 'Draft',
  'admin.status.hidden': 'Hidden',
  'admin.status.visible': 'Public',
  'admin.status.deleted': 'Deleted',
  'admin.posts.newMessage': 'Creating a new post. Public posts appear on /posts/ after saving.',
  'admin.posts.loadFailed': 'Could not load the post list.',
  'admin.posts.bodyRequired': 'Enter the post body.',
  'admin.posts.savingMessage': 'Saving.',
  'admin.posts.savedPublished': 'Saved and updated the public post list.',
  'admin.posts.savedStatus': 'Saved with status: {status}.',
  'admin.posts.saveFailed': 'Could not save the post.',
  'admin.posts.previewTitle': 'Title preview',
  'admin.posts.manage': 'Manage posts',
  'admin.posts.help': 'Only public posts are shown to visitors on `/posts/`.',
  'admin.posts.editorTabs': 'Post editor view',
  'admin.posts.edit': 'Edit',
  'admin.posts.preview': 'Preview',
  'admin.posts.new': 'New post',
  'admin.posts.list': 'Post list',
  'admin.posts.loading': 'Loading',
  'admin.posts.loadingList': 'Loading the post list.',
  'admin.posts.empty': 'No posts have been saved yet.',
  'admin.posts.editTitle': 'Edit post',
  'admin.posts.titleField': 'Title',
  'admin.posts.statusField': 'Status',
  'admin.posts.tagsField': 'Tags',
  'admin.posts.tagsPlaceholder': 'Separate with commas',
  'admin.posts.excerptField': 'Summary',
  'admin.posts.bodyField': 'Body Markdown',
  'admin.posts.draftHelp': 'Your draft is temporarily stored in this browser.',
  'admin.posts.previewWidth': 'Shown at the same width as the public page.',
  'admin.posts.previewEmpty': 'Enter body text to see a preview.',
  'admin.assets.loadFailed': 'Could not load archive details.',
  'admin.assets.saved': 'Saved the archive override.',
  'admin.assets.saveFailed': 'Could not save changes.',
  'admin.assets.loading': 'Loading archive details.',
  'admin.assets.empty': 'No archive items are registered.',
  'admin.assets.note': 'Files are managed in storage. Edit only their display details here.',
  'admin.assets.search': 'Search archive',
  'admin.assets.list': 'Archive items',
  'admin.assets.noResults': 'No search results.',
  'admin.assets.displayInfo': 'Archive display details',
  'admin.assets.displayName': 'Display name',
  'admin.assets.description': 'Description',
  'admin.assets.tags': 'Tags',
  'admin.assets.sourceUrl': 'Source URL',
  'admin.assets.status': 'Status',
  'admin.assets.sortOrder': 'Sort order',
  'admin.guestbook.loadFailed': 'Could not load guestbook entries.',
  'admin.guestbook.hidden': 'The guestbook message is now hidden.',
  'admin.guestbook.hideFailed': 'Could not hide the message.',
  'admin.guestbook.restored': 'The guestbook message is public again.',
  'admin.guestbook.restoreFailed': 'Could not restore the message.',
  'admin.guestbook.blockConfirm': 'Block this author IP from posting in the guestbook?\nThey cannot leave new messages until unblocked.',
  'admin.guestbook.relatedNote': ' {count} entries are linked to the same IP.',
  'admin.guestbook.blocked': 'Blocked this author IP.{note}',
  'admin.guestbook.unblocked': 'Unblocked this author IP.{note}',
  'admin.guestbook.blockFailed': 'Could not block the IP.',
  'admin.guestbook.unblockFailed': 'Could not unblock the IP.',
  'admin.guestbook.unblockSourceMissing': 'Could not find a linked entry to unblock this IP.',
  'admin.guestbook.banListLoadFailed': 'Could not load the IP block list.',
  'admin.guestbook.manage': 'Manage guestbook',
  'admin.guestbook.entriesHelp': 'Manage message content and visibility.',
  'admin.guestbook.bansHelp': 'Review and remove active IP blocks.',
  'admin.guestbook.screen': 'Guestbook management view',
  'admin.guestbook.entries': 'Messages',
  'admin.guestbook.bans': 'IP blocks',
  'admin.guestbook.filters': 'Guestbook status filters',
  'admin.guestbook.limited': 'Only public messages are shown until the full admin list is connected.',
  'admin.guestbook.loading': 'Loading guestbook messages.',
  'admin.guestbook.emptyStatus': 'No guestbook messages have this status.',
  'admin.guestbook.hiddenReason': 'Hidden because: {reason}',
  'admin.guestbook.ipBlocked': 'IP blocked',
  'admin.guestbook.ipBlockAvailableRelated': 'IP can be blocked · {count} linked',
  'admin.guestbook.ipBlockAvailable': 'IP can be blocked',
  'admin.guestbook.ipUnavailable': 'No IP data',
  'admin.guestbook.blockBy': 'Block IP for {name}',
  'admin.guestbook.unblockBy': 'Unblock IP for {name}',
  'admin.guestbook.block': 'Block IP',
  'admin.guestbook.unblock': 'Unblock IP',
  'admin.guestbook.hide': 'Hide',
  'admin.guestbook.restoring': 'Restoring',
  'admin.guestbook.restore': 'Make public',
  'admin.guestbook.more': 'Load more ({count})',
  'admin.bans.loading': 'Loading the IP block list.',
  'admin.bans.empty': 'No IPs are currently blocked.',
  'admin.bans.list': 'IP block list',
  'admin.bans.activeCount': '{count} active blocks',
  'admin.bans.active': 'Blocked',
  'admin.bans.unblocking': 'Unblocking',
  'admin.bans.sourcePreview': 'Source message',
  'admin.bans.relatedPreview': 'Linked message preview',
  'admin.bans.sourceMissing': 'The source and linked messages are not in the current guestbook list.',
  'admin.bans.reason': 'Reason',
  'admin.bans.defaultReason': 'Manual admin block',
  'admin.bans.relatedEntries': 'Linked messages',
  'admin.bans.relatedCount': '{count}',
  'admin.bans.showRelated': 'Show {count} linked messages',
  'admin.bans.visibleRelated': '{count} are available in the current guestbook list.',
  'admin.hide.title': 'Hide guestbook message',
  'admin.hide.description': 'Hide the message by {name} from the public list.',
  'admin.hide.reason': 'Reason for hiding',
  'admin.hide.processing': 'Working'
};

type LanguageSnapshot = {
  preference: LanguagePreference;
  language: AppLanguage;
};

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || value === 'ko' || value === 'en';
}

function readPreference(): LanguagePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLanguagePreference(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') return 'en';
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const value of languages) {
    const language = String(value || '').toLowerCase();
    if (language === 'ko' || language.startsWith('ko-')) return 'ko';
    if (language === 'en' || language.startsWith('en-')) return 'en';
  }
  return 'en';
}

function resolveLanguage(preference: LanguagePreference): AppLanguage {
  return preference === 'auto' ? detectBrowserLanguage() : preference;
}

let snapshot: LanguageSnapshot = {
  preference: readPreference(),
  language: 'en'
};
snapshot = { ...snapshot, language: resolveLanguage(snapshot.preference) };

const listeners = new Set<() => void>();

function applyDocumentLanguage(language: AppLanguage) {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

function updateSnapshot(preference: LanguagePreference) {
  const language = resolveLanguage(preference);
  if (snapshot.preference === preference && snapshot.language === language) return;
  snapshot = { preference, language };
  applyDocumentLanguage(language);
  listeners.forEach((listener) => listener());
}

applyDocumentLanguage(snapshot.language);

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (snapshot.preference === 'auto') updateSnapshot('auto');
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    updateSnapshot(isLanguagePreference(event.newValue) ? event.newValue : 'auto');
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function interpolate(template: string, params: TranslationParams = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in params ? String(params[key]) : match);
}

export function translateFor(language: AppLanguage, key: TranslationKey, params?: TranslationParams) {
  return interpolate((language === 'ko' ? ko : en)[key], params);
}

export function translate(key: TranslationKey, params?: TranslationParams) {
  return translateFor(snapshot.language, key, params);
}

export function setLanguagePreference(preference: LanguagePreference) {
  if (!isLanguagePreference(preference)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The in-memory preference still works when storage is unavailable.
  }
  updateSnapshot(preference);
}

export function getResolvedLanguage() {
  return snapshot.language;
}

export function getLanguageLocale(language: AppLanguage = snapshot.language) {
  return language === 'ko' ? 'ko-KR' : 'en-US';
}

export function formatLocalizedNumber(value: number, language: AppLanguage = snapshot.language) {
  return new Intl.NumberFormat(getLanguageLocale(language)).format(value);
}

export function useI18n() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const t: Translate = useCallback(
    (key, params) => translateFor(current.language, key, params),
    [current.language]
  );

  return {
    ...current,
    locale: getLanguageLocale(current.language),
    t,
    setLanguagePreference
  };
}
