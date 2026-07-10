import { Component, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writeCachedPosts } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { ErrorState, LoadingState, EmptyState } from '../components/PageState';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { MarkdownView } from '../components/MarkdownView';
import { TagList } from '../components/TagList';
import { TagFilterPanel, countTagOptions } from '../components/TagFilterPanel';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { refreshPosts, usePublicResource } from '../stores/publicDataStore';
import { formatDate } from '../utils/date';
import { excerpt, normalizeText } from '../utils/strings';

const POSTS_BATCH_SIZE = 10;

export class PostsErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: '' };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : '아무 글 화면을 표시하지 못했습니다.' };
  }

  render() {
    if (this.state.message) {
      return (
        <AppLayout>
          <ErrorState
            message={`아무 글 화면을 복구했습니다. ${this.state.message}`}
            onRetry={() => { writeCachedPosts([]); window.location.reload(); }}
          />
        </AppLayout>
      );
    }
    return this.props.children;
  }
}

export function PostsPage() {
  const postsResource = usePublicResource('posts');
  const posts = postsResource.items;
  const postsCount = useRef(posts.length);
  const [selectedId, setSelectedId] = useState(() => decodeURIComponent(window.location.hash.replace('#', '')));
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    postsCount.current = posts.length;
  }, [posts.length]);

  const load = useCallback((options: { force?: boolean; silent?: boolean } = {}) => {
    void refreshPosts({ force: options.force, silent: options.silent ?? postsCount.current > 0 }).catch(() => undefined);
  }, []);

  useEffect(() => {
    load({ silent: postsCount.current > 0 });
  }, [load]);

  useEffect(() => {
    const syncHash = () => setSelectedId(decodeURIComponent(window.location.hash.replace('#', '')));
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
    };
  }, []);

  useEffect(() => {
    if (!selectedId && posts[0]) setSelectedId(posts[0].id);
  }, [posts, selectedId]);

  const tagOptions = useMemo(() => countTagOptions(posts), [posts]);
  const filteredPosts = useMemo(() => {
    const q = normalizeText(query);
    return posts.filter((post) => {
      const tagOk = selectedTags.length === 0 || selectedTags.every((tag) => post.tags.includes(tag));
      const queryOk = !q || [post.title, post.excerpt || '', post.body, ...post.tags]
        .some((part) => normalizeText(part).includes(q));
      return tagOk && queryOk;
    });
  }, [posts, query, selectedTags]);
  const selectedPost = useMemo(() => filteredPosts.find((post) => post.id === selectedId) || null, [filteredPosts, selectedId]);
  const {
    visibleItems: visiblePosts,
    shownCount,
    totalCount,
    hasMore,
    loadMore,
    ensureVisible
  } = useIncrementalItems(filteredPosts, POSTS_BATCH_SIZE);
  const selectedIndex = useMemo(() => filteredPosts.findIndex((post) => post.id === selectedId), [filteredPosts, selectedId]);

  useEffect(() => {
    if (filteredPosts.length && !filteredPosts.some((post) => post.id === selectedId)) setSelectedId(filteredPosts[0].id);
  }, [filteredPosts, selectedId]);

  useEffect(() => {
    ensureVisible(selectedIndex);
  }, [ensureVisible, selectedIndex]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const resetFilters = () => {
    setQuery('');
    setSelectedTags([]);
  };

  return (
    <AppLayout>
      <h1 className="sr-only">아무 글</h1>
      {postsResource.status === 'loading' ? <LoadingState /> : null}
      {postsResource.status === 'error' ? <ErrorState message={postsResource.error} onRetry={() => load({ force: true })} /> : null}
      {postsResource.status === 'ready' && !posts.length ? <EmptyState label="아직 공개된 글이 없습니다." /> : null}
      {postsResource.status === 'ready' && posts.length ? (
        <>
          <section className="content-filter-bar" aria-label="아무 글 검색">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="글 검색" aria-label="아무 글 검색어" />
            <span className="result-count" aria-live="polite">
              {shownCount === totalCount ? `${totalCount}개 표시 중` : `${totalCount}개 중 ${shownCount}개 표시`}
            </span>
            {query.trim() || selectedTags.length ? <button className="filter-reset" type="button" onClick={resetFilters}>초기화</button> : null}
          </section>
          <div className="tagged-layout">
            <section className="post-flow tagged-main" aria-label="아무 글 목록">
              {visiblePosts.map((post) => {
                const expanded = selectedPost?.id === post.id;
                return (
                  <article className={`post-entry ${expanded ? 'post-entry--active' : ''}`} id={post.id} key={post.id}>
                    <a className="post-entry__summary" href={`#${encodeURIComponent(post.id)}`} onClick={() => setSelectedId(post.id)}>
                      <h2>{post.title}</h2>
                      <p>{post.excerpt || excerpt(post.body)}</p>
                      <TagList tags={post.tags} />
                      <p className="meta">{formatDate(post.publishedAt || post.createdAt)}</p>
                    </a>
                    {expanded ? (
                      <div className="post-entry__body">
                        <MarkdownView markdown={post.body} baseUrl={post.markdownBaseUrl} rootUrl={post.markdownRootUrl} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {filteredPosts.length === 0 ? <EmptyState label="선택한 태그에 맞는 글이 없습니다." /> : null}
              <IncrementalLoadMore
                hasMore={hasMore}
                label={`글 ${Math.min(POSTS_BATCH_SIZE, totalCount - shownCount)}개 더보기`}
                onLoadMore={loadMore}
              />
            </section>
            <TagFilterPanel
              label="아무 글"
              tags={tagOptions}
              selectedTags={selectedTags}
              onToggleTag={toggleTag}
              onClearTags={() => setSelectedTags([])}
            />
          </div>
        </>
      ) : null}
      <BackToTopButton />
    </AppLayout>
  );
}
