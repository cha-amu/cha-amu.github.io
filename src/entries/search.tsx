import { useEffect, useMemo } from 'react';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { SearchForm } from '../components/SearchForm';
import { TagList } from '../components/TagList';
import { refreshArchive, refreshPosts, usePublicResource } from '../stores/publicDataStore';
import type { SearchResult } from '../types';
import { buildSearchResults } from '../utils/search';

function getQuery(): string {
  return new URLSearchParams(window.location.search).get('q') || '';
}

export function SearchPage() {
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
      <h1 className="sr-only">통합 검색</h1>
      <section className="panel search-panel">
        <SearchForm initialValue={query} compact />
      </section>
      {query ? <p className="meta">검색어: <strong>{query}</strong></p> : <p className="meta">아무 글과 자료를 검색합니다. 방명록은 제외합니다.</p>}
      {postsResource.refreshing || archiveResource.refreshing ? <p className="meta">최신 검색 데이터 확인 중</p> : null}
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!isLoading && !error && query && !results.length ? <EmptyState label="검색 결과가 없습니다." /> : null}
      {results.length ? (
        <section className="stack" aria-label="검색 결과">
          {results.map((result) => (
            <a className="list-item" href={result.href} key={`${result.type}-${result.id}`}>
              <p className="meta">{result.type === 'post' ? '아무글' : '자료'}</p>
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
