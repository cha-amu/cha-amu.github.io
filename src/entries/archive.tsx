import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { TagList } from '../components/TagList';
import { TagFilterPanel, countTagOptions } from '../components/TagFilterPanel';
import { refreshArchive, usePublicResource } from '../stores/publicDataStore';
import type { ArchiveAsset } from '../types';
import { normalizeText } from '../utils/strings';

export function ArchivePage() {
  const archiveResource = usePublicResource('archive');
  const assets = archiveResource.items;
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [modalAsset, setModalAsset] = useState<ArchiveAsset | null>(null);

  const load = () => {
    void refreshArchive({ force: true, silent: assets.length > 0 }).catch(() => undefined);
  };

  useEffect(() => {
    void refreshArchive({ silent: assets.length > 0 }).catch(() => undefined);
  }, []);

  const tags = useMemo(() => countTagOptions(assets), [assets]);
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return assets.filter((asset) => {
      const tagOk = selectedTags.length === 0 || selectedTags.every((tag) => asset.tags.includes(tag));
      const queryOk = !q || [asset.title, asset.description || '', asset.fileName, asset.path, ...asset.tags]
        .some((part) => normalizeText(part).includes(q));
      return tagOk && queryOk;
    });
  }, [assets, query, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const resetFilters = () => {
    setQuery('');
    setSelectedTags([]);
  };

  return (
    <AppLayout>
      <h1 className="sr-only">자료</h1>
      <div className="tagged-layout">
        <main className="tagged-main">
          {archiveResource.refreshing ? <p className="meta">최신 자료 확인 중</p> : null}
          {archiveResource.status === 'loading' ? <LoadingState /> : null}
          {archiveResource.status === 'error' ? <ErrorState message={archiveResource.error} onRetry={load} /> : null}
          {archiveResource.status === 'ready' && !filtered.length ? <EmptyState label="조건에 맞는 자료가 없습니다." /> : null}
          <section className="archive-grid" aria-label="자료 목록">
            {filtered.map((asset) => (
              <article className={`asset-card ${window.location.hash === `#${asset.id}` ? 'list-item--active' : ''}`} id={asset.id} key={asset.id}>
                <button className="asset-card__button" type="button" onClick={() => setModalAsset(asset)} aria-label={`${asset.title} 자료 자세히 보기`}>
                  {asset.kind === 'file' ? (
                    <span className="asset-file-tile">{asset.fileName}</span>
                  ) : (
                    <img src={asset.imageUrl} alt="" loading="lazy" />
                  )}
                  <div className="asset-card__body">
                    <strong>{asset.title}</strong>
                    <TagList tags={asset.tags} />
                  </div>
                </button>
              </article>
            ))}
          </section>
        </main>
        <TagFilterPanel
          label="자료"
          query={query}
          searchPlaceholder="자료 검색"
          visibleCount={filtered.length}
          tags={tags}
          selectedTags={selectedTags}
          onQueryChange={setQuery}
          onToggleTag={toggleTag}
          onClearTags={() => setSelectedTags([])}
          onClearFilters={resetFilters}
        />
      </div>
      {modalAsset ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${modalAsset.title} 자료 상세`} onClick={() => setModalAsset(null)}>
          <div className="modal asset-modal" onClick={(event) => event.stopPropagation()}>
            <button className="asset-modal__close" type="button" onClick={() => setModalAsset(null)} aria-label="닫기">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <h2>{modalAsset.title}</h2>
            {modalAsset.kind === 'file' ? (
              <a className="asset-file-tile asset-file-tile--modal" href={modalAsset.fileUrl || modalAsset.sourceUrl || modalAsset.imageUrl} target="_blank" rel="noreferrer">
                {modalAsset.fileName}
              </a>
            ) : (
              <img src={modalAsset.imageUrl} alt={modalAsset.title} />
            )}
            {modalAsset.description ? <MarkdownView markdown={modalAsset.description} baseUrl={modalAsset.markdownBaseUrl} rootUrl={modalAsset.markdownRootUrl} /> : null}
            <TagList tags={modalAsset.tags} />
            {modalAsset.sourceUrl ? <p className="meta"><a href={modalAsset.sourceUrl} target="_blank" rel="noreferrer">출처</a></p> : null}
            <p className="meta">{modalAsset.path}</p>
          </div>
        </div>
      ) : null}
    </AppLayout>
  );
}
