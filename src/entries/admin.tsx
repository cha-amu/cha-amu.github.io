import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { loadArchiveManifest } from '../api/archiveManifestClient';
import { adminBanGuestbookIp, adminHideGuestbook, adminListAssetOverrides, adminListGuestbook, adminListGuestbookIpBans, adminListPosts, adminLogin, adminRefreshSession, adminRestoreGuestbook, adminSaveAssetOverride, adminSavePost, adminUnbanGuestbookIp, listGuestbook } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState } from '../components/PageState';
import { TagList } from '../components/TagList';
import { CloseIcon, EyeOffIcon, LogOutIcon, RestoreIcon, ShieldBanIcon, ShieldCheckIcon } from '../components/ToolIcons';
import { TurnstileBox } from '../components/TurnstileBox';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { useI18n, type Translate, type TranslationKey, type TranslationParams } from '../i18n';
import { syncPublicPost } from '../stores/publicDataStore';
import type { ArchiveAsset, AssetOverride, GuestbookAdminEntry, GuestbookEntry, GuestbookIpBan, Post } from '../types';
import { formatDate } from '../utils/date';
import { clearAdminSession, loadAdminSession, refreshAdminSession, saveAdminSession } from '../utils/session';
import { splitTags } from '../utils/strings';

type Tab = 'posts' | 'assets' | 'guestbook';
type GuestbookFilter = 'all' | GuestbookEntry['status'];
type GuestbookAdminView = 'entries' | 'bans';
type EditorView = 'edit' | 'preview';

const TAB_LABEL_KEYS: Record<Tab, TranslationKey> = {
  posts: 'admin.tab.posts',
  assets: 'admin.tab.assets',
  guestbook: 'admin.tab.guestbook'
};

const POST_STATUS_LABEL_KEYS: Record<Post['status'], TranslationKey> = {
  published: 'admin.status.published',
  draft: 'admin.status.draft',
  hidden: 'admin.status.hidden'
};

const GUESTBOOK_STATUS_LABEL_KEYS: Record<GuestbookEntry['status'], TranslationKey> = {
  visible: 'admin.status.visible',
  hidden: 'admin.status.hidden',
  deleted: 'admin.status.deleted'
};

const GUESTBOOK_BATCH_SIZE = 10;

type AdminMessage =
  | {
    key: TranslationKey;
    params?: TranslationParams;
    translatedParams?: Record<string, { key: TranslationKey; params?: TranslationParams }>;
  }
  | { text: string }
  | null;

function translatedMessage(
  key: TranslationKey,
  params?: TranslationParams,
  translatedParams?: Record<string, { key: TranslationKey; params?: TranslationParams }>
): AdminMessage {
  return { key, params, translatedParams };
}

function backendErrorMessage(error: unknown, fallbackKey: TranslationKey): AdminMessage {
  const text = error instanceof Error ? error.message : String(error || '');
  return text ? { text } : translatedMessage(fallbackKey);
}

function renderAdminMessage(message: AdminMessage, t: Translate) {
  if (!message) return '';
  if ('text' in message) return message.text;
  const translatedParams = Object.fromEntries(
    Object.entries(message.translatedParams || {}).map(([name, value]) => [name, t(value.key, value.params)])
  );
  return t(message.key, { ...message.params, ...translatedParams });
}


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

function LoginPanel({ onLogin, initialMessage = null }: { onLogin: () => void; initialMessage?: AdminMessage }) {
  const { t } = useI18n();
  const [message, setMessage] = useState(initialMessage);
  const [saving, setSaving] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') || '');
    if (!turnstileToken) {
      setMessage(translatedMessage('admin.login.humanRequired'));
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const session = await adminLogin({ password, turnstileToken });
      saveAdminSession(session);
      onLogin();
    } catch (err) {
      setMessage(backendErrorMessage(err, 'admin.login.failed'));
    } finally {
      setSaving(false);
      setTurnstileToken('');
      setTurnstileResetKey((key) => key + 1);
    }
  };

  return (
    <AppLayout>
      <section className="admin-page-head" aria-labelledby="admin-login-title">
        <div>
          <h1 id="admin-login-title" className="page-title">{t('admin.login.title')}</h1>
          <p className="lead">{t('admin.login.lead')}</p>
        </div>
      </section>
      <form className="panel admin-login-panel" onSubmit={submit}>
        <div className="field">
          <label htmlFor="admin-password">{t('admin.login.password')}</label>
          <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <TurnstileBox action="admin_login" onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} />
        {message ? <p className="status-message status-message--danger">{renderAdminMessage(message, t)}</p> : null}
        <button className="button button--primary" type="submit" disabled={saving}>{saving ? t('admin.login.checking') : t('admin.login.submit')}</button>
      </form>
    </AppLayout>
  );
}

function isAdminSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Admin session expired')
    || message.includes('Invalid admin session')
    || message.includes('Admin session is required')
    || message.includes('관리자 로그인이 필요합니다')
    || message.includes('관리자 로그인이 만료되었습니다');
}

function PostsAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { t } = useI18n();
  const restoredDraft = useMemo(() => readAdminPostDraft(), []);
  const [posts, setPosts] = useState<Post[]>([]);
  const [current, setCurrent] = useState<Partial<Post>>(() => restoredDraft?.current || blankPost());
  const [tagsText, setTagsText] = useState(restoredDraft?.tagsText || '');
  const [editorView, setEditorView] = useState<EditorView>('edit');
  const [message, setMessage] = useState<AdminMessage>(null);
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
    setMessage(null);
    moveToEditorOnMobile();
  };

  const startNewPost = () => {
    setCurrent(blankPost());
    setTagsText('');
    setEditorView('edit');
    setMessage(translatedMessage('admin.posts.newMessage'));
    moveToEditorOnMobile();
  };

  const load = () => {
    setLoading(true);
    return adminListPosts(token)
      .then((items) => setPosts(sortPostsByNewest(items)))
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(backendErrorMessage(err, 'admin.posts.loadFailed'));
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
      setMessage(translatedMessage('admin.posts.bodyRequired'));
      window.requestAnimationFrame(() => document.getElementById('post-body')?.focus());
      return;
    }

    setSaving(true);
    setMessage(translatedMessage('admin.posts.savingMessage'));
    try {
      const saved = await adminSavePost(token, post);
      setPosts((items) => sortPostsByNewest([saved, ...items.filter((item) => item.id !== saved.id)]));
      setCurrent(saved);
      setTagsText((saved.tags || []).join(', '));
      syncPublicPost(saved);
      setMessage(saved.status === 'published'
        ? translatedMessage('admin.posts.savedPublished')
        : translatedMessage('admin.posts.savedStatus', undefined, { status: { key: POST_STATUS_LABEL_KEYS[saved.status] } }));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.posts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const previewTags = splitTags(tagsText);
  const previewTitle = String(current.title || '').trim() || t('admin.posts.previewTitle');
  const previewExcerpt = String(current.excerpt || '').trim();

  return (
    <section className="admin-posts" aria-label={t('admin.posts.manage')}>
      <header className="panel admin-section-head">
        <div>
          <h2>{t('admin.posts.manage')}</h2>
          <p className="help-text">{t('admin.posts.help')}</p>
        </div>
        <div className="admin-section-head__actions">
          <div className="admin-view-switch" role="tablist" aria-label={t('admin.posts.editorTabs')}>
            <button id="admin-edit-tab" className={editorView === 'edit' ? 'admin-view-switch__active' : ''} type="button" role="tab" aria-selected={editorView === 'edit'} aria-controls="admin-edit-panel" onClick={() => setEditorView('edit')}>{t('admin.posts.edit')}</button>
            <button id="admin-preview-tab" className={editorView === 'preview' ? 'admin-view-switch__active' : ''} type="button" role="tab" aria-selected={editorView === 'preview'} aria-controls="admin-preview-panel" onClick={() => setEditorView('preview')}>{t('admin.posts.preview')}</button>
          </div>
          <button className="button button--primary" type="button" onClick={startNewPost}>{t('admin.posts.new')}</button>
        </div>
      </header>

      {editorView === 'edit' ? (
        <div id="admin-edit-panel" className="admin-post-layout" role="tabpanel" aria-labelledby="admin-edit-tab">
          <aside className="panel admin-list-panel" aria-label={t('admin.posts.list')}>
            <div className="admin-list-panel__top">
              <strong>{t('admin.posts.list')}</strong>
              <span>{loading && !posts.length ? t('admin.posts.loading') : t('common.count', { count: posts.length })}</span>
            </div>
            {loading && !posts.length ? <p className="status-message">{t('admin.posts.loadingList')}</p> : null}
            {!loading && !posts.length ? <p className="admin-empty-note">{t('admin.posts.empty')}</p> : null}
            <div className="admin-list">
              {posts.map((post) => (
                <button className={`admin-list-card ${current.id === post.id ? 'admin-list-card--active' : ''}`} type="button" key={post.id} onClick={() => selectPost(post)} aria-pressed={current.id === post.id}>
                  <span className={`status-chip status-chip--${post.status}`}>{t(POST_STATUS_LABEL_KEYS[post.status])}</span>
                  <strong>{post.title || t('common.untitled')}</strong>
                  <small>{formatDate(post.updatedAt || post.createdAt) || t('common.noDate')}</small>
                </button>
              ))}
            </div>
          </aside>

          <form className="panel admin-editor" onSubmit={save} ref={editorRef}>
            <div className="admin-editor__bar">
              <h3>{current.id ? t('admin.posts.editTitle') : t('admin.posts.new')}</h3>
              <button className="button button--primary" type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>

            <div className="admin-form-grid">
              <div className="field admin-field--wide">
                <label htmlFor="post-title">{t('admin.posts.titleField')}</label>
                <input id="post-title" name="title" value={current.title || ''} onChange={(event) => updateCurrent('title', event.target.value)} required />
              </div>
              <div className="field admin-post-status" role="radiogroup" aria-labelledby="post-status-label">
                <span id="post-status-label" className="admin-post-status__label">{t('admin.posts.statusField')}</span>
                <div className="admin-post-status__options">
                  {([
                    ['published', POST_STATUS_LABEL_KEYS.published],
                    ['draft', POST_STATUS_LABEL_KEYS.draft],
                    ['hidden', POST_STATUS_LABEL_KEYS.hidden]
                  ] as Array<[Post['status'], TranslationKey]>).map(([value, labelKey]) => (
                    <label key={value}>
                      <input type="radio" name="status" value={value} checked={(current.status || 'published') === value} onChange={() => updateCurrent('status', value)} />
                      <span>{t(labelKey)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="post-tags">{t('admin.posts.tagsField')}</label>
                <input id="post-tags" name="tags" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder={t('admin.posts.tagsPlaceholder')} />
              </div>
              <div className="field admin-field--wide">
                <label htmlFor="post-excerpt">{t('admin.posts.excerptField')}</label>
                <input id="post-excerpt" name="excerpt" value={current.excerpt || ''} onChange={(event) => updateCurrent('excerpt', event.target.value)} />
              </div>
            </div>

            <div className="field admin-writing-rail">
              <label htmlFor="post-body">{t('admin.posts.bodyField')}</label>
              <textarea className="admin-markdown-input" id="post-body" name="body" value={current.body || ''} onChange={(event) => updateCurrent('body', event.target.value)} required />
              <span className="help-text">{t('admin.posts.draftHelp')}</span>
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
              <p className="meta">{t('admin.posts.previewWidth')}</p>
            </div>
            <div className="post-entry__body">
              {current.body ? <MarkdownView markdown={current.body} /> : <p className="help-text">{t('admin.posts.previewEmpty')}</p>}
            </div>
          </article>
        </section>
      )}
      {message ? <p className="status-message" role="status">{renderAdminMessage(message, t)}</p> : null}
    </section>
  );
}

function AssetsAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { locale, t } = useI18n();
  const [assets, setAssets] = useState<ArchiveAsset[]>([]);
  const [overrides, setOverrides] = useState<AssetOverride[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<AdminMessage>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadArchiveManifest(), adminListAssetOverrides(token)])
      .then(([manifest, nextOverrides]) => { setAssets(manifest.assets); setOverrides(nextOverrides); })
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(backendErrorMessage(err, 'admin.assets.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [token]);

  const selected = useMemo(() => assets.find((asset) => asset.id === selectedId) || assets[0], [assets, selectedId]);
  const selectedOverride = overrides.find((override) => override.assetId === selected?.id);
  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (!normalizedQuery) return assets;
    return assets.filter((asset) => [asset.title, asset.path, ...(asset.tags || [])].join(' ').toLocaleLowerCase(locale).includes(normalizedQuery));
  }, [assets, locale, query]);

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
      setMessage(translatedMessage('admin.assets.saved'));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.assets.saveFailed'));
    }
  };

  if (loading && !assets.length) return <EmptyState label={t('admin.assets.loading')} />;
  if (!assets.length) return <EmptyState label={message ? renderAdminMessage(message, t) : t('admin.assets.empty')} />;

  return (
    <section className="two-column admin-asset-layout">
      <div className="panel admin-asset-list-panel">
        <p className="status-message">{t('admin.assets.note')}</p>
        <label className="sr-only" htmlFor="admin-asset-search">{t('admin.assets.search')}</label>
        <input id="admin-asset-search" className="admin-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('admin.assets.search')} />
        <div className="admin-asset-list" aria-label={t('admin.assets.list')}>
          {filteredAssets.map((asset) => (
            <button className={`admin-asset-row ${selected?.id === asset.id ? 'admin-asset-row--active' : ''}`} type="button" key={asset.id} onClick={() => setSelectedId(asset.id)} aria-pressed={selected?.id === asset.id}>
              <strong>{asset.title}</strong>
              <span className="meta">{asset.path}</span>
              <TagList tags={asset.tags} />
            </button>
          ))}
          {!filteredAssets.length ? <p className="admin-empty-note">{t('admin.assets.noResults')}</p> : null}
        </div>
      </div>
      {selected ? (
        <form className="panel admin-asset-editor" key={selected.id} onSubmit={save}>
          <h2>{t('admin.assets.displayInfo')}</h2>
          {selected.kind === 'file' ? (
            <a className="asset-file-tile" href={selected.fileUrl || selected.sourceUrl || selected.imageUrl} target="_blank" rel="noreferrer">
              {selected.fileName}
            </a>
          ) : (
            <img className="admin-asset-preview" src={selected.imageUrl} alt={selected.title} />
          )}
          <div className="field"><label>{t('admin.assets.displayName')}<input name="displayName" defaultValue={selectedOverride?.displayName || selected.title} /></label></div>
          <div className="field"><label>{t('admin.assets.description')}<textarea name="description" defaultValue={selectedOverride?.description || selected.description || ''} /></label></div>
          <div className="field"><label>{t('admin.assets.tags')}<input name="tags" defaultValue={(selectedOverride?.tags || selected.tags).join(', ')} /></label></div>
          <div className="field"><label>{t('admin.assets.sourceUrl')}<input name="sourceUrl" defaultValue={selectedOverride?.sourceUrl || selected.sourceUrl || ''} /></label></div>
          <div className="field"><label>{t('admin.assets.status')}<select name="status" defaultValue={selectedOverride?.status || selected.status}><option value="visible">{t('admin.status.visible')}</option><option value="hidden">{t('admin.status.hidden')}</option><option value="deleted">{t('admin.status.deleted')}</option></select></label></div>
          <div className="field"><label>{t('admin.assets.sortOrder')}<input name="sortOrder" type="number" defaultValue={selectedOverride?.sortOrder ?? selected.sortOrder ?? 9999} /></label></div>
          {message ? <p className="status-message">{renderAdminMessage(message, t)}</p> : null}
          <button className="button button--primary" type="submit">{t('common.save')}</button>
        </form>
      ) : null}
    </section>
  );
}

function GuestbookAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<GuestbookAdminEntry[]>([]);
  const [ipBans, setIpBans] = useState<GuestbookIpBan[]>([]);
  const [view, setView] = useState<GuestbookAdminView>('entries');
  const [filter, setFilter] = useState<GuestbookFilter>('all');
  const [message, setMessage] = useState<AdminMessage>(null);
  const [loading, setLoading] = useState(true);
  const [bansLoading, setBansLoading] = useState(true);
  const [banListError, setBanListError] = useState<AdminMessage>(null);
  const [limitedMode, setLimitedMode] = useState(false);
  const [hideTarget, setHideTarget] = useState<GuestbookEntry | null>(null);
  const [hiddenReason, setHiddenReason] = useState('');
  const [changingId, setChangingId] = useState('');

  useEffect(() => {
    let active = true;
    const loadEntries = async () => {
      setLoading(true);
      setMessage(null);
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
            if (active) setMessage(backendErrorMessage(fallbackError, 'admin.guestbook.loadFailed'));
          }
        } else if (active) {
          setMessage(errorMessage ? { text: errorMessage } : translatedMessage('admin.guestbook.loadFailed'));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    const loadBans = async () => {
      setBansLoading(true);
      setBanListError(null);
      try {
        const bans = await adminListGuestbookIpBans(token);
        if (active) setIpBans(bans);
      } catch (err) {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        if (active) setBanListError(backendErrorMessage(err, 'admin.guestbook.banListLoadFailed'));
      } finally {
        if (active) setBansLoading(false);
      }
    };
    void loadEntries();
    void loadBans();
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
      setMessage(translatedMessage('admin.guestbook.hidden'));
      setHideTarget(null);
      setHiddenReason('');
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.guestbook.hideFailed'));
    } finally {
      setChangingId('');
    }
  };

  const restore = async (entry: GuestbookEntry) => {
    setChangingId(entry.id);
    setMessage(null);
    try {
      await adminRestoreGuestbook(token, entry.id);
      setEntries((items) => items.map((item) => item.id === entry.id ? { ...item, status: 'visible', hiddenReason: '' } : item));
      setMessage(translatedMessage('admin.guestbook.restored'));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.guestbook.restoreFailed'));
    } finally {
      setChangingId('');
    }
  };

  const updateIpBlock = async (entry: GuestbookAdminEntry, blocked: boolean) => {
    if (!entry.ipBanAvailable) return;
    if (blocked && !window.confirm(t('admin.guestbook.blockConfirm'))) return;

    setChangingId(entry.id);
    setMessage(null);
    try {
      const result = blocked
        ? await adminBanGuestbookIp(token, entry.id)
        : await adminUnbanGuestbookIp(token, entry.id);
      const relatedEntryCount = result.relatedEntryCount ?? entry.relatedEntryCount;
      setEntries((items) => items.map((item) => item.id === entry.id
        ? { ...item, ipBlocked: blocked, relatedEntryCount }
        : item));
      if (!blocked) {
        setIpBans((items) => items.filter((ban) => ban.sourceEntryId !== entry.id && !ban.relatedEntryIds.includes(entry.id)));
      }
      const relatedNote = relatedEntryCount && relatedEntryCount > 1
        ? { note: { key: 'admin.guestbook.relatedNote' as const, params: { count: relatedEntryCount } } }
        : undefined;
      setMessage(translatedMessage(
        blocked ? 'admin.guestbook.blocked' : 'admin.guestbook.unblocked',
        { note: '' },
        relatedNote
      ));
      try {
        const [refreshedEntries, refreshedBans] = await Promise.all([
          adminListGuestbook(token),
          adminListGuestbookIpBans(token)
        ]);
        setEntries([...refreshedEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setIpBans(refreshedBans);
      } catch (_) {
        // The mutation already succeeded; keep the updated target row if refresh is unavailable.
      }
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, blocked ? 'admin.guestbook.blockFailed' : 'admin.guestbook.unblockFailed'));
    } finally {
      setChangingId('');
    }
  };

  const unbanFromList = async (ban: GuestbookIpBan) => {
    const entryId = ban.sourceEntryId || ban.relatedEntryIds[0];
    if (!entryId) {
      setMessage(translatedMessage('admin.guestbook.unblockSourceMissing'));
      return;
    }

    setChangingId(entryId);
    setMessage(null);
    try {
      await adminUnbanGuestbookIp(token, entryId);
      setIpBans((items) => items.filter((item) => item !== ban));
      setEntries((items) => items.map((entry) => ban.relatedEntryIds.includes(entry.id) ? { ...entry, ipBlocked: false } : entry));
      setMessage(translatedMessage('admin.guestbook.unblocked', { note: '' }));
      try {
        const [refreshedEntries, refreshedBans] = await Promise.all([
          adminListGuestbook(token),
          adminListGuestbookIpBans(token)
        ]);
        setEntries([...refreshedEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setIpBans(refreshedBans);
      } catch (_) {
        // The mutation succeeded; retain the local unblocked state if refresh is unavailable.
      }
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.guestbook.unblockFailed'));
    } finally {
      setChangingId('');
    }
  };

  const showBanList = async () => {
    setView('bans');
    setBansLoading(true);
    setBanListError(null);
    setIpBans([]);
    try {
      setIpBans(await adminListGuestbookIpBans(token));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setBanListError(backendErrorMessage(err, 'admin.guestbook.banListLoadFailed'));
    } finally {
      setBansLoading(false);
    }
  };

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  return (
    <section className="admin-guestbook">
      <header className="panel admin-guestbook-toolbar">
        <div>
          <h2>{t('admin.guestbook.manage')}</h2>
          <p className="help-text">{view === 'entries' ? t('admin.guestbook.entriesHelp') : t('admin.guestbook.bansHelp')}</p>
        </div>
        <div className="admin-view-switch admin-guestbook-view-switch" role="group" aria-label={t('admin.guestbook.screen')}>
          <button className={view === 'entries' ? 'admin-view-switch__active' : ''} type="button" aria-pressed={view === 'entries'} onClick={() => setView('entries')}>{t('admin.guestbook.entries')}</button>
          <button className={view === 'bans' ? 'admin-view-switch__active' : ''} type="button" aria-pressed={view === 'bans'} onClick={() => { void showBanList(); }}>
            {t('admin.guestbook.bans')} <span className="admin-view-switch__count">{ipBans.length}</span>
          </button>
        </div>
        {view === 'entries' ? (
          <div className="admin-status-filters" aria-label={t('admin.guestbook.filters')}>
            {([
              ['all', 'common.all', entries.length],
              ['visible', GUESTBOOK_STATUS_LABEL_KEYS.visible, statusCount('visible')],
              ['hidden', GUESTBOOK_STATUS_LABEL_KEYS.hidden, statusCount('hidden')],
              ['deleted', GUESTBOOK_STATUS_LABEL_KEYS.deleted, statusCount('deleted')]
            ] as Array<[GuestbookFilter, TranslationKey, number]>).map(([value, labelKey, count]) => (
              <button className={filter === value ? 'admin-status-filter--active' : ''} type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}>
                {t(labelKey)} <span>{count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {message ? <p className="status-message" role="status">{renderAdminMessage(message, t)}</p> : null}
      {view === 'entries' ? (
        <div className="admin-guestbook-panel">
          {limitedMode ? <p className="status-message">{t('admin.guestbook.limited')}</p> : null}
          {loading && !entries.length ? <EmptyState label={t('admin.guestbook.loading')} /> : null}
          {!loading && !filteredEntries.length ? <EmptyState label={t('admin.guestbook.emptyStatus')} /> : null}

          {visibleItems.length ? (
            <div className="admin-guestbook-list">
              <p className="result-count">{t('common.showingOf', { total: totalCount, shown: shownCount })}</p>
              {visibleItems.map((entry) => (
                <article className="admin-guestbook-row" key={entry.id}>
                  <div className="admin-guestbook-row__head">
                    <strong>{entry.name}</strong>
                    <span className={`status-chip status-chip--${entry.status}`}>{t(GUESTBOOK_STATUS_LABEL_KEYS[entry.status])}</span>
                  </div>
                  <p className="admin-guestbook-row__message">{entry.message}</p>
                  {entry.hiddenReason ? <p className="admin-guestbook-row__reason">{t('admin.guestbook.hiddenReason', { reason: entry.hiddenReason })}</p> : null}
                  <div className="admin-guestbook-row__footer">
                    <time className="meta" dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                    <div className="admin-guestbook-row__controls">
                      <span className={`admin-ip-status ${entry.ipBlocked ? 'admin-ip-status--blocked' : ''}`}>
                        {entry.ipBlocked
                          ? t('admin.guestbook.ipBlocked')
                          : entry.ipBanAvailable
                            ? entry.relatedEntryCount && entry.relatedEntryCount > 1
                              ? t('admin.guestbook.ipBlockAvailableRelated', { count: entry.relatedEntryCount })
                              : t('admin.guestbook.ipBlockAvailable')
                            : t('admin.guestbook.ipUnavailable')}
                      </span>
                      {entry.ipBanAvailable ? (
                        <button
                          className={`admin-ip-action ${entry.ipBlocked ? 'admin-ip-action--restore' : 'admin-ip-action--danger'}`}
                          type="button"
                          onClick={() => updateIpBlock(entry, !entry.ipBlocked)}
                          disabled={Boolean(changingId)}
                          aria-label={entry.ipBlocked ? t('admin.guestbook.unblockBy', { name: entry.name }) : t('admin.guestbook.blockBy', { name: entry.name })}
                          title={entry.ipBlocked ? t('admin.guestbook.unblock') : t('admin.guestbook.block')}
                        >
                          {entry.ipBlocked ? <ShieldCheckIcon /> : <ShieldBanIcon />}
                        </button>
                      ) : null}
                      {entry.status === 'visible' ? (
                        <button className="admin-row-action admin-row-action--danger" type="button" onClick={() => { setHideTarget(entry); setHiddenReason(''); }} disabled={Boolean(changingId)}>
                          <EyeOffIcon /> {t('admin.guestbook.hide')}
                        </button>
                      ) : null}
                      {entry.status === 'hidden' ? (
                        <button className="admin-row-action" type="button" onClick={() => restore(entry)} disabled={Boolean(changingId)}>
                          <RestoreIcon /> {changingId === entry.id ? t('admin.guestbook.restoring') : t('admin.guestbook.restore')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              <IncrementalLoadMore hasMore={hasMore} label={t('admin.guestbook.more', { count: totalCount - shownCount })} onLoadMore={loadMore} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="admin-guestbook-panel">
          {banListError ? <p className="status-message status-message--danger">{renderAdminMessage(banListError, t)}</p> : null}
          {bansLoading && !ipBans.length ? <EmptyState label={t('admin.bans.loading')} /> : null}
          {!bansLoading && !banListError && !ipBans.length ? <EmptyState label={t('admin.bans.empty')} /> : null}
          {ipBans.length ? (
            <div className="admin-ban-list" aria-label={t('admin.bans.list')}>
              <p className="result-count">{t('admin.bans.activeCount', { count: ipBans.length })}</p>
              {ipBans.map((ban) => {
                const relatedEntries = ban.relatedEntryIds.map((id) => entriesById.get(id)).filter((entry): entry is GuestbookAdminEntry => Boolean(entry));
                const sourceEntry = ban.sourceEntryId ? entriesById.get(ban.sourceEntryId) : undefined;
                const sourcePreviewEntry = sourceEntry || relatedEntries[0];
                const usesRelatedFallback = !sourceEntry && Boolean(sourcePreviewEntry);
                const unbanEntryId = ban.sourceEntryId || ban.relatedEntryIds[0] || '';
                return (
                  <article className="admin-ban-row" key={`${ban.sourceEntryId || 'unknown'}-${ban.bannedAt}`}>
                    <div className="admin-ban-row__head">
                      <div className="admin-ban-row__state">
                        <span className="admin-ip-status admin-ip-status--blocked">{t('admin.bans.active')}</span>
                        <time className="meta" dateTime={ban.bannedAt}>{formatDate(ban.bannedAt)}</time>
                      </div>
                      <button className="admin-row-action" type="button" onClick={() => unbanFromList(ban)} disabled={Boolean(changingId) || !unbanEntryId}>
                        <ShieldCheckIcon /> {changingId === unbanEntryId ? t('admin.bans.unblocking') : t('admin.guestbook.unblock')}
                      </button>
                    </div>
                    <div className="admin-ban-row__source">
                      <span className="admin-ban-row__label">{usesRelatedFallback ? t('admin.bans.relatedPreview') : t('admin.bans.sourcePreview')}</span>
                      {sourcePreviewEntry ? (
                        <>
                          <strong>{sourcePreviewEntry.name}</strong>
                          <p>{sourcePreviewEntry.message}</p>
                        </>
                      ) : (
                        <p className="help-text">{t('admin.bans.sourceMissing')}</p>
                      )}
                    </div>
                    <dl className="admin-ban-row__meta">
                      <div><dt>{t('admin.bans.reason')}</dt><dd>{!ban.reason || ban.reason === '관리자 수동 차단' || ban.reason === 'Manual admin block' ? t('admin.bans.defaultReason') : ban.reason}</dd></div>
                      <div><dt>{t('admin.bans.relatedEntries')}</dt><dd>{t('admin.bans.relatedCount', { count: ban.relatedEntryCount })}</dd></div>
                    </dl>
                    {relatedEntries.length ? (
                      <details className="admin-ban-related">
                        <summary>{t('admin.bans.showRelated', { count: ban.relatedEntryCount })}</summary>
                        <ul>
                          {relatedEntries.map((entry) => (
                            <li key={entry.id}>
                              <div>
                                <strong>{entry.name}</strong>
                                <span className={`status-chip status-chip--${entry.status}`}>{t(GUESTBOOK_STATUS_LABEL_KEYS[entry.status])}</span>
                              </div>
                              <p>{entry.message}</p>
                            </li>
                          ))}
                        </ul>
                        {relatedEntries.length < ban.relatedEntryCount ? <p className="help-text">{t('admin.bans.visibleRelated', { count: relatedEntries.length })}</p> : null}
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {hideTarget ? (
        <div className="modal-backdrop admin-dialog-backdrop" role="presentation" onMouseDown={() => { if (!changingId) setHideTarget(null); }}>
          <section className="modal admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-hide-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-dialog__head">
              <h2 id="admin-hide-title">{t('admin.hide.title')}</h2>
              <button className="admin-dialog__close" type="button" onClick={() => setHideTarget(null)} aria-label={t('common.close')} disabled={Boolean(changingId)}><CloseIcon /></button>
            </div>
            <p>{t('admin.hide.description', { name: hideTarget.name })}</p>
            <form onSubmit={hide}>
              <div className="field">
                <label htmlFor="guestbook-hidden-reason">{t('admin.hide.reason')}</label>
                <input id="guestbook-hidden-reason" value={hiddenReason} onChange={(event) => setHiddenReason(event.target.value)} autoFocus required />
              </div>
              <div className="admin-dialog__actions">
                <button className="button" type="button" onClick={() => setHideTarget(null)} disabled={Boolean(changingId)}>{t('common.cancel')}</button>
                <button className="button button--danger" type="submit" disabled={Boolean(changingId)}>{changingId ? t('admin.hide.processing') : t('admin.guestbook.hide')}</button>
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
  const { t } = useI18n();
  const [session, setSession] = useState(() => loadAdminSession());
  const [tab, setTab] = useState<Tab>('posts');
  const [sessionMessage, setSessionMessage] = useState<AdminMessage>(null);
  const lastServerRefreshAt = useRef(0);
  const refreshInFlight = useRef(false);

  const expireSession = () => {
    clearAdminSession();
    setSession(null);
    setSessionMessage(translatedMessage('admin.sessionExpired'));
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
        setSessionMessage(null);
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

  if (!session) return <LoginPanel initialMessage={sessionMessage} onLogin={() => { setSessionMessage(null); setSession(loadAdminSession()); }} />;

  const logout = () => { clearAdminSession(); setSession(null); setSessionMessage(null); };
  const handleSessionExpired = () => expireSession();
  return (
    <AppLayout>
      <section className="admin-page-head" aria-labelledby="admin-title">
        <div>
          <h1 id="admin-title" className="page-title">{t('admin.title')}</h1>
          <p className="lead">{t('admin.lead')}</p>
        </div>
        <button className="button admin-logout" type="button" onClick={logout}><LogOutIcon /> {t('admin.logout')}</button>
      </section>

      <div className="tabs admin-tabs" role="tablist" aria-label={t('admin.menu')}>
        {(['posts', 'assets', 'guestbook'] as Tab[]).map((item) => (
          <button id={`admin-tab-${item}`} className={`button ${tab === item ? 'button--primary' : ''}`} type="button" role="tab" key={item} aria-selected={tab === item} aria-controls={`admin-panel-${item}`} onClick={() => setTab(item)}>{t(TAB_LABEL_KEYS[item])}</button>
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
