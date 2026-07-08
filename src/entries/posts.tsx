import { Component, ReactNode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { listPosts, normalizePosts, readCachedPosts, writeCachedPosts } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { ErrorState, LoadingState, EmptyState } from '../components/PageState';
import { MarkdownView } from '../components/MarkdownView';
import { TagList } from '../components/TagList';
import type { Post } from '../types';
import { formatDate } from '../utils/date';
import { excerpt } from '../utils/strings';

type PostUpdater = Post[] | ((current: Post[]) => Post[]);

class PostsErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
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


function byNewestPost(a: Post, b: Post) {
  return new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime();
}

function mergePosts(serverPosts: unknown) {
  return normalizePosts(serverPosts).filter((post) => post.status === 'published').sort(byNewestPost);
}

function PostsPage() {
  const [initialPosts] = useState(() => mergePosts(readCachedPosts()));
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [selectedId, setSelectedId] = useState(() => decodeURIComponent(window.location.hash.replace('#', '')));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(initialPosts.length ? 'ready' : 'loading');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const commitPosts = (updater: PostUpdater) => {
    setPosts((current) => {
      const nextPosts = typeof updater === 'function' ? updater(current) : updater;
      writeCachedPosts(nextPosts);
      return nextPosts;
    });
  };

  const load = (options: { silent?: boolean } = {}) => {
    if (options.silent) setRefreshing(true);
    else setStatus(posts.length ? 'ready' : 'loading');
    listPosts()
      .then((serverPosts) => {
        const nextPosts = mergePosts(serverPosts);
        commitPosts(nextPosts);
        setStatus('ready');
        setError('');
        if (!selectedId && nextPosts[0]) setSelectedId(nextPosts[0].id);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '아무 글을 불러오지 못했습니다.');
        setStatus((currentStatus) => (posts.length || currentStatus === 'ready' ? 'ready' : 'error'));
      })
      .finally(() => setRefreshing(false));
  };

  useEffect(() => load({ silent: initialPosts.length > 0 }), []);
  useEffect(() => {
    const syncHash = () => setSelectedId(decodeURIComponent(window.location.hash.replace('#', '')));
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const selectedPost = useMemo(() => posts.find((post) => post.id === selectedId) || null, [posts, selectedId]);

  return (
    <AppLayout>
      <h1 className="sr-only">아무 글</h1>
      {refreshing ? <p className="meta">최신 글 확인 중</p> : null}
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={error} onRetry={load} /> : null}
      {status === 'ready' && !posts.length ? <EmptyState label="아직 공개된 글이 없습니다." /> : null}
      {status === 'ready' && posts.length ? (
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

createRoot(document.getElementById('root')!).render(<PostsErrorBoundary><PostsPage /></PostsErrorBoundary>);
