import { config } from '../config';
import { mockAssets } from '../data/mockData';
import type { ArchiveAsset, ArchiveManifest, AssetOverride } from '../types';

export async function loadArchiveManifest(): Promise<ArchiveManifest> {
  try {
    const response = await fetch(config.archiveManifestUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`Archive manifest request failed: ${response.status}`);
    const manifest = (await response.json()) as ArchiveManifest;
    return {
      version: manifest.version || 1,
      generatedAt: manifest.generatedAt || '',
      assets: Array.isArray(manifest.assets) ? manifest.assets : []
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
