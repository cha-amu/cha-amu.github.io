export type ContentStatus = 'draft' | 'published' | 'visible' | 'hidden' | 'deleted';

export interface Post {
  id: string;
  slug?: string;
  title: string;
  excerpt?: string;
  body: string;
  tags: string[];
  status: 'draft' | 'published' | 'hidden' | 'deleted';
  createdAt: string;
  updatedAt?: string;
  publishedAt?: string;
  source?: 'sheets' | 'storage';
  storagePath?: string;
  bodyUrl?: string;
  markdownBaseUrl?: string;
  markdownRootUrl?: string;
}

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  status: 'visible' | 'hidden' | 'deleted';
  createdAt: string;
  hiddenReason?: string;
}

export interface GuestbookAdminEntry extends GuestbookEntry {
  ipBanAvailable?: boolean;
  ipBlocked?: boolean;
  relatedEntryCount?: number;
}

export interface GuestbookIpBan {
  sourceEntryId: string | null;
  reason: string;
  bannedAt: string;
  relatedEntryCount: number;
  relatedEntryIds: string[];
}

export interface Thing {
  id: string;
  title: string;
  description?: string;
  url: string;
  imageUrl?: string;
  status: 'visible' | 'hidden';
  sortOrder: number;
  updatedAt: string;
}

export interface ArchiveAsset {
  id: string;
  path: string;
  kind?: 'image' | 'file';
  imageUrl?: string;
  fileUrl?: string;
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
  source?: 'sheets' | 'storage';
  storagePath?: string;
  metadataPath?: string;
  markdownBaseUrl?: string;
  markdownRootUrl?: string;
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
  date?: string;
  fileName?: string;
  imageUrl?: string;
  kind?: ArchiveAsset['kind'];
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface AdminSession {
  token: string;
  expiresAt?: string;
}
