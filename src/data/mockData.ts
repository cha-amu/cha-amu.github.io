import { translate } from '../i18n';
import type { ArchiveAsset, GuestbookEntry } from '../types';

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
