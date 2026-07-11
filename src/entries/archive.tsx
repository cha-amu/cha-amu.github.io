import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { TagList } from '../components/TagList';
import { TagFilterPanel, countTagOptions } from '../components/TagFilterPanel';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { useI18n } from '../i18n';
import { refreshArchive, usePublicResource } from '../stores/publicDataStore';
import type { ArchiveAsset } from '../types';
import { normalizeText } from '../utils/strings';

const ARCHIVE_BATCH_SIZE = 24;

export function ArchivePage() {
  const { locale, t } = useI18n();
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

  const tags = useMemo(() => countTagOptions(assets, locale), [assets, locale]);
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return assets.filter((asset) => {
      const tagOk = selectedTags.length === 0 || selectedTags.every((tag) => asset.tags.includes(tag));
      const queryOk = !q || [asset.title, asset.description || '', asset.fileName, asset.path, ...asset.tags]
        .some((part) => normalizeText(part).includes(q));
      return tagOk && queryOk;
    });
  }, [assets, query, selectedTags]);
  const {
    visibleItems: visibleAssets,
    shownCount,
    totalCount,
    hasMore,
    loadMore
  } = useIncrementalItems(filtered, ARCHIVE_BATCH_SIZE);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const resetFilters = () => {
    setQuery('');
    setSelectedTags([]);
  };

  return (
    <AppLayout>
      <h1 className="sr-only">{t('archive.title')}</h1>
      <section className="content-filter-bar" aria-label={t('archive.search')}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('archive.search')} aria-label={t('archive.searchQuery')} />
        <span className="result-count" aria-live="polite">
          {shownCount === totalCount ? t('common.showing', { count: totalCount }) : t('common.showingOf', { total: totalCount, shown: shownCount })}
        </span>
        {query.trim() || selectedTags.length ? <button className="filter-reset" type="button" onClick={resetFilters}>{t('common.reset')}</button> : null}
      </section>
      <div className="tagged-layout">
        <main className="tagged-main">
          {archiveResource.refreshing ? <p className="meta">{t('archive.refreshing')}</p> : null}
          {archiveResource.status === 'loading' ? <LoadingState /> : null}
          {archiveResource.status === 'error' ? <ErrorState message={archiveResource.error} onRetry={load} /> : null}
          {archiveResource.status === 'ready' && !filtered.length ? <EmptyState label={t('archive.empty')} /> : null}
          <section className="archive-grid" aria-label={t('archive.list')}>
            {visibleAssets.map((asset) => (
              <article className={`asset-card ${window.location.hash === `#${asset.id}` ? 'list-item--active' : ''}`} id={asset.id} key={asset.id}>
                <button className="asset-card__button" type="button" onClick={() => setModalAsset(asset)} aria-label={t('archive.details', { title: asset.title })}>
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
          <IncrementalLoadMore
            hasMore={hasMore}
            label={t('archive.loadMore', { count: Math.min(ARCHIVE_BATCH_SIZE, totalCount - shownCount) })}
            onLoadMore={loadMore}
          />
        </main>
        <TagFilterPanel
          label={t('archive.title')}
          tags={tags}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          onClearTags={() => setSelectedTags([])}
        />
      </div>
      {modalAsset ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('archive.dialog', { title: modalAsset.title })} onClick={() => setModalAsset(null)}>
          <div className="modal asset-modal" onClick={(event) => event.stopPropagation()}>
            <button className="asset-modal__close" type="button" onClick={() => setModalAsset(null)} aria-label={t('common.close')}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <div className="asset-modal__scroll">
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
              {modalAsset.sourceUrl ? <p className="meta"><a href={modalAsset.sourceUrl} target="_blank" rel="noreferrer">{t('common.source')}</a></p> : null}
              <p className="meta">{modalAsset.path}</p>
            </div>
          </div>
        </div>
      ) : null}
      <BackToTopButton />
    </AppLayout>
  );
}
