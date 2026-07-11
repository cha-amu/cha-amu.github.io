import { useEffect, useMemo } from 'react';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { SearchForm } from '../components/SearchForm';
import { TagList } from '../components/TagList';
import { refreshArchive, refreshPosts, usePublicResource } from '../stores/publicDataStore';
import type { SearchResult } from '../types';
import { buildSearchResults } from '../utils/search';
import { useI18n } from '../i18n';

function getQuery(): string {
  return new URLSearchParams(window.location.search).get('q') || '';
}

export function SearchPage() {
  const { t } = useI18n();
  const query = getQuery();
  const postsResource = usePublicResource('posts');
  const archiveResource = usePublicResource('archive');
  const hasUsableData = postsResource.items.length > 0 || archiveResource.items.length > 0;
  const isLoading = !hasUsableData && (postsResource.status === 'loading' || archiveResource.status === 'loading');
  const error = !hasUsableData && (postsResource.error || archiveResource.error);

  const load = () => {
    void Promise.all([
      refreshPosts({ force: true, silent: postsResource.items.length > 0 }),
      refreshArchive({ force: true, silent: archiveResource.items.length > 0 })
    ]).catch(() => undefined);
  };

  useEffect(() => {
    void refreshPosts({ silent: postsResource.items.length > 0 }).catch(() => undefined);
    void refreshArchive({ silent: archiveResource.items.length > 0 }).catch(() => undefined);
  }, []);

  const results: SearchResult[] = useMemo(
    () => buildSearchResults(postsResource.items, archiveResource.items, query),
    [postsResource.items, archiveResource.items, query]
  );

  return (
    <AppLayout>
      <h1 className="sr-only">{t('search.pageTitle')}</h1>
      <section className="panel search-panel">
        <SearchForm initialValue={query} compact />
      </section>
      {query ? <p className="meta">{t('search.queryLabel')} <strong>{query}</strong></p> : <p className="meta">{t('search.help')}</p>}
      {postsResource.refreshing || archiveResource.refreshing ? <p className="meta">{t('search.refreshing')}</p> : null}
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!isLoading && !error && query && !results.length ? <EmptyState label={t('search.empty')} /> : null}
      {results.length ? (
        <section className="stack" aria-label={t('search.results')}>
          {results.map((result) => (
            <a className="list-item" href={result.href} key={`${result.type}-${result.id}`}>
              <p className="meta">{result.type === 'post' ? t('search.resultPost') : t('search.resultArchive')}</p>
              <h2>{result.title}</h2>
              <p>{result.excerpt}</p>
              <TagList tags={result.tags} />
            </a>
          ))}
        </section>
      ) : null}
    </AppLayout>
  );
}
