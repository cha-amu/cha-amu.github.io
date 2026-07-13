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
import { postTimestamp } from '../utils/postTimestamp';
import { readHashId } from '../utils/router';
import { excerpt, normalizeText } from '../utils/strings';

const POSTS_BATCH_SIZE = 10;

interface PendingPostScroll {
  id: string;
  smooth: boolean;
}

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
  const [selectedId, setSelectedId] = useState(() => readHashId());
  const pendingPostScroll = useRef<PendingPostScroll | null>(selectedId ? { id: selectedId, smooth: false } : null);
  const [postScrollRequest, setPostScrollRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const requestPostScroll = useCallback((id: string, smooth: boolean) => {
    pendingPostScroll.current = { id, smooth };
    setPostScrollRequest((current) => current + 1);
  }, []);

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
    const syncHash = () => {
      const hashId = readHashId();
      setSelectedId(hashId);

      if (!hashId) {
        pendingPostScroll.current = null;
        return;
      }
      if (pendingPostScroll.current?.id !== hashId) requestPostScroll(hashId, false);
    };
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
    };
  }, [requestPostScroll]);

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
    if (!filteredPosts.length || filteredPosts.some((post) => post.id === selectedId)) return;

    const pendingId = pendingPostScroll.current?.id;
    const awaitingPendingPost = pendingId === selectedId && !postsResource.loadedAt && !postsResource.error;
    if (awaitingPendingPost) return;

    if (pendingId === selectedId) pendingPostScroll.current = null;
    setSelectedId(filteredPosts[0].id);
  }, [filteredPosts, postsResource.error, postsResource.loadedAt, selectedId]);

  useEffect(() => {
    ensureVisible(selectedIndex);
  }, [ensureVisible, selectedIndex]);

  useEffect(() => {
    const request = pendingPostScroll.current;
    if (!request || request.id !== selectedId) return;
    if (!visiblePosts.some((post) => post.id === request.id)) return;

    let scrollFrame = 0;
    const layoutFrame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        if (pendingPostScroll.current !== request) return;
        const target = document.getElementById(request.id);
        if (!target) return;

        pendingPostScroll.current = null;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const scrollMarginTop = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
        const scrollTop = window.scrollY + target.getBoundingClientRect().top - scrollMarginTop;
        target.focus({ preventScroll: true });
        window.scrollTo({
          behavior: request.smooth && !reduceMotion ? 'smooth' : 'auto',
          top: Math.max(0, scrollTop)
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    };
  }, [postScrollRequest, selectedId, visiblePosts]);

  const openPost = (id: string) => {
    setSelectedId(id);
    requestPostScroll(id, true);
  };

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
                const titleId = `post-title-${encodeURIComponent(post.id)}`;
                const bodyId = `post-body-${encodeURIComponent(post.id)}`;
                return (
                  <article
                    aria-labelledby={titleId}
                    className={`post-entry ${expanded ? 'post-entry--active' : ''}`}
                    id={post.id}
                    key={post.id}
                    tabIndex={expanded ? -1 : undefined}
                  >
                    <a
                      aria-controls={bodyId}
                      aria-expanded={expanded}
                      className="post-entry__summary"
                      href={`#${encodeURIComponent(post.id)}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        openPost(post.id);
                      }}
                    >
                      <h2 id={titleId}>{post.title}</h2>
                      <p>{post.excerpt || excerpt(post.body)}</p>
                      <TagList tags={post.tags} />
                      <p className="meta">{formatDate(postTimestamp(post))}</p>
                    </a>
                    {expanded ? (
                      <div className="post-entry__body" id={bodyId}>
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
