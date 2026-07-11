import { translate } from '../i18n';
import type { ArchiveAsset, GuestbookEntry, Post } from '../types';

export function getMockPosts(): Post[] {
  return [
    {
      id: 'welcome',
      slug: 'welcome',
      title: translate('mock.post.title'),
      excerpt: translate('mock.post.excerpt'),
      body: translate('mock.post.body'),
      tags: [translate('mock.tag.notice'), translate('mock.tag.example')],
      status: 'published',
      createdAt: '2026-07-09T00:00:00.000Z',
      publishedAt: '2026-07-09T00:00:00.000Z'
    }
  ];
}

export function getMockGuestbook(): GuestbookEntry[] {
  return [
    {
      id: 'sample-guestbook',
      name: translate('mock.guestbook.name'),
      message: translate('mock.guestbook.message'),
      status: 'visible',
      createdAt: '2026-07-09T00:00:00.000Z'
    }
  ];
}

export function getMockAssets(): ArchiveAsset[] {
  return [
    {
      id: 'sample-asset',
      path: 'images/2026/sample.png',
      imageUrl: '/assets/ui/archive-icon.png',
      fileName: 'sample.png',
      title: translate('mock.archive.title'),
      description: translate('mock.archive.description'),
      tags: [translate('mock.tag.example'), translate('mock.tag.archive')],
      status: 'visible',
      createdAt: '2026-07-09T00:00:00.000Z'
    }
  ];
}
