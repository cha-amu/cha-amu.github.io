import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadArchiveManifest, mergeAssetOverrides } from '../api/archiveManifestClient';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { TagList } from '../components/TagList';
import type { ArchiveAsset } from '../types';
import { normalizeText, uniqueTags } from '../utils/strings';

function ArchivePage() {
  const [assets, setAssets] = useState<ArchiveAsset[]>([]);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [modalAsset, setModalAsset] = useState<ArchiveAsset | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = () => {
    setStatus('loading');
    loadArchiveManifest()
      .then((manifest) => {
        setAssets(mergeAssetOverrides(manifest.assets, []));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '자료 목록을 불러오지 못했습니다.');
        setStatus('error');
      });
  };

  useEffect(load, []);

  const tags = useMemo(() => uniqueTags(assets), [assets]);
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return assets.filter((asset) => {
      const tagOk = !selectedTag || asset.tags.includes(selectedTag);
      const queryOk = !q || [asset.title, asset.description || '', asset.fileName, asset.path, ...asset.tags]
        .some((part) => normalizeText(part).includes(q));
      return tagOk && queryOk;
    });
  }, [assets, query, selectedTag]);

  return (
    <AppLayout>
      <h1 className="sr-only">자료</h1>
      <section className="filter-bar panel" aria-label="자료 검색과 필터">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="자료 이름, 설명, 태그 검색" aria-label="자료 검색어" />
        <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} aria-label="태그 필터">
          <option value="">전체 태그</option>
          {tags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}
        </select>
        <button className="button" type="button" onClick={() => { setQuery(''); setSelectedTag(''); }}>초기화</button>
      </section>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={error} onRetry={load} /> : null}
      {status === 'ready' && !filtered.length ? <EmptyState label="조건에 맞는 자료가 없습니다." /> : null}
      <section className="archive-grid" aria-label="자료 목록">
        {filtered.map((asset) => (
          <article className={`asset-card ${window.location.hash === `#${asset.id}` ? 'list-item--active' : ''}`} id={asset.id} key={asset.id}>
            <button className="button--ghost" type="button" onClick={() => setModalAsset(asset)} aria-label={`${asset.title} 이미지 확대`}>
              <img src={asset.imageUrl} alt={asset.title} loading="lazy" />
            </button>
            <div className="asset-card__body">
              <h2>{asset.title}</h2>
              {asset.description ? <p>{asset.description}</p> : null}
              <TagList tags={asset.tags} />
              <p className="meta">{asset.path}</p>
            </div>
          </article>
        ))}
      </section>
      {modalAsset ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="이미지 확대">
          <div className="modal">
            <button className="button" type="button" onClick={() => setModalAsset(null)}>닫기</button>
            <h2>{modalAsset.title}</h2>
            <img src={modalAsset.imageUrl} alt={modalAsset.title} />
          </div>
        </div>
      ) : null}
    </AppLayout>
  );
}

createRoot(document.getElementById('root')!).render(<ArchivePage />);
