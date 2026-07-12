export interface PostTimestampFields {
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}

export function postTimestamp(post: PostTimestampFields): string {
  return post.updatedAt || post.publishedAt || post.createdAt || '';
}
