import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { loadArchiveManifest } from '../api/archiveManifestClient';
import { adminHideGuestbook, adminListAssetOverrides, adminListGuestbook, adminListPosts, adminLogin, adminRefreshSession, adminRestoreGuestbook, adminSaveAssetOverride, adminSavePost, listGuestbook } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState } from '../components/PageState';
import { TagList } from '../components/TagList';
import { CloseIcon, EyeOffIcon, LogOutIcon, RestoreIcon } from '../components/ToolIcons';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { syncPublicPost } from '../stores/publicDataStore';
import type { ArchiveAsset, AssetOverride, GuestbookEntry, Post } from '../types';
import { formatDate } from '../utils/date';
import { clearAdminSession, loadAdminSession, refreshAdminSession, saveAdminSession } from '../utils/session';
import { splitTags } from '../utils/strings';

type Tab = 'posts' | 'assets' | 'guestbook';
type GuestbookFilter = 'all' | GuestbookEntry['status'];
type EditorView = 'edit' | 'preview';

const TAB_LABELS: Record<Tab, string> = {
  posts: '아무 글',
  assets: '자료',
  guestbook: '방명록'
};

const POST_STATUS_LABELS: Record<Post['status'], string> = {
  published: '공개',
  draft: '임시저장',
  hidden: '숨김'
};

const GUESTBOOK_STATUS_LABELS: Record<GuestbookEntry['status'], string> = {
  visible: '공개',
  hidden: '숨김',
  deleted: '삭제됨'
};

const GUESTBOOK_BATCH_SIZE = 10;


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
  const [editorView, setEditorView] = useState<EditorView>('edit');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLFormElement>(null);

  const moveToEditorOnMobile = () => {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const selectPost = (post: Post) => {
    setCurrent(post);
    setTagsText((post.tags || []).join(', '));
    setEditorView('edit');
    setMessage('');
    moveToEditorOnMobile();
  };

  const startNewPost = () => {
    setCurrent(blankPost());
    setTagsText('');
    setEditorView('edit');
    setMessage('새 글을 작성합니다. 상태가 공개면 저장 후 /posts/에 표시됩니다.');
    moveToEditorOnMobile();
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

    if (!post.body?.trim()) {
      setEditorView('edit');
      setMessage('본문을 입력하세요.');
      window.requestAnimationFrame(() => document.getElementById('post-body')?.focus());
      return;
    }

    setSaving(true);
    setMessage('저장 중입니다.');
    try {
      const saved = await adminSavePost(token, post);
      setPosts((items) => sortPostsByNewest([saved, ...items.filter((item) => item.id !== saved.id)]));
      setCurrent(saved);
      setTagsText((saved.tags || []).join(', '));
      syncPublicPost(saved);
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
        <div className="admin-section-head__actions">
          <div className="admin-view-switch" role="tablist" aria-label="글 작성 화면">
            <button id="admin-edit-tab" className={editorView === 'edit' ? 'admin-view-switch__active' : ''} type="button" role="tab" aria-selected={editorView === 'edit'} aria-controls="admin-edit-panel" onClick={() => setEditorView('edit')}>편집</button>
            <button id="admin-preview-tab" className={editorView === 'preview' ? 'admin-view-switch__active' : ''} type="button" role="tab" aria-selected={editorView === 'preview'} aria-controls="admin-preview-panel" onClick={() => setEditorView('preview')}>미리보기</button>
          </div>
          <button className="button button--primary" type="button" onClick={startNewPost}>새 글 작성</button>
        </div>
      </header>

      {editorView === 'edit' ? (
        <div id="admin-edit-panel" className="admin-post-layout" role="tabpanel" aria-labelledby="admin-edit-tab">
          <aside className="panel admin-list-panel" aria-label="글 목록">
            <div className="admin-list-panel__top">
              <strong>글 목록</strong>
              <span>{loading ? '불러오는 중' : `${posts.length}개`}</span>
            </div>
            {loading ? <p className="status-message">글 목록을 불러오는 중입니다.</p> : null}
            {!loading && !posts.length ? <p className="admin-empty-note">아직 저장된 글이 없습니다.</p> : null}
            <div className="admin-list">
              {posts.map((post) => (
                <button className={`admin-list-card ${current.id === post.id ? 'admin-list-card--active' : ''}`} type="button" key={post.id} onClick={() => selectPost(post)} aria-pressed={current.id === post.id}>
                  <span className={`status-chip status-chip--${post.status}`}>{POST_STATUS_LABELS[post.status]}</span>
                  <strong>{post.title || '(제목 없음)'}</strong>
                  <small>{formatDate(post.updatedAt || post.createdAt) || '날짜 없음'}</small>
                </button>
              ))}
            </div>
          </aside>

          <form className="panel admin-editor" onSubmit={save} ref={editorRef}>
            <div className="admin-editor__bar">
              <h3>{current.id ? '글 수정' : '새 글 작성'}</h3>
              <button className="button button--primary" type="submit" disabled={saving}>{saving ? '저장 중' : '저장'}</button>
            </div>

            <div className="admin-form-grid">
              <div className="field admin-field--wide">
                <label htmlFor="post-title">제목</label>
                <input id="post-title" name="title" value={current.title || ''} onChange={(event) => updateCurrent('title', event.target.value)} required />
              </div>
              <fieldset className="field admin-post-status">
                <legend>상태</legend>
                <div className="admin-post-status__options">
                  {([
                    ['published', '공개'],
                    ['draft', '임시저장'],
                    ['hidden', '숨김']
                  ] as Array<[Post['status'], string]>).map(([value, label]) => (
                    <label key={value}>
                      <input type="radio" name="status" value={value} checked={(current.status || 'published') === value} onChange={() => updateCurrent('status', value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
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
              <span className="help-text">작성 중인 내용은 이 브라우저에 임시 보관됩니다.</span>
            </div>
          </form>
        </div>
      ) : (
        <section id="admin-preview-panel" className="admin-live-preview" role="tabpanel" aria-labelledby="admin-preview-tab">
          <article className="post-entry post-entry--active">
            <div className="post-entry__summary">
              <h2>{previewTitle}</h2>
              {previewExcerpt ? <p>{previewExcerpt}</p> : null}
              {previewTags.length ? <TagList tags={previewTags} /> : null}
              <p className="meta">공개 페이지와 같은 너비로 표시됩니다.</p>
            </div>
            <div className="post-entry__body">
              {current.body ? <MarkdownView markdown={current.body} /> : <p className="help-text">본문을 입력하면 미리보기가 표시됩니다.</p>}
            </div>
          </article>
        </section>
      )}
      {message ? <p className="status-message" role="status">{message}</p> : null}
    </section>
  );
}

function AssetsAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [assets, setAssets] = useState<ArchiveAsset[]>([]);
  const [overrides, setOverrides] = useState<AssetOverride[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadArchiveManifest(), adminListAssetOverrides(token)])
      .then(([manifest, nextOverrides]) => { setAssets(manifest.assets); setOverrides(nextOverrides); })
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(err instanceof Error ? err.message : '자료 정보를 불러오지 못했습니다.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const selected = useMemo(() => assets.find((asset) => asset.id === selectedId) || assets[0], [assets, selectedId]);
  const selectedOverride = overrides.find((override) => override.assetId === selected?.id);
  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
    if (!normalizedQuery) return assets;
    return assets.filter((asset) => [asset.title, asset.path, ...(asset.tags || [])].join(' ').toLocaleLowerCase('ko-KR').includes(normalizedQuery));
  }, [assets, query]);

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

  if (loading) return <EmptyState label="자료 정보를 불러오는 중입니다." />;
  if (!assets.length) return <EmptyState label={message || '등록된 자료가 없습니다.'} />;

  return (
    <section className="two-column admin-asset-layout">
      <div className="panel admin-asset-list-panel">
        <p className="status-message">이미지 파일은 저장소에서 관리합니다. 여기서는 표시 정보만 수정합니다.</p>
        <label className="sr-only" htmlFor="admin-asset-search">자료 검색</label>
        <input id="admin-asset-search" className="admin-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="자료 검색" />
        <div className="admin-asset-list" aria-label="자료 목록">
          {filteredAssets.map((asset) => (
            <button className={`admin-asset-row ${selected?.id === asset.id ? 'admin-asset-row--active' : ''}`} type="button" key={asset.id} onClick={() => setSelectedId(asset.id)} aria-pressed={selected?.id === asset.id}>
              <strong>{asset.title}</strong>
              <span className="meta">{asset.path}</span>
              <TagList tags={asset.tags} />
            </button>
          ))}
          {!filteredAssets.length ? <p className="admin-empty-note">검색 결과가 없습니다.</p> : null}
        </div>
      </div>
      {selected ? (
        <form className="panel admin-asset-editor" key={selected.id} onSubmit={save}>
          <h2>자료 표시 정보</h2>
          {selected.kind === 'file' ? (
            <a className="asset-file-tile" href={selected.fileUrl || selected.sourceUrl || selected.imageUrl} target="_blank" rel="noreferrer">
              {selected.fileName}
            </a>
          ) : (
            <img className="admin-asset-preview" src={selected.imageUrl} alt={selected.title} />
          )}
          <div className="field"><label>표시명<input name="displayName" defaultValue={selectedOverride?.displayName || selected.title} /></label></div>
          <div className="field"><label>설명<textarea name="description" defaultValue={selectedOverride?.description || selected.description || ''} /></label></div>
          <div className="field"><label>태그<input name="tags" defaultValue={(selectedOverride?.tags || selected.tags).join(', ')} /></label></div>
          <div className="field"><label>출처 URL<input name="sourceUrl" defaultValue={selectedOverride?.sourceUrl || selected.sourceUrl || ''} /></label></div>
          <div className="field"><label>상태<select name="status" defaultValue={selectedOverride?.status || selected.status}><option value="visible">공개</option><option value="hidden">숨김</option><option value="deleted">삭제됨</option></select></label></div>
          <div className="field"><label>정렬값<input name="sortOrder" type="number" defaultValue={selectedOverride?.sortOrder ?? selected.sortOrder ?? 9999} /></label></div>
          {message ? <p className="status-message">{message}</p> : null}
          <button className="button button--primary" type="submit">저장</button>
        </form>
      ) : null}
    </section>
  );
}

function GuestbookAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [filter, setFilter] = useState<GuestbookFilter>('all');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [limitedMode, setLimitedMode] = useState(false);
  const [hideTarget, setHideTarget] = useState<GuestbookEntry | null>(null);
  const [hiddenReason, setHiddenReason] = useState('');
  const [changingId, setChangingId] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setMessage('');
      setLimitedMode(false);
      try {
        const items = await adminListGuestbook(token);
        if (active) setEntries([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch (err) {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        const errorMessage = err instanceof Error ? err.message : String(err || '');
        if (errorMessage.includes('Unknown action: admin.guestbook.list')) {
          try {
            const publicItems = await listGuestbook();
            if (active) {
              setEntries([...publicItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
              setLimitedMode(true);
            }
          } catch (fallbackError) {
            if (active) setMessage(fallbackError instanceof Error ? fallbackError.message : '방명록을 불러오지 못했습니다.');
          }
        } else if (active) {
          setMessage(errorMessage || '방명록을 불러오지 못했습니다.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!hideTarget) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !changingId) setHideTarget(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [hideTarget, changingId]);

  const filteredEntries = useMemo(() => filter === 'all' ? entries : entries.filter((entry) => entry.status === filter), [entries, filter]);
  const { visibleItems, shownCount, totalCount, hasMore, loadMore } = useIncrementalItems(filteredEntries, GUESTBOOK_BATCH_SIZE);

  const statusCount = (status: GuestbookEntry['status']) => entries.filter((entry) => entry.status === status).length;

  const hide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hideTarget || !hiddenReason.trim()) return;
    setChangingId(hideTarget.id);
    try {
      await adminHideGuestbook(token, hideTarget.id, hiddenReason.trim());
      setEntries((items) => items.map((item) => item.id === hideTarget.id ? { ...item, status: 'hidden', hiddenReason: hiddenReason.trim() } : item));
      setMessage('방명록 글을 숨겼습니다.');
      setHideTarget(null);
      setHiddenReason('');
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(err instanceof Error ? err.message : '숨김 처리에 실패했습니다.');
    } finally {
      setChangingId('');
    }
  };

  const restore = async (entry: GuestbookEntry) => {
    setChangingId(entry.id);
    setMessage('');
    try {
      await adminRestoreGuestbook(token, entry.id);
      setEntries((items) => items.map((item) => item.id === entry.id ? { ...item, status: 'visible', hiddenReason: '' } : item));
      setMessage('방명록 글을 다시 공개했습니다.');
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(err instanceof Error ? err.message : '복구에 실패했습니다.');
    } finally {
      setChangingId('');
    }
  };

  return (
    <section className="admin-guestbook">
      <header className="panel admin-guestbook-toolbar">
        <div>
          <h2>방명록 관리</h2>
          <p className="help-text">이름, 작성일, 공개 상태를 확인하고 숨김 여부를 관리합니다.</p>
        </div>
        <div className="admin-status-filters" aria-label="방명록 상태 필터">
          {([
            ['all', '전체', entries.length],
            ['visible', '공개', statusCount('visible')],
            ['hidden', '숨김', statusCount('hidden')],
            ['deleted', '삭제됨', statusCount('deleted')]
          ] as Array<[GuestbookFilter, string, number]>).map(([value, label, count]) => (
            <button className={filter === value ? 'admin-status-filter--active' : ''} type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}>
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
      </header>

      {limitedMode ? <p className="status-message">전체 관리 목록 연결 전이라 현재는 공개 글만 표시합니다.</p> : null}
      {message ? <p className="status-message" role="status">{message}</p> : null}
      {loading ? <EmptyState label="방명록을 불러오는 중입니다." /> : null}
      {!loading && !filteredEntries.length ? <EmptyState label="해당 상태의 방명록 글이 없습니다." /> : null}

      {!loading && visibleItems.length ? (
        <div className="admin-guestbook-list">
          <p className="result-count">{totalCount}개 중 {shownCount}개 표시</p>
          {visibleItems.map((entry) => (
            <article className="admin-guestbook-row" key={entry.id}>
              <div className="admin-guestbook-row__head">
                <strong>{entry.name}</strong>
                <span className={`status-chip status-chip--${entry.status}`}>{GUESTBOOK_STATUS_LABELS[entry.status]}</span>
              </div>
              <p className="admin-guestbook-row__message">{entry.message}</p>
              {entry.hiddenReason ? <p className="admin-guestbook-row__reason">숨김 사유: {entry.hiddenReason}</p> : null}
              <div className="admin-guestbook-row__footer">
                <time className="meta" dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                {entry.status === 'visible' ? (
                  <button className="admin-row-action admin-row-action--danger" type="button" onClick={() => { setHideTarget(entry); setHiddenReason(''); }} disabled={Boolean(changingId)}>
                    <EyeOffIcon /> 숨기기
                  </button>
                ) : null}
                {entry.status === 'hidden' ? (
                  <button className="admin-row-action" type="button" onClick={() => restore(entry)} disabled={Boolean(changingId)}>
                    <RestoreIcon /> {changingId === entry.id ? '복구 중' : '다시 보이기'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          <IncrementalLoadMore hasMore={hasMore} label={`${totalCount - shownCount}개 더보기`} onLoadMore={loadMore} />
        </div>
      ) : null}

      {hideTarget ? (
        <div className="modal-backdrop admin-dialog-backdrop" role="presentation" onMouseDown={() => { if (!changingId) setHideTarget(null); }}>
          <section className="modal admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-hide-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-dialog__head">
              <h2 id="admin-hide-title">방명록 글 숨기기</h2>
              <button className="admin-dialog__close" type="button" onClick={() => setHideTarget(null)} aria-label="닫기" disabled={Boolean(changingId)}><CloseIcon /></button>
            </div>
            <p><strong>{hideTarget.name}</strong>님의 글을 공개 목록에서 숨깁니다.</p>
            <form onSubmit={hide}>
              <div className="field">
                <label htmlFor="guestbook-hidden-reason">숨김 사유</label>
                <input id="guestbook-hidden-reason" value={hiddenReason} onChange={(event) => setHiddenReason(event.target.value)} autoFocus required />
              </div>
              <div className="admin-dialog__actions">
                <button className="button" type="button" onClick={() => setHideTarget(null)} disabled={Boolean(changingId)}>취소</button>
                <button className="button button--danger" type="submit" disabled={Boolean(changingId)}>{changingId ? '처리 중' : '숨기기'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      <BackToTopButton />
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
    if (!current) {
      setSession(null);
      return;
    }

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
    const checkSession = () => {
      const current = loadAdminSession();
      setSession((existing) => {
        if (!current) return null;
        if (!existing || current.token !== existing.token || current.expiresAt !== existing.expiresAt) return current;
        return existing;
      });
    };
    const interval = window.setInterval(checkSession, 5_000);
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
        <button className="button admin-logout" type="button" onClick={logout}><LogOutIcon /> 로그아웃</button>
      </section>

      <div className="tabs admin-tabs" role="tablist" aria-label="관리자 메뉴">
        {(['posts', 'assets', 'guestbook'] as Tab[]).map((item) => (
          <button id={`admin-tab-${item}`} className={`button ${tab === item ? 'button--primary' : ''}`} type="button" role="tab" key={item} aria-selected={tab === item} aria-controls={`admin-panel-${item}`} onClick={() => setTab(item)}>{TAB_LABELS[item]}</button>
        ))}
      </div>

      <div id={`admin-panel-${tab}`} className="admin-tab-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'posts' ? <PostsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
        {tab === 'assets' ? <AssetsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
        {tab === 'guestbook' ? <GuestbookAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
      </div>
    </AppLayout>
  );
}
