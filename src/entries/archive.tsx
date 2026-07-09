import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { TagList } from '../components/TagList';
import { refreshArchive, usePublicResource } from '../stores/publicDataStore';
import type { ArchiveAsset } from '../types';
import { normalizeText, uniqueTags } from '../utils/strings';

export function ArchivePage() {
  const archiveResource = usePublicResource('archive');
  const assets = archiveResource.items;
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [modalAsset, setModalAsset] = useState<ArchiveAsset | null>(null);

  const load = () => {
    void refreshArchive({ force: true, silent: assets.length > 0 }).catch(() => undefined);
  };

  useEffect(() => {
    void refreshArchive({ silent: assets.length > 0 }).catch(() => undefined);
  }, []);

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
      {archiveResource.refreshing ? <p className="meta">최신 자료 확인 중</p> : null}
      {archiveResource.status === 'loading' ? <LoadingState /> : null}
      {archiveResource.status === 'error' ? <ErrorState message={archiveResource.error} onRetry={load} /> : null}
      {archiveResource.status === 'ready' && !filtered.length ? <EmptyState label="조건에 맞는 자료가 없습니다." /> : null}
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
