import type { TranslationKey } from '../i18n';

// Reading sections first (posts and the wiki share one reading layout), then
// the archive to browse, then outbound site and app links.
export const mainMenuItems: Array<{ href: string; labelKey: TranslationKey; icon: string; native?: boolean }> = [
  { href: '/posts/', labelKey: 'nav.posts', icon: '/assets/ui/posts-icon.png' },
  { href: '/wiki/', labelKey: 'nav.wiki', icon: '/assets/ui/guestbook-icon.png' },
  { href: '/archive/', labelKey: 'nav.archive', icon: '/assets/ui/archive-icon.png' },
  { href: '/things/', labelKey: 'nav.things', icon: 'https://cha-amu.github.io/storage/assets/images/2026/아무거--아이콘+사이트+앱--파스텔_돌_캐릭터.png' }
];
