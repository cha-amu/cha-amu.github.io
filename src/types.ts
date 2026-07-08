export type ContentStatus = 'draft' | 'published' | 'visible' | 'hidden' | 'deleted';

export interface Post {
  id: string;
  slug?: string;
  title: string;
  excerpt?: string;
  body: string;
  tags: string[];
  status: 'draft' | 'published' | 'hidden';
  createdAt: string;
  updatedAt?: string;
  publishedAt?: string;
}

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  status: 'visible' | 'hidden' | 'deleted';
  createdAt: string;
  hiddenReason?: string;
}

export interface ArchiveAsset {
  id: string;
  path: string;
  imageUrl: string;
  fileName: string;
  title: string;
  description?: string;
  tags: string[];
  width?: number;
  height?: number;
  size?: number;
  sourceUrl?: string;
  status: 'visible' | 'hidden' | 'deleted';
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ArchiveManifest {
  version: number;
  generatedAt: string;
  assets: ArchiveAsset[];
}

export interface AssetOverride {
  assetId: string;
  displayName?: string;
  description?: string;
  tags?: string[];
  sourceUrl?: string;
  status?: 'visible' | 'hidden' | 'deleted';
  sortOrder?: number;
  updatedAt?: string;
}

export interface SearchResult {
  id: string;
  type: 'post' | 'asset';
  title: string;
  excerpt: string;
  tags: string[];
  href: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface AdminSession {
  token: string;
  expiresAt?: string;
}
