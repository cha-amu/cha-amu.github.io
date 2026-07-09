import { config } from '../config';
import { mockAssets } from '../data/mockData';
import type { ArchiveAsset, ArchiveManifest, AssetOverride } from '../types';
import { readCache, writeCache } from '../utils/localCache';

const ARCHIVE_ASSETS_CACHE_KEY = 'archive-assets:v1';
const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);

export function readCachedArchiveAssets(): ArchiveAsset[] {
  return readCache<ArchiveAsset[]>(ARCHIVE_ASSETS_CACHE_KEY) || [];
}

export function writeCachedArchiveAssets(assets: ArchiveAsset[]) {
  writeCache(ARCHIVE_ASSETS_CACHE_KEY, assets);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).map((tag) => tag.trim()).filter(Boolean);
  const text = asString(value).trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).split(',').map((tag) => tag.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return text.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function absoluteStorageUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${config.storageBaseUrl}/${pathOrUrl.replace(/^\/+/, '')}`;
}

function extensionOf(path: string): string {
  return path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || '';
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || fileName;
}

function normalizeAsset(value: unknown): ArchiveAsset | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!record) return null;
  const path = asString(record.path || record.storagePath || record.imagePath || record.filePath || record.url || record.imageUrl || record.fileUrl).trim();
  if (!path) return null;
  const fileName = asString(record.fileName).trim() || path.split('/').pop() || path;
  const ext = extensionOf(fileName || path);
  const kind = record.kind === 'file' || record.type === 'file' || !IMAGE_EXTENSIONS.has(ext) ? 'file' : 'image';
  const url = absoluteStorageUrl(asString(record.url || record.imageUrl || record.fileUrl || path));
  return {
    id: asString(record.id).trim() || `asset:${path}`,
    path,
    kind,
    imageUrl: kind === 'image' ? url : undefined,
    fileUrl: kind === 'file' ? url : undefined,
    fileName,
    title: asString(record.title || record.displayName).trim() || titleFromFileName(fileName),
    description: asString(record.description).trim() || undefined,
    tags: normalizeTags(record.tags),
    width: typeof record.width === 'number' ? record.width : undefined,
    height: typeof record.height === 'number' ? record.height : undefined,
    size: typeof record.size === 'number' ? record.size : undefined,
    sourceUrl: asString(record.sourceUrl).trim() || undefined,
    status: record.status === 'hidden' || record.status === 'deleted' ? record.status : 'visible',
    sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : undefined,
    createdAt: asString(record.createdAt).trim() || undefined,
    updatedAt: asString(record.updatedAt).trim() || undefined,
    source: 'storage',
    storagePath: path
  };
}

export async function loadArchiveManifest(): Promise<ArchiveManifest> {
  try {
    const response = await fetch(config.archiveManifestUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`Archive manifest request failed: ${response.status}`);
    const manifest = (await response.json()) as ArchiveManifest;
    const assets = Array.isArray(manifest.assets) ? manifest.assets.map(normalizeAsset).filter((asset): asset is ArchiveAsset => Boolean(asset)) : [];
    return {
      version: manifest.version || 1,
      generatedAt: manifest.generatedAt || '',
      assets
    };
  } catch {
    return {
      version: 1,
      generatedAt: '',
      assets: mockAssets
    };
  }
}

export function mergeAssetOverrides(assets: ArchiveAsset[], overrides: AssetOverride[]): ArchiveAsset[] {
  const byId = new Map(overrides.map((override) => [override.assetId, override]));
  return assets
    .map((asset) => {
      const override = byId.get(asset.id);
      if (!override) return asset;
      return {
        ...asset,
        title: override.displayName || asset.title,
        description: override.description ?? asset.description,
        tags: override.tags ?? asset.tags,
        sourceUrl: override.sourceUrl ?? asset.sourceUrl,
        status: override.status ?? asset.status,
        sortOrder: override.sortOrder ?? asset.sortOrder,
        updatedAt: override.updatedAt ?? asset.updatedAt
      };
    })
    .filter((asset) => asset.status === 'visible')
    .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.title.localeCompare(b.title, 'ko-KR'));
}
