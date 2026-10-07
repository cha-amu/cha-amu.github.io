import { useEffect, useMemo } from 'react';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { SearchForm } from '../components/SearchForm';
import { TagList } from '../components/TagList';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { refreshArchive, refreshPosts, usePublicResource } from '../stores/publicDataStore';
import type { SearchResult } from '../types';
import { formatDate } from '../utils/date';
import { buildSearchResults } from '../utils/search';
import { useI18n } from '../i18n';
import { config } from '../config';
import { refreshPublicWiki, usePublicWiki } from '../hooks/usePublicWiki';

const POST_RESULTS_BATCH_SIZE = 10;
const ARCHIVE_RESULTS_BATCH_SIZE = 24;

function getQuery(): string {
  return new URLSearchParams(window.location.search).get('q') || '';
}

function HighlightedText({ text, query, locale }: { text: string; query: string; locale: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const matchIndex = text.toLocaleLowerCase(locale).indexOf(normalizedQuery);
  if (!normalizedQuery || matchIndex < 0) return <>{text}</>;
  const matchEnd = matchIndex + normalizedQuery.length;
  return (
    <>
      {text.slice(0, matchIndex)}
      <mark>{text.slice(matchIndex, matchEnd)}</mark>
      {text.slice(matchEnd)}
    </>
  );
}

function SearchResultCard({ result, query, locale, typeLabel }: {
  result: SearchResult;
  query: string;
  locale: string;
  typeLabel: string;
}) {
  const usesAssetImage = result.type === 'asset' && result.kind !== 'file' && result.imageUrl;
  const thumbnail = usesAssetImage
    ? result.imageUrl
    : result.type === 'post' ? '/assets/ui/posts-icon.png'
      : result.type === 'wiki' ? '/assets/ui/guestbook-icon.png' : '/assets/ui/archive-icon.png';

  return (
    <a className="search-result" href={result.href}>
      <span className={`search-result__thumb ${usesAssetImage ? '' : 'search-result__thumb--icon'}`}>
        <img src={thumbnail} alt="" loading="lazy" />
      </span>
      <div className="search-result__body">
        <span className="search-result__meta">
          <strong className="search-result__type">{typeLabel}</strong>
          {result.date ? <time dateTime={result.date}>{formatDate(result.date)}</time> : null}
          {result.type === 'asset' && result.kind === 'file' && result.fileName ? <span>{result.fileName}</span> : null}
        </span>
        <strong className="search-result__title"><HighlightedText text={result.title} query={query} locale={locale} /></strong>
        {result.excerpt ? <span className="search-result__excerpt"><HighlightedText text={result.excerpt} query={query} locale={locale} /></span> : null}
        <TagList tags={result.tags} />
      </div>
    </a>
  );
}

export function SearchPage() {
  const { locale, t } = useI18n();
  const query = getQuery();
  const postsResource = usePublicResource('posts');
  const archiveResource = usePublicResource('archive');
  const wiki = usePublicWiki();
  const isLoading = [postsResource.status, archiveResource.status, wiki.status]
    .some((status) => status === 'loading' || status === 'idle') || postsResource.refreshing || archiveResource.refreshing;
  const hasError = Boolean(postsResource.error || archiveResource.error || wiki.status === 'error');

  const load = () => {
    void Promise.all([
      refreshPosts({ force: true, silent: postsResource.items.length > 0 }),
      refreshArchive({ force: true, silent: archiveResource.items.length > 0 }),
      refreshPublicWiki(true)
    ]).catch(() => undefined);
  };

  useEffect(() => {
    void refreshPosts({ silent: postsResource.items.length > 0 }).catch(() => undefined);
    void refreshArchive({ silent: archiveResource.items.length > 0 }).catch(() => undefined);
  }, []);

  const results: SearchResult[] = useMemo(
    () => buildSearchResults(postsResource.items, archiveResource.items, query, wiki.index?.documents, config.wikiBaseUrl),
    [postsResource.items, archiveResource.items, query, wiki.index]
  );
  const postResults = useMemo(() => results.filter((result) => result.type === 'post'), [results]);
  const archiveResults = useMemo(() => results.filter((result) => result.type === 'asset'), [results]);
  const wikiResults = useMemo(() => results.filter((result) => result.type === 'wiki'), [results]);
  const postsList = useIncrementalItems(postResults, POST_RESULTS_BATCH_SIZE);
  const archiveList = useIncrementalItems(archiveResults, ARCHIVE_RESULTS_BATCH_SIZE);
  const wikiList = useIncrementalItems(wikiResults, POST_RESULTS_BATCH_SIZE);

  return (
    <AppLayout>
      <h1 className="sr-only">{t('search.pageTitle')}</h1>
      <section className="panel search-panel">
        <SearchForm initialValue={query} compact />
      </section>
      {query ? (
        <div className="search-summary">
          <p className="meta">{t('search.queryLabel')} <strong>{query}</strong></p>
          <p className="result-count" aria-live="polite">{t(isLoading || hasError ? 'search.partialTotal' : 'search.total', { count: results.length })}</p>
        </div>
      ) : <p className="meta">{t('search.help')}</p>}
      {isLoading ? <LoadingState label={t('search.refreshing')} /> : null}
      {postsResource.error ? <ErrorState message={t('search.sourceFailed', { source: t('nav.posts') })} onRetry={load} /> : null}
      {wiki.status === 'error' ? <ErrorState message={t('search.sourceFailed', { source: t('nav.wiki') })} onRetry={() => { void refreshPublicWiki(true); }} /> : null}
      {archiveResource.error ? <ErrorState message={t('search.sourceFailed', { source: t('nav.archive') })} onRetry={load} /> : null}
      {!isLoading && !hasError && query && !results.length ? <EmptyState label={t('search.empty')} /> : null}
      {results.length ? (
        <section className="search-results" aria-label={t('search.results')}>
          {postResults.length ? (
            <section className="search-result-group" aria-labelledby="search-post-results">
              <h2 id="search-post-results">{t('search.postsGroup', { count: postResults.length })}</h2>
              <div className="search-result-list">
                {postsList.visibleItems.map((result) => (
                  <SearchResultCard result={result} query={query} locale={locale} typeLabel={t('search.resultPost')} key={result.id} />
                ))}
              </div>
              <IncrementalLoadMore
                hasMore={postsList.hasMore}
                label={t('search.loadMorePosts', { count: Math.min(POST_RESULTS_BATCH_SIZE, postsList.totalCount - postsList.shownCount) })}
                onLoadMore={postsList.loadMore}
              />
            </section>
          ) : null}
          {wikiResults.length ? (
            <section className="search-result-group" aria-labelledby="search-wiki-results">
              <h2 id="search-wiki-results">{t('search.wikiGroup', { count: wikiResults.length })}</h2>
              <div className="search-result-list">
                {wikiList.visibleItems.map((result) => (
                  <SearchResultCard result={result} query={query} locale={locale} typeLabel={t('nav.wiki')} key={result.id} />
                ))}
              </div>
              <IncrementalLoadMore
                hasMore={wikiList.hasMore}
                label={t('search.loadMoreWiki', { count: Math.min(POST_RESULTS_BATCH_SIZE, wikiList.totalCount - wikiList.shownCount) })}
                onLoadMore={wikiList.loadMore}
              />
            </section>
          ) : null}
          {archiveResults.length ? (
            <section className="search-result-group" aria-labelledby="search-archive-results">
              <h2 id="search-archive-results">{t('search.archiveGroup', { count: archiveResults.length })}</h2>
              <div className="search-result-list">
                {archiveList.visibleItems.map((result) => (
                  <SearchResultCard result={result} query={query} locale={locale} typeLabel={t('search.resultArchive')} key={result.id} />
                ))}
              </div>
              <IncrementalLoadMore
                hasMore={archiveList.hasMore}
                label={t('search.loadMoreArchive', { count: Math.min(ARCHIVE_RESULTS_BATCH_SIZE, archiveList.totalCount - archiveList.shownCount) })}
                onLoadMore={archiveList.loadMore}
              />
            </section>
          ) : null}
        </section>
      ) : null}
      <BackToTopButton />
    </AppLayout>
  );
}
