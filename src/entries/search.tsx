import { useEffect, useMemo, useState } from 'react';
import { loadArchiveManifest, mergeAssetOverrides } from '../api/archiveManifestClient';
import { listPosts } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { SearchForm } from '../components/SearchForm';
import { TagList } from '../components/TagList';
import type { ArchiveAsset, Post, SearchResult } from '../types';
import { buildSearchResults } from '../utils/search';

function getQuery(): string {
  return new URLSearchParams(window.location.search).get('q') || '';
}

export function SearchPage() {
  const query = getQuery();
  const [posts, setPosts] = useState<Post[]>([]);
  const [assets, setAssets] = useState<ArchiveAsset[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = () => {
    setStatus('loading');
    Promise.all([listPosts(), loadArchiveManifest()])
      .then(([nextPosts, manifest]) => {
        setPosts(nextPosts);
        setAssets(mergeAssetOverrides(manifest.assets, []));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '검색 데이터를 불러오지 못했습니다.');
        setStatus('error');
      });
  };

  useEffect(load, []);

  const results: SearchResult[] = useMemo(() => buildSearchResults(posts, assets, query), [posts, assets, query]);

  return (
    <AppLayout>
      <h1 className="sr-only">통합 검색</h1>
      <section className="panel search-panel">
        <SearchForm initialValue={query} compact />
      </section>
      {query ? <p className="meta">검색어: <strong>{query}</strong></p> : <p className="meta">아무 글과 자료를 검색합니다. 방명록은 제외합니다.</p>}
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={error} onRetry={load} /> : null}
      {status === 'ready' && query && !results.length ? <EmptyState label="검색 결과가 없습니다." /> : null}
      {status === 'ready' && results.length ? (
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
