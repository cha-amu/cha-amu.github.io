import type { ArchiveAsset, GuestbookEntry, Post } from '../types';

export const mockPosts: Post[] = [
  {
    id: 'welcome',
    slug: 'welcome',
    title: '채아무 시작 기록',
    excerpt: '사이트가 연결되기 전까지 보이는 예시 글입니다.',
    body: '# 채아무\n\n아무글은 관리자가 Markdown으로 작성해서 올리는 공간입니다.\n\n- 외부 이미지 URL 사용 가능\n- 태그 검색 가능\n- 관리자 페이지에서 작성/수정 예정',
    tags: ['공지', '예시'],
    status: 'published',
    createdAt: '2026-07-09T00:00:00.000Z',
    publishedAt: '2026-07-09T00:00:00.000Z'
  }
];

export const mockGuestbook: GuestbookEntry[] = [
  {
    id: 'sample-guestbook',
    name: '방문자',
    message: 'Apps Script 연결 전까지 보이는 예시 방명록입니다.',
    status: 'visible',
    createdAt: '2026-07-09T00:00:00.000Z'
  }
];

export const mockAssets: ArchiveAsset[] = [
  {
    id: 'sample-asset',
    path: 'images/2026/sample.png',
    imageUrl: '/assets/ui/archive-icon.png',
    fileName: 'sample.png',
    title: '자료 예시',
    description: '이미지 repo manifest가 연결되기 전까지 보이는 예시 자료입니다.',
    tags: ['예시', '자료'],
    status: 'visible',
    createdAt: '2026-07-09T00:00:00.000Z'
  }
];
