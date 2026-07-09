import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { loadArchiveManifest } from '../api/archiveManifestClient';
import { adminHideGuestbook, adminListAssetOverrides, adminListPosts, adminLogin, adminRefreshSession, adminSaveAssetOverride, adminSavePost, listGuestbook, readCachedPosts, writeCachedPosts } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState } from '../components/PageState';
import { TagList } from '../components/TagList';
import type { ArchiveAsset, AssetOverride, GuestbookEntry, Post } from '../types';
import { clearAdminSession, loadAdminSession, refreshAdminSession, saveAdminSession } from '../utils/session';
import { splitTags } from '../utils/strings';

type Tab = 'posts' | 'assets' | 'guestbook' | 'settings';

const TAB_LABELS: Record<Tab, string> = {
  posts: '아무 글',
  assets: '자료',
  guestbook: '방명록',
  settings: '설정'
};

const POST_STATUS_LABELS: Record<Post['status'], string> = {
  published: '공개',
  draft: '임시저장',
  hidden: '숨김'
};


const ADMIN_POST_DRAFT_KEY = 'cha-amu:admin-post-draft:v1';

function readAdminPostDraft(): { current: Partial<Post>; tagsText: string } | null {
  try {
    const raw = window.localStorage.getItem(ADMIN_POST_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { current: Partial<Post>; tagsText: string };
  } catch (_) {
    return null;
  }
}

function writeAdminPostDraft(current: Partial<Post>, tagsText: string) {
  try {
    window.localStorage.setItem(ADMIN_POST_DRAFT_KEY, JSON.stringify({ current, tagsText, savedAt: new Date().toISOString() }));
  } catch (_) {
    // Draft persistence must not break writing.
  }
}

const blankPost = (): Partial<Post> => ({
  title: '',
  excerpt: '',
  body: '',
  tags: [],
  status: 'published'
});

function sortPostsByNewest(posts: Post[]) {
  return [...posts].sort((a, b) => {
    const left = a.publishedAt || a.updatedAt || a.createdAt || '';
    const right = b.publishedAt || b.updatedAt || b.createdAt || '';
    return right.localeCompare(left);
  });
}

function syncPublicPostCache(saved: Post) {
  const cached = readCachedPosts().filter((post) => post.id !== saved.id);
  if (saved.status === 'published') {
    writeCachedPosts(sortPostsByNewest([saved, ...cached]));
    return;
  }
  writeCachedPosts(cached);
}

function LoginPanel({ onLogin, initialMessage = '' }: { onLogin: () => void; initialMessage?: string }) {
  const [message, setMessage] = useState(initialMessage);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') || '');
    setSaving(true);
    setMessage('');
    try {
      const session = await adminLogin({ password });
      saveAdminSession(session);
      onLogin();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <section className="admin-page-head" aria-labelledby="admin-login-title">
        <div>
          <h1 id="admin-login-title" className="page-title">관리자 로그인</h1>
          <p className="lead">글 작성, 방명록 관리, 자료 표시 정보 수정을 여기서 합니다.</p>
        </div>
      </section>
      <form className="panel admin-login-panel" onSubmit={submit}>
        <div className="field">
          <label htmlFor="admin-password">관리자 비밀번호</label>
          <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
          <span className="help-text">세션 유지 테스트 기본값은 활동 없음 1분입니다.</span>
        </div>
        {message ? <p className="status-message status-message--danger">{message}</p> : null}
        <button className="button button--primary" type="submit" disabled={saving}>{saving ? '확인 중' : '로그인'}</button>
      </form>
    </AppLayout>
  );
}

function isAdminSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Admin session expired') || message.includes('Invalid admin session') || message.includes('Admin session is required');
}

function PostsAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const restoredDraft = useMemo(() => readAdminPostDraft(), []);
  const [posts, setPosts] = useState<Post[]>([]);
  const [current, setCurrent] = useState<Partial<Post>>(() => restoredDraft?.current || blankPost());
  const [tagsText, setTagsText] = useState(restoredDraft?.tagsText || '');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectPost = (post: Post) => {
    setCurrent(post);
    setTagsText((post.tags || []).join(', '));
    setMessage('');
  };

  const startNewPost = () => {
    setCurrent(blankPost());
    setTagsText('');
    setMessage('새 글을 작성합니다. 상태가 공개면 저장 후 /posts/에 표시됩니다.');
  };

  const load = () => {
    setLoading(true);
    return adminListPosts(token)
      .then((items) => setPosts(sortPostsByNewest(items)))
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(err instanceof Error ? err.message : '글 목록을 불러오지 못했습니다.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { void load(); }, [token]);
  useEffect(() => { writeAdminPostDraft(current, tagsText); }, [current, tagsText]);

  const updateCurrent = <K extends keyof Post>(key: K, value: Post[K]) => {
    setCurrent((post) => ({ ...post, [key]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const post: Partial<Post> = {
      ...current,
      title: String(current.title || '').trim(),
      excerpt: String(current.excerpt || '').trim(),
      body: String(current.body || ''),
      tags: splitTags(tagsText),
      status: (current.status || 'published') as Post['status']
    };

    setSaving(true);
    setMessage('저장 중입니다.');
    try {
      const saved = await adminSavePost(token, post);
      setPosts((items) => sortPostsByNewest([saved, ...items.filter((item) => item.id !== saved.id)]));
      setCurrent(saved);
      setTagsText((saved.tags || []).join(', '));
      syncPublicPostCache(saved);
      setMessage(saved.status === 'published' ? '저장했습니다. 공개 글 목록에도 바로 반영했습니다.' : `저장했습니다. 현재 상태는 ${POST_STATUS_LABELS[saved.status]}입니다.`);
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const previewTags = splitTags(tagsText);
  const previewTitle = String(current.title || '').trim() || '제목 미리보기';
  const previewExcerpt = String(current.excerpt || '').trim();

  return (
    <section className="admin-posts" aria-label="아무 글 관리">
      <header className="panel admin-section-head">
        <div>
          <h2>아무 글 관리</h2>
          <p className="help-text">상태가 공개인 글만 방문자 `/posts/` 화면에 표시됩니다.</p>
        </div>
        <button className="button button--primary" type="button" onClick={startNewPost}>새 글 작성</button>
      </header>

      <div className="admin-post-layout">
        <aside className="panel admin-list-panel" aria-label="글 목록">
          <div className="admin-list-panel__top">
            <strong>글 목록</strong>
            <span>{posts.length}개</span>
          </div>
          {loading ? <p className="status-message">글 목록을 불러오는 중입니다.</p> : null}
          {!loading && !posts.length ? <EmptyState label="아직 저장된 글이 없습니다." /> : null}
          <div className="admin-list">
            {posts.map((post) => (
              <button className={`admin-list-card ${current.id === post.id ? 'admin-list-card--active' : ''}`} type="button" key={post.id} onClick={() => selectPost(post)}>
                <span className={`status-chip status-chip--${post.status}`}>{POST_STATUS_LABELS[post.status]}</span>
                <strong>{post.title || '(제목 없음)'}</strong>
                <small>{post.updatedAt || post.createdAt || '날짜 없음'}</small>
              </button>
            ))}
          </div>
        </aside>

        <form className="panel admin-editor" onSubmit={save}>
          <div className="admin-editor__bar">
            <h3>{current.id ? '글 수정' : '새 글 작성'}</h3>
            <button className="button button--primary" type="submit" disabled={saving}>{saving ? '저장 중' : '저장'}</button>
          </div>

          <div className="admin-form-grid">
            <div className="field admin-field--wide">
              <label htmlFor="post-title">제목</label>
              <input id="post-title" name="title" value={current.title || ''} onChange={(event) => updateCurrent('title', event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="post-status">상태</label>
              <select id="post-status" name="status" value={current.status || 'published'} onChange={(event) => updateCurrent('status', event.target.value as Post['status'])}>
                <option value="published">공개</option>
                <option value="draft">임시저장</option>
                <option value="hidden">숨김</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="post-tags">태그</label>
              <input id="post-tags" name="tags" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="쉼표로 구분" />
            </div>
            <div className="field admin-field--wide">
              <label htmlFor="post-excerpt">요약</label>
              <input id="post-excerpt" name="excerpt" value={current.excerpt || ''} onChange={(event) => updateCurrent('excerpt', event.target.value)} />
            </div>
          </div>

          <div className="field admin-writing-rail">
            <label htmlFor="post-body">본문 Markdown</label>
            <textarea className="admin-markdown-input" id="post-body" name="body" value={current.body || ''} onChange={(event) => updateCurrent('body', event.target.value)} required />
            <span className="help-text">입력창과 아래 미리보기는 공개 글 본문 폭과 같은 기준으로 맞춥니다. 작성 중인 내용은 브라우저에 임시 보관됩니다.</span>
          </div>
          {message ? <p className="status-message" role="status">{message}</p> : null}
          <section className="admin-live-preview" aria-label="공개 글 미리보기">
            <div className="admin-preview__head">공개 글 미리보기</div>
            <article className="post-entry post-entry--active">
              <div className="post-entry__summary">
                <h2>{previewTitle}</h2>
                {previewExcerpt ? <p>{previewExcerpt}</p> : null}
                {previewTags.length ? <TagList tags={previewTags} /> : null}
                <p className="meta">저장 후 공개 페이지와 같은 폭으로 보입니다.</p>
              </div>
              <div className="post-entry__body">
                {current.body ? <MarkdownView markdown={current.body} /> : <p className="help-text">본문을 입력하면 실제 공개 글 본문 폭으로 미리보기가 표시됩니다.</p>}
              </div>
            </article>
          </section>
        </form>
      </div>
    </section>
  );
}

function AssetsAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [assets, setAssets] = useState<ArchiveAsset[]>([]);
  const [overrides, setOverrides] = useState<AssetOverride[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([loadArchiveManifest(), adminListAssetOverrides(token)])
      .then(([manifest, nextOverrides]) => { setAssets(manifest.assets); setOverrides(nextOverrides); })
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(err instanceof Error ? err.message : '자료 정보를 불러오지 못했습니다.');
      });
  }, [token]);

  const selected = useMemo(() => assets.find((asset) => asset.id === selectedId) || assets[0], [assets, selectedId]);
  const selectedOverride = overrides.find((override) => override.assetId === selected?.id);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const override: AssetOverride = {
      assetId: selected.id,
      displayName: String(form.get('displayName') || '').trim(),
      description: String(form.get('description') || '').trim(),
      tags: splitTags(String(form.get('tags') || '')),
      sourceUrl: String(form.get('sourceUrl') || '').trim(),
      status: String(form.get('status') || 'visible') as AssetOverride['status'],
      sortOrder: Number(form.get('sortOrder') || 9999)
    };
    try {
      const saved = await adminSaveAssetOverride(token, override);
      setOverrides((items) => [saved, ...items.filter((item) => item.assetId !== saved.assetId)]);
      setMessage('자료 override를 저장했습니다.');
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(err instanceof Error ? err.message : '저장에 실패했습니다.');
    }
  };

  if (!assets.length) return <EmptyState label="manifest에 등록된 자료가 없습니다." />;

  return (
    <section className="two-column">
      <div className="stack">
        <p className="status-message">이미지 업로드/commit은 관리자 페이지에서 하지 않습니다. 이 화면은 manifest 자료의 표시 정보만 보정합니다.</p>
        {assets.map((asset) => (
          <button className="list-item" type="button" key={asset.id} onClick={() => setSelectedId(asset.id)}>
            <strong>{asset.title}</strong>
            <p className="meta">{asset.path}</p>
            <TagList tags={asset.tags} />
          </button>
        ))}
      </div>
      {selected ? (
        <form className="panel" onSubmit={save}>
          <h2>자료 표시 정보</h2>
          <img src={selected.imageUrl} alt={selected.title} />
          <div className="field"><label>표시명<input name="displayName" defaultValue={selectedOverride?.displayName || selected.title} /></label></div>
          <div className="field"><label>설명<textarea name="description" defaultValue={selectedOverride?.description || selected.description || ''} /></label></div>
          <div className="field"><label>태그<input name="tags" defaultValue={(selectedOverride?.tags || selected.tags).join(', ')} /></label></div>
          <div className="field"><label>출처 URL<input name="sourceUrl" defaultValue={selectedOverride?.sourceUrl || selected.sourceUrl || ''} /></label></div>
          <div className="field"><label>상태<select name="status" defaultValue={selectedOverride?.status || selected.status}><option value="visible">visible</option><option value="hidden">hidden</option><option value="deleted">deleted</option></select></label></div>
          <div className="field"><label>정렬값<input name="sortOrder" type="number" defaultValue={selectedOverride?.sortOrder || selected.sortOrder || 9999} /></label></div>
          {message ? <p className="status-message">{message}</p> : null}
          <button className="button button--primary" type="submit">저장</button>
        </form>
      ) : null}
    </section>
  );
}

function GuestbookAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    listGuestbook().then(setEntries).catch((err) => setMessage(err instanceof Error ? err.message : '방명록을 불러오지 못했습니다.'));
  }, []);

  const hide = async (entry: GuestbookEntry) => {
    const hiddenReason = window.prompt('숨김 사유를 입력하세요.') || '';
    if (!hiddenReason) return;
    try {
      await adminHideGuestbook(token, entry.id, hiddenReason);
      setEntries((items) => items.filter((item) => item.id !== entry.id));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(err instanceof Error ? err.message : '숨김 처리에 실패했습니다.');
    }
  };

  return (
    <section className="stack">
      {message ? <p className="status-message">{message}</p> : null}
      {entries.map((entry) => (
        <article className="list-item" key={entry.id}>
          <h2>{entry.name}</h2>
          <p>{entry.message}</p>
          <p className="meta">{entry.status}</p>
          <button className="button button--danger" type="button" onClick={() => hide(entry)}>숨김 처리</button>
        </article>
      ))}
    </section>
  );
}

export function AdminApp() {
  const [session, setSession] = useState(() => loadAdminSession());
  const [tab, setTab] = useState<Tab>('posts');
  const [sessionMessage, setSessionMessage] = useState('');
  const lastServerRefreshAt = useRef(0);
  const refreshInFlight = useRef(false);

  const expireSession = () => {
    clearAdminSession();
    setSession(null);
    setSessionMessage('세션이 만료되었습니다. 다시 로그인하면 작성 중인 화면으로 돌아올 수 있습니다.');
  };

  const touchSession = () => {
    const current = refreshAdminSession();
    setSession(current);
    if (!current) return;

    const now = Date.now();
    if (refreshInFlight.current || now - lastServerRefreshAt.current < 20_000) return;

    refreshInFlight.current = true;
    lastServerRefreshAt.current = now;
    const tokenBeforeRefresh = current.token;
    adminRefreshSession(tokenBeforeRefresh)
      .then((nextSession) => {
        const latest = loadAdminSession();
        if (!latest || latest.token !== tokenBeforeRefresh) return;
        setSession(saveAdminSession(nextSession));
        setSessionMessage('');
      })
      .catch((err) => {
        if (isAdminSessionError(err)) expireSession();
      })
      .finally(() => { refreshInFlight.current = false; });
  };

  useEffect(() => {
    const interval = window.setInterval(() => setSession(loadAdminSession()), 5_000);
    window.addEventListener('click', touchSession);
    window.addEventListener('keydown', touchSession);
    window.addEventListener('input', touchSession);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('click', touchSession);
      window.removeEventListener('keydown', touchSession);
      window.removeEventListener('input', touchSession);
    };
  }, []);

  if (!session) return <LoginPanel initialMessage={sessionMessage} onLogin={() => { setSessionMessage(''); setSession(loadAdminSession()); }} />;

  const logout = () => { clearAdminSession(); setSession(null); setSessionMessage(''); };
  const handleSessionExpired = () => expireSession();
  return (
    <AppLayout>
      <section className="admin-page-head" aria-labelledby="admin-title">
        <div>
          <h1 id="admin-title" className="page-title">관리자</h1>
          <p className="lead">글 작성, 자료 표시 정보, 방명록 관리를 처리합니다.</p>
        </div>
        <button className="button button--danger" type="button" onClick={logout}>로그아웃</button>
      </section>

      <div className="tabs admin-tabs" role="tablist" aria-label="관리자 메뉴">
        {(['posts', 'assets', 'guestbook', 'settings'] as Tab[]).map((item) => (
          <button className={`button ${tab === item ? 'button--primary' : ''}`} type="button" key={item} onClick={() => setTab(item)}>{TAB_LABELS[item]}</button>
        ))}
      </div>

      {tab === 'posts' ? <PostsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
      {tab === 'assets' ? <AssetsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
      {tab === 'guestbook' ? <GuestbookAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
      {tab === 'settings' ? <section className="panel"><h2>설정/로그</h2><p>비밀값은 표시하거나 수정하지 않습니다. settings와 auditLog 조회 API 연결 지점입니다.</p></section> : null}
    </AppLayout>
  );
}
