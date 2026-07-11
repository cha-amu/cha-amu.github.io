import type { Post } from '../types';

function byNewestPost(a: Post, b: Post) {
  return new Date(b.publishedAt || b.updatedAt || b.createdAt || '').getTime() - new Date(a.publishedAt || a.updatedAt || a.createdAt || '').getTime();
}

export function normalizePostList(posts: Post[]) {
  return posts.filter((post) => post.status === 'published').sort(byNewestPost);
}

function postFreshness(post: Post) {
  const value = post.updatedAt || post.publishedAt || post.createdAt || '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergePostPair(storagePost: Post, sheetPost: Post) {
  const sheetControlsVisibility = sheetPost.status !== 'published';
  const storageIsCurrent = !sheetControlsVisibility && postFreshness(sheetPost) <= postFreshness(storagePost);
  const current = storageIsCurrent ? storagePost : sheetPost;
  const fallback = storageIsCurrent ? sheetPost : storagePost;

  return {
    ...fallback,
    ...current,
    body: current.body || fallback.body,
    excerpt: current.excerpt || fallback.excerpt,
    tags: current.tags.length ? current.tags : fallback.tags,
    source: current.source || fallback.source,
    storagePath: storagePost.storagePath || sheetPost.storagePath,
    bodyUrl: storagePost.bodyUrl || sheetPost.bodyUrl,
    markdownBaseUrl: storagePost.markdownBaseUrl || sheetPost.markdownBaseUrl,
    markdownRootUrl: storagePost.markdownRootUrl || sheetPost.markdownRootUrl
  };
}

export function mergePosts(storagePosts: Post[], sheetPosts: Post[]) {
  const byId = new Map<string, Post>();
  for (const post of storagePosts) byId.set(post.id, { ...post, source: post.source || 'storage' });
  for (const post of sheetPosts) {
    const existing = byId.get(post.id);
    if (!existing) {
      byId.set(post.id, { ...post, source: post.source || 'sheets' });
      continue;
    }
    byId.set(post.id, mergePostPair(existing, { ...post, source: post.source || 'sheets' }));
  }
  return Array.from(byId.values());
}
