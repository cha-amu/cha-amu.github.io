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
import { translate, useI18n } from '../i18n';
import { refreshPosts, usePublicResource } from '../stores/publicDataStore';
import { formatDate } from '../utils/date';
import { excerpt, normalizeText } from '../utils/strings';

const POSTS_BATCH_SIZE = 10;

export class PostsErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : '' };
  }

  render() {
    if (this.state.message !== null) {
      return (
        <AppLayout>
          <ErrorState
            message={translate('posts.recovered', { message: this.state.message || translate('posts.failed') })}
            onRetry={() => { writeCachedPosts([]); window.location.reload(); }}
          />
        </AppLayout>
      );
    }
    return this.props.children;
  }
}

export function PostsPage() {
  const { locale, t } = useI18n();
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

  const tagOptions = useMemo(() => countTagOptions(posts, locale), [locale, posts]);
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
      <h1 className="sr-only">{t('posts.title')}</h1>
      {postsResource.status === 'loading' ? <LoadingState /> : null}
      {postsResource.status === 'error' ? <ErrorState message={postsResource.error} onRetry={() => load({ force: true })} /> : null}
      {postsResource.status === 'ready' && !posts.length ? <EmptyState label={t('posts.empty')} /> : null}
      {postsResource.status === 'ready' && posts.length ? (
        <>
          <section className="content-filter-bar" aria-label={t('posts.search')}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('posts.searchPlaceholder')} aria-label={t('posts.searchQuery')} />
            <span className="result-count" aria-live="polite">
              {shownCount === totalCount ? t('common.showing', { count: totalCount }) : t('common.showingOf', { total: totalCount, shown: shownCount })}
            </span>
            {query.trim() || selectedTags.length ? <button className="filter-reset" type="button" onClick={resetFilters}>{t('common.reset')}</button> : null}
          </section>
          <div className="tagged-layout">
            <section className="post-flow tagged-main" aria-label={t('posts.list')}>
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
              {filteredPosts.length === 0 ? <EmptyState label={t('posts.noTagMatch')} /> : null}
              <IncrementalLoadMore
                hasMore={hasMore}
                label={t('posts.loadMore', { count: Math.min(POSTS_BATCH_SIZE, totalCount - shownCount) })}
                onLoadMore={loadMore}
              />
            </section>
            <TagFilterPanel
              label={t('posts.title')}
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
