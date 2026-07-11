import { useEffect, useMemo, useRef, useState } from 'react';
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
import { navigateTo, readHashId } from '../utils/router';
import { normalizeText } from '../utils/strings';

const ARCHIVE_BATCH_SIZE = 24;
type ArchiveSortMode = 'latest' | 'oldest' | 'name';

function compareAssetNames(a: ArchiveAsset, b: ArchiveAsset, locale: string) {
  return a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: 'base' });
}

function assetTimestamp(asset: ArchiveAsset) {
  for (const value of [asset.updatedAt, asset.createdAt]) {
    const timestamp = Date.parse(value || '');
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function sortAssets(assets: ArchiveAsset[], mode: ArchiveSortMode, locale: string) {
  return [...assets].sort((a, b) => {
    if (mode === 'name') return compareAssetNames(a, b, locale);

    const aTimestamp = assetTimestamp(a);
    const bTimestamp = assetTimestamp(b);
    if (aTimestamp === null && bTimestamp === null) return compareAssetNames(a, b, locale);
    if (aTimestamp === null) return 1;
    if (bTimestamp === null) return -1;

    const dateOrder = mode === 'latest' ? bTimestamp - aTimestamp : aTimestamp - bTimestamp;
    return dateOrder || compareAssetNames(a, b, locale);
  });
}

export function ArchivePage() {
  const { locale, t } = useI18n();
  const archiveResource = usePublicResource('archive');
  const assets = archiveResource.items;
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<ArchiveSortMode>('latest');
  const [selectedId, setSelectedId] = useState(() => readHashId());
  const modalBackdropRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const load = () => {
    void refreshArchive({ force: true, silent: assets.length > 0 }).catch(() => undefined);
  };

  useEffect(() => {
    void refreshArchive({ silent: assets.length > 0 }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const syncHash = () => setSelectedId(readHashId());
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
    };
  }, []);

  const tags = useMemo(() => countTagOptions(assets, locale), [assets, locale]);
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    const matchingAssets = assets.filter((asset) => {
      const tagOk = selectedTags.length === 0 || selectedTags.every((tag) => asset.tags.includes(tag));
      const queryOk = !q || [asset.title, asset.description || '', asset.fileName, asset.path, ...asset.tags]
        .some((part) => normalizeText(part).includes(q));
      return tagOk && queryOk;
    });
    return sortAssets(matchingAssets, sortMode, locale);
  }, [assets, locale, query, selectedTags, sortMode]);
  const {
    visibleItems: visibleAssets,
    shownCount,
    totalCount,
    hasMore,
    loadMore,
    ensureVisible
  } = useIncrementalItems(filtered, ARCHIVE_BATCH_SIZE);
  const selectedIndex = useMemo(() => filtered.findIndex((asset) => asset.id === selectedId), [filtered, selectedId]);
  const modalAsset = useMemo(() => assets.find((asset) => asset.id === selectedId) || null, [assets, selectedId]);

  useEffect(() => {
    ensureVisible(selectedIndex);
  }, [ensureVisible, selectedIndex]);

  const openAsset = (asset: ArchiveAsset) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigateTo(`/archive/#${encodeURIComponent(asset.id)}`);
  };

  const closeAsset = () => {
    const fallback = document.getElementById(selectedId)?.querySelector<HTMLElement>('.asset-card__button') || null;
    navigateTo('/archive/', { replace: true });
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : fallback;
      target?.focus();
      returnFocusRef.current = null;
    });
  };

  useEffect(() => {
    if (!modalAsset) return;

    const backdrop = modalBackdropRef.current;
    const backgroundElements = Array.from(backdrop?.parentElement?.children || [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop);
    backgroundElements.forEach((element) => element.setAttribute('inert', ''));

    const frame = window.requestAnimationFrame(() => modalCloseRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAsset();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      backgroundElements.forEach((element) => element.removeAttribute('inert'));
    };
  }, [modalAsset]);

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
      <section className="content-filter-bar archive-filter-bar" aria-label={t('archive.controls')}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('archive.search')} aria-label={t('archive.searchQuery')} />
        <label className="archive-sort">
          <span className="sr-only">{t('archive.sort')}</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as ArchiveSortMode)} aria-label={t('archive.sort')}>
            <option value="latest">{t('archive.sortLatest')}</option>
            <option value="oldest">{t('archive.sortOldest')}</option>
            <option value="name">{t('archive.sortName')}</option>
          </select>
        </label>
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
              <article className={`asset-card ${selectedId === asset.id ? 'list-item--active' : ''}`} id={asset.id} key={asset.id}>
                <button className="asset-card__button" type="button" onClick={() => openAsset(asset)} aria-label={t('archive.details', { title: asset.title })}>
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
        <div ref={modalBackdropRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('archive.dialog', { title: modalAsset.title })} onClick={closeAsset}>
          <div ref={modalRef} className="modal asset-modal" onClick={(event) => event.stopPropagation()}>
            <button ref={modalCloseRef} className="asset-modal__close" type="button" onClick={closeAsset} aria-label={t('common.close')}>
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
