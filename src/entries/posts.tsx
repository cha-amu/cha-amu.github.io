import { Component, ReactNode, useEffect, useMemo, useState } from 'react';
import { writeCachedPosts } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { ErrorState, LoadingState, EmptyState } from '../components/PageState';
import { MarkdownView } from '../components/MarkdownView';
import { TagList } from '../components/TagList';
import { refreshPosts, usePublicResource } from '../stores/publicDataStore';
import { formatDate } from '../utils/date';
import { excerpt } from '../utils/strings';

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
  const [selectedId, setSelectedId] = useState(() => decodeURIComponent(window.location.hash.replace('#', '')));

  const load = () => {
    void refreshPosts({ force: true, silent: posts.length > 0 }).catch(() => undefined);
  };

  useEffect(() => {
    void refreshPosts({ silent: posts.length > 0 }).catch(() => undefined);
  }, []);

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

  const selectedPost = useMemo(() => posts.find((post) => post.id === selectedId) || null, [posts, selectedId]);

  return (
    <AppLayout>
      <h1 className="sr-only">아무 글</h1>
      {postsResource.refreshing ? <p className="meta">최신 글 확인 중</p> : null}
      {postsResource.status === 'loading' ? <LoadingState /> : null}
      {postsResource.status === 'error' ? <ErrorState message={postsResource.error} onRetry={load} /> : null}
      {postsResource.status === 'ready' && !posts.length ? <EmptyState label="아직 공개된 글이 없습니다." /> : null}
      {postsResource.status === 'ready' && posts.length ? (
        <section className="post-flow" aria-label="아무 글 목록">
          {posts.map((post) => {
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
                    <MarkdownView markdown={post.body} />
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </AppLayout>
  );
}
