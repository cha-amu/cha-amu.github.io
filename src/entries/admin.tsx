import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { loadArchiveManifest, mergeAssetOverrides } from '../api/archiveManifestClient';
import { adminBanGuestbookIp, adminBulkDeleteGuestbook, adminBulkDeletePosts, adminBulkUpdateAssetOverrides, adminBulkUpdateGuestbook, adminBulkUpdatePosts, adminDeleteThings, adminHideGuestbook, adminListAssetOverrides, adminListGuestbook, adminListGuestbookIpBans, adminListPosts, adminListThings, adminLogin, adminRefreshSession, adminRestoreGuestbook, adminSaveAssetOverride, adminSavePost, adminSaveThing, adminUnbanGuestbookIp, listGuestbook } from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState } from '../components/PageState';
import { TagList } from '../components/TagList';
import { CloseIcon, EyeOffIcon, LogOutIcon, RestoreIcon, ShieldBanIcon, ShieldCheckIcon, TrashIcon } from '../components/ToolIcons';
import { TurnstileBox } from '../components/TurnstileBox';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { useI18n, type Translate, type TranslationKey, type TranslationParams } from '../i18n';
import { setPublicGuestbook, setPublicThings, syncPublicArchiveOverrides, syncPublicPost, syncPublicThing } from '../stores/publicDataStore';
import type { ArchiveAsset, AssetOverride, GuestbookAdminEntry, GuestbookEntry, GuestbookIpBan, Post, Thing } from '../types';
import { formatDate } from '../utils/date';
import { postTimestamp } from '../utils/postTimestamp';
import { clearAdminSession, getAdminSessionRemainingMs, loadAdminSession, refreshAdminSession, saveAdminSession } from '../utils/session';
import { splitTags } from '../utils/strings';

type Tab = 'posts' | 'assets' | 'things' | 'guestbook';
type GuestbookFilter = 'all' | GuestbookEntry['status'];
type GuestbookAdminView = 'entries' | 'bans';
type EditorView = 'edit' | 'preview';
type EditablePostStatus = Exclude<Post['status'], 'deleted'>;

const TAB_LABEL_KEYS: Record<Tab, TranslationKey> = {
  posts: 'admin.tab.posts',
  assets: 'admin.tab.assets',
  things: 'admin.tab.things',
  guestbook: 'admin.tab.guestbook'
};

const THING_STATUS_LABEL_KEYS: Record<Thing['status'], TranslationKey> = {
  visible: 'admin.status.visible',
  hidden: 'admin.status.hidden'
};

const POST_STATUS_LABEL_KEYS: Record<Post['status'], TranslationKey> = {
  published: 'admin.status.published',
  draft: 'admin.status.draft',
  hidden: 'admin.status.hidden',
  deleted: 'admin.status.deleted'
};

const ADMIN_SESSION_REFRESH_LEAD_MS = 2 * 60_000;
const ADMIN_SESSION_REFRESH_THROTTLE_MS = 30_000;
const ADMIN_SESSION_CLOCK_INTERVAL_MS = 1_000;
const ADMIN_ACTIVITY_WRITE_INTERVAL_MS = 1_000;

function formatSessionRemaining(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const GUESTBOOK_STATUS_LABEL_KEYS: Record<GuestbookEntry['status'], TranslationKey> = {
  visible: 'admin.status.visible',
  hidden: 'admin.status.hidden',
  deleted: 'admin.status.deleted'
};

const GUESTBOOK_BATCH_SIZE = 10;
const ADMIN_MUTATION_BATCH_SIZE = 100;

function mutationBatches<T>(items: T[]) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += ADMIN_MUTATION_BATCH_SIZE) {
    batches.push(items.slice(index, index + ADMIN_MUTATION_BATCH_SIZE));
  }
  return batches;
}

type AdminSelection = ReturnType<typeof useAdminSelection>;

function useAdminSelection(scopeIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const scopeKey = scopeIds.join('\u0000');

  useEffect(() => {
    const validIds = new Set(scopeIds);
    setSelectedIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [scopeKey]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = scopeIds.length > 0 && scopeIds.every((id) => selectedSet.has(id));
  const partiallySelected = selectedIds.length > 0 && !allSelected;

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter((selectedId) => selectedId !== id));
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? [...scopeIds] : []);
  };

  return {
    selectedIds,
    selectedSet,
    allSelected,
    partiallySelected,
    toggle,
    toggleAll,
    clear: () => setSelectedIds([])
  };
}

function AdminBulkBar({
  scopeIds,
  selection,
  status,
  statusOptions,
  busy = false,
  disabled = false,
  onStatusChange,
  onApply,
  onDelete
}: {
  scopeIds: string[];
  selection: AdminSelection;
  status: string;
  statusOptions: Array<{ value: string; label: string }>;
  busy?: boolean;
  disabled?: boolean;
  onStatusChange: (status: string) => void;
  onApply: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const statusControlId = useId();

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selection.partiallySelected;
  }, [selection.partiallySelected]);

  const controlsDisabled = disabled || busy || !selection.selectedIds.length;

  return (
    <div className="admin-bulk-bar">
      <label className="admin-selection-toggle">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={selection.allSelected}
          onChange={(event) => selection.toggleAll(event.target.checked)}
          disabled={disabled || busy || !scopeIds.length}
        />
        <span>{selection.selectedIds.length
          ? t('admin.bulk.selected', { count: selection.selectedIds.length })
          : t('admin.bulk.selectAll')}</span>
      </label>
      <div className="admin-bulk-bar__actions">
        <label className="sr-only" htmlFor={statusControlId}>{t('admin.bulk.status')}</label>
        <select
          id={statusControlId}
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          disabled={controlsDisabled}
        >
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className="button admin-bulk-bar__apply" type="button" onClick={onApply} disabled={controlsDisabled}>
          {busy ? t('admin.bulk.processing') : t('admin.bulk.apply')}
        </button>
        {onDelete ? (
          <button
            className="admin-bulk-bar__delete"
            type="button"
            onClick={onDelete}
            disabled={controlsDisabled}
            aria-label={t('admin.bulk.deleteSelected')}
            title={t('admin.bulk.deleteSelected')}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
    const left = postTimestamp(a);
    const right = postTimestamp(b);
    return right.localeCompare(left);
  });
}

const blankThing = (): Partial<Thing> => ({
  title: '',
  description: '',
  url: '',
  imageUrl: '',
  status: 'visible',
  sortOrder: 0
});

function sortThings(things: Thing[]) {
  return [...things].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

function safeThingUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch (_) {
    return false;
  }
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
  const [bulkStatus, setBulkStatus] = useState<EditablePostStatus>('published');
  const [bulkSaving, setBulkSaving] = useState(false);
  const editorRef = useRef<HTMLFormElement>(null);
  const postIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const selection = useAdminSelection(postIds);

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
    if (bulkSaving) return;
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

  const applyBulkStatus = async () => {
    if (saving || !selection.selectedIds.length) return;
    const requestedIds = [...selection.selectedIds];
    const updated = new Set<string>();
    const updatedAt = new Date().toISOString();
    const reflectUpdatedPosts = () => {
      if (!updated.size) return;
      setPosts((items) => sortPostsByNewest(items.map((post) => updated.has(post.id) ? { ...post, status: bulkStatus, updatedAt } : post)));
      posts.filter((post) => updated.has(post.id)).forEach((post) => syncPublicPost({ ...post, status: bulkStatus, updatedAt }));
      setCurrent((post) => post.id && updated.has(post.id) ? { ...post, status: bulkStatus, updatedAt } : post);
    };
    setBulkSaving(true);
    setMessage(null);
    try {
      for (const ids of mutationBatches(requestedIds)) {
        const result = await adminBulkUpdatePosts(token, ids, bulkStatus);
        (result.updatedIds || []).forEach((id) => updated.add(id));
      }
      reflectUpdatedPosts();
      setMessage(translatedMessage('admin.posts.bulkUpdated', { count: updated.size }, { status: { key: POST_STATUS_LABEL_KEYS[bulkStatus] } }));
      selection.clear();
    } catch (err) {
      reflectUpdatedPosts();
      void load();
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.posts.bulkUpdateFailed'));
    } finally {
      setBulkSaving(false);
    }
  };

  const deletePosts = async (ids: string[]) => {
    if (!ids.length || !window.confirm(t('admin.posts.deleteConfirm', { count: ids.length }))) return;
    const deleted = new Set<string>();
    const reflectDeletedPosts = () => {
      if (!deleted.size) return;
      posts.filter((post) => deleted.has(post.id)).forEach((post) => syncPublicPost({ ...post, status: 'deleted', updatedAt: new Date().toISOString() }));
      setPosts((items) => items.filter((post) => !deleted.has(post.id)));
      if (current.id && deleted.has(current.id)) {
        setCurrent(blankPost());
        setTagsText('');
        setEditorView('edit');
      }
    };
    setBulkSaving(true);
    setMessage(null);
    try {
      for (const batch of mutationBatches(ids)) {
        const result = await adminBulkDeletePosts(token, batch);
        [...(result.deletedIds || []), ...(result.alreadyMissingIds || [])].forEach((id) => deleted.add(id));
      }
      reflectDeletedPosts();
      setMessage(translatedMessage('admin.posts.deleted', { count: deleted.size }));
      selection.clear();
    } catch (err) {
      reflectDeletedPosts();
      void load();
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.posts.deleteFailed'));
    } finally {
      setBulkSaving(false);
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
            <AdminBulkBar
              scopeIds={postIds}
              selection={selection}
              status={bulkStatus}
              statusOptions={([
                ['published', POST_STATUS_LABEL_KEYS.published],
                ['draft', POST_STATUS_LABEL_KEYS.draft],
                ['hidden', POST_STATUS_LABEL_KEYS.hidden]
              ] as Array<[EditablePostStatus, TranslationKey]>).map(([value, key]) => ({ value, label: t(key) }))}
              busy={bulkSaving}
              disabled={saving}
              onStatusChange={(status) => setBulkStatus(status as EditablePostStatus)}
              onApply={() => { void applyBulkStatus(); }}
              onDelete={() => { void deletePosts(selection.selectedIds); }}
            />
            {loading && !posts.length ? <p className="status-message">{t('admin.posts.loadingList')}</p> : null}
            {!loading && !posts.length ? <p className="admin-empty-note">{t('admin.posts.empty')}</p> : null}
            <div className="admin-list">
              {posts.map((post) => (
                <div className={`admin-list-card ${current.id === post.id ? 'admin-list-card--active' : ''}`} key={post.id}>
                  <label className="admin-row-selection">
                    <input
                      type="checkbox"
                      checked={selection.selectedSet.has(post.id)}
                      onChange={(event) => selection.toggle(post.id, event.target.checked)}
                      disabled={saving || bulkSaving}
                      aria-label={t('admin.bulk.selectItem', { name: post.title || t('common.untitled') })}
                    />
                  </label>
                  <button className="admin-list-card__content" type="button" onClick={() => selectPost(post)} disabled={saving || bulkSaving} aria-pressed={current.id === post.id}>
                    <span className={`status-chip status-chip--${post.status}`}>{t(POST_STATUS_LABEL_KEYS[post.status])}</span>
                    <strong>{post.title || t('common.untitled')}</strong>
                    <small>{formatDate(post.updatedAt || post.createdAt) || t('common.noDate')}</small>
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <form className="panel admin-editor" onSubmit={save} ref={editorRef}>
            <div className="admin-editor__bar">
              <h3>{current.id ? t('admin.posts.editTitle') : t('admin.posts.new')}</h3>
              <div className="admin-editor__actions">
                {current.id ? (
                  <button className="admin-editor__delete" type="button" onClick={() => { void deletePosts([current.id as string]); }} disabled={saving || bulkSaving} aria-label={t('admin.posts.deleteOne')} title={t('admin.posts.deleteOne')}>
                    <TrashIcon />
                  </button>
                ) : null}
                <button className="button button--primary" type="submit" disabled={saving || bulkSaving}>{saving ? t('common.saving') : t('common.save')}</button>
              </div>
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
                  ] as Array<[EditablePostStatus, TranslationKey]>).map(([value, labelKey]) => (
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
              {current.body ? (
                <MarkdownView
                  markdown={current.body}
                  baseUrl={current.markdownBaseUrl}
                  rootUrl={current.markdownRootUrl}
                />
              ) : <p className="help-text">{t('admin.posts.previewEmpty')}</p>}
            </div>
          </article>
        </section>
      )}
      {message ? <p className="status-message" role="status">{renderAdminMessage(message, t)}</p> : null}
    </section>
  );
}

function ThingsAdmin({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { locale, t } = useI18n();
  const [things, setThings] = useState<Thing[]>([]);
  const [current, setCurrent] = useState<Partial<Thing>>(() => blankThing());
  const [storageImages, setStorageImages] = useState<ArchiveAsset[]>([]);
  const [storageImagesLoading, setStorageImagesLoading] = useState(true);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [message, setMessage] = useState<AdminMessage>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editorRef = useRef<HTMLFormElement>(null);
  const storageImageChoices = useMemo(() => {
    const seen = new Set<string>();
    const choices: Array<ArchiveAsset & { imageUrl: string }> = [];
    for (const asset of storageImages) {
      const imageUrl = asset.imageUrl?.trim();
      if (asset.kind !== 'image' || asset.status !== 'visible' || !imageUrl || !safeThingUrl(imageUrl) || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      choices.push({ ...asset, imageUrl });
    }
    return choices.sort((left, right) => left.title.localeCompare(right.title, locale, { numeric: true, sensitivity: 'base' }));
  }, [locale, storageImages]);
  const imagePreviewUrl = String(current.imageUrl || '').trim();
  const canPreviewImage = Boolean(imagePreviewUrl) && safeThingUrl(imagePreviewUrl);

  useEffect(() => {
    setImagePreviewFailed(false);
  }, [imagePreviewUrl]);

  const moveToEditorOnMobile = () => {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const load = () => {
    setLoading(true);
    return adminListThings(token)
      .then((items) => setThings(sortThings(items)))
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(backendErrorMessage(err, 'admin.things.loadFailed'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { void load(); }, [token]);

  useEffect(() => {
    let active = true;
    setStorageImages([]);
    setStorageImagesLoading(true);
    void Promise.allSettled([loadArchiveManifest(), adminListAssetOverrides(token)])
      .then(([manifestResult, overridesResult]) => {
        if (!active || manifestResult.status !== 'fulfilled' || overridesResult.status !== 'fulfilled') return;
        setStorageImages(mergeAssetOverrides(manifestResult.value.assets, overridesResult.value));
      })
      .finally(() => { if (active) setStorageImagesLoading(false); });
    return () => { active = false; };
  }, [token]);

  const selectThing = (thing: Thing) => {
    setCurrent(thing);
    setMessage(null);
    moveToEditorOnMobile();
  };

  const startNewThing = () => {
    setCurrent(blankThing());
    setMessage(null);
    moveToEditorOnMobile();
  };

  const updateCurrent = <K extends keyof Thing>(key: K, value: Thing[K]) => {
    setCurrent((thing) => ({ ...thing, [key]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || deleting) return;
    const title = String(current.title || '').trim();
    const url = String(current.url || '').trim();
    const imageUrl = String(current.imageUrl || '').trim();
    const sortOrder = Number(current.sortOrder ?? 0);
    if (!title) {
      setMessage(translatedMessage('admin.things.titleRequired'));
      window.requestAnimationFrame(() => document.getElementById('thing-title')?.focus());
      return;
    }
    if (!safeThingUrl(url)) {
      setMessage(translatedMessage('admin.things.urlInvalid'));
      window.requestAnimationFrame(() => document.getElementById('thing-url')?.focus());
      return;
    }
    if (imageUrl && !safeThingUrl(imageUrl)) {
      setMessage(translatedMessage('admin.things.imageInvalid'));
      window.requestAnimationFrame(() => document.getElementById('thing-image-url')?.focus());
      return;
    }
    if (!Number.isSafeInteger(sortOrder) || Math.abs(sortOrder) > 1_000_000_000) {
      setMessage(translatedMessage('admin.things.sortOrderInvalid'));
      window.requestAnimationFrame(() => document.getElementById('thing-sort-order')?.focus());
      return;
    }

    const thing: Partial<Thing> = {
      ...(current.id ? { id: current.id } : {}),
      title,
      description: String(current.description || ''),
      url,
      imageUrl,
      status: current.status === 'hidden' ? 'hidden' : 'visible',
      sortOrder
    };
    setSaving(true);
    setMessage(null);
    try {
      const saved = await adminSaveThing(token, thing);
      setThings((items) => sortThings([saved, ...items.filter((item) => item.id !== saved.id)]));
      setCurrent(saved);
      syncPublicThing(saved);
      setMessage(translatedMessage('admin.things.saved'));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.things.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const deleteThing = async () => {
    const id = current.id;
    if (!id || saving || deleting || !window.confirm(t('admin.things.deleteConfirm', { title: current.title || t('common.untitled') }))) return;
    setDeleting(true);
    setMessage(null);
    try {
      const result = await adminDeleteThings(token, [id]);
      const deleted = new Set([...(result.deletedIds || []), ...(result.alreadyMissingIds || [])]);
      if (!deleted.has(id)) throw new Error(t('admin.things.deleteFailed'));
      setThings((items) => items.filter((thing) => !deleted.has(thing.id)));
      setPublicThings((items) => items.filter((thing) => !deleted.has(thing.id)));
      setCurrent(blankThing());
      setMessage(translatedMessage('admin.things.deleted'));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.things.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="admin-posts" aria-label={t('admin.things.manage')}>
      <header className="panel admin-section-head">
        <div>
          <h2>{t('admin.things.manage')}</h2>
          <p className="help-text">{t('admin.things.help')}</p>
        </div>
        <div className="admin-section-head__actions">
          <button className="button button--primary" type="button" onClick={startNewThing} disabled={saving || deleting}>{t('admin.things.new')}</button>
        </div>
      </header>

      <div className="admin-post-layout">
        <aside className="panel admin-list-panel admin-things-list-panel" aria-label={t('admin.things.list')}>
          <div className="admin-list-panel__top">
            <strong>{t('admin.things.list')}</strong>
            <span>{loading && !things.length ? t('admin.things.loading') : t('common.count', { count: things.length })}</span>
          </div>
          {loading && !things.length ? <p className="status-message">{t('admin.things.loadingList')}</p> : null}
          {!loading && !things.length ? <p className="admin-empty-note">{t('admin.things.empty')}</p> : null}
          <div className="admin-list">
            {things.map((thing) => (
              <div className={`admin-list-card admin-thing-list-card ${current.id === thing.id ? 'admin-list-card--active' : ''}`} key={thing.id}>
                <button className="admin-list-card__content admin-thing-list-card__content" type="button" onClick={() => selectThing(thing)} disabled={saving || deleting} aria-pressed={current.id === thing.id}>
                  <span className={`status-chip status-chip--${thing.status}`}>{t(THING_STATUS_LABEL_KEYS[thing.status])}</span>
                  <strong>{thing.title}</strong>
                  <small>{thing.url}</small>
                </button>
              </div>
            ))}
          </div>
        </aside>

        <form className="panel admin-editor" onSubmit={save} ref={editorRef} aria-busy={saving || deleting}>
          <div className="admin-editor__bar">
            <h3>{current.id ? t('admin.things.edit') : t('admin.things.new')}</h3>
            <div className="admin-editor__actions">
              {current.id ? (
                <button className="admin-editor__delete" type="button" onClick={() => { void deleteThing(); }} disabled={saving || deleting} aria-label={t('admin.things.deleteOne')} title={t('admin.things.deleteOne')}>
                  <TrashIcon />
                </button>
              ) : null}
              <button className="button button--primary" type="submit" disabled={saving || deleting}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>

          <div className="admin-form-grid">
            <div className="field admin-field--wide">
              <label htmlFor="thing-title">{t('admin.things.titleField')}</label>
              <input id="thing-title" value={current.title || ''} maxLength={160} onChange={(event) => updateCurrent('title', event.target.value)} required />
            </div>
            <div className="field admin-field--wide">
              <label htmlFor="thing-url">{t('admin.things.urlField')}</label>
              <input id="thing-url" type="url" value={current.url || ''} maxLength={2048} onChange={(event) => updateCurrent('url', event.target.value)} placeholder="https://" required />
              <span className="help-text">{t('admin.things.urlHelp')}</span>
            </div>
            <div className="field admin-field--wide">
              <label htmlFor="thing-image-url">{t('admin.things.imageField')}</label>
              <input
                id="thing-image-url"
                type="url"
                list="thing-storage-images"
                value={current.imageUrl || ''}
                maxLength={2048}
                onChange={(event) => updateCurrent('imageUrl', event.target.value)}
                placeholder="https://"
                aria-describedby="thing-image-help thing-image-options-status"
              />
              <datalist id="thing-storage-images">
                {storageImageChoices.map((asset) => (
                  <option key={asset.id} value={asset.imageUrl} label={`${asset.title} — ${asset.path}`} />
                ))}
              </datalist>
              <span className="help-text" id="thing-image-help">{t('admin.things.imageHelp')}</span>
              <span className="help-text" id="thing-image-options-status" aria-live="polite">
                {storageImagesLoading
                  ? t('admin.things.imageOptionsLoading')
                  : storageImageChoices.length
                    ? t('admin.things.imageOptionsCount', { count: storageImageChoices.length })
                    : t('admin.things.imageOptionsEmpty')}
              </span>
              {canPreviewImage ? (
                imagePreviewFailed ? (
                  <p className="help-text admin-thing-image-preview-error" role="status">{t('admin.things.imagePreviewFailed')}</p>
                ) : (
                  <img
                    className="admin-asset-preview admin-thing-image-preview"
                    src={imagePreviewUrl}
                    alt={t('admin.things.imagePreviewAlt')}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setImagePreviewFailed(true)}
                  />
                )
              ) : null}
            </div>
            <div className="field admin-field--wide">
              <label htmlFor="thing-description">{t('admin.things.descriptionField')}</label>
              <textarea id="thing-description" value={current.description || ''} maxLength={2000} onChange={(event) => updateCurrent('description', event.target.value)} />
            </div>
            <div className="field admin-post-status" role="radiogroup" aria-labelledby="thing-status-label">
              <span id="thing-status-label" className="admin-post-status__label">{t('admin.things.statusField')}</span>
              <div className="admin-post-status__options admin-thing-status__options">
                {(['visible', 'hidden'] as Thing['status'][]).map((status) => (
                  <label key={status}>
                    <input type="radio" name="thing-status" value={status} checked={(current.status || 'visible') === status} onChange={() => updateCurrent('status', status)} />
                    <span>{t(THING_STATUS_LABEL_KEYS[status])}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="thing-sort-order">{t('admin.things.sortOrderField')}</label>
              <input id="thing-sort-order" type="number" step="1" value={current.sortOrder ?? 0} onChange={(event) => updateCurrent('sortOrder', Number(event.target.value))} required />
            </div>
          </div>
        </form>
      </div>
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
  const [saving, setSaving] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<NonNullable<AssetOverride['status']>>('visible');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [assetFormStatus, setAssetFormStatus] = useState<NonNullable<AssetOverride['status']>>('visible');

  useEffect(() => {
    setLoading(true);
    Promise.all([loadArchiveManifest(), adminListAssetOverrides(token)])
      .then(([manifest, nextOverrides]) => {
        setAssets(manifest.assets);
        setOverrides(nextOverrides);
        syncPublicArchiveOverrides(manifest.assets, nextOverrides);
      })
      .catch((err) => {
        if (isAdminSessionError(err)) { onSessionExpired(); return; }
        setMessage(backendErrorMessage(err, 'admin.assets.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [token]);

  const selected = useMemo(() => assets.find((asset) => asset.id === selectedId) || assets[0], [assets, selectedId]);
  const selectedOverride = overrides.find((override) => override.assetId === selected?.id);
  useEffect(() => {
    setAssetFormStatus(selectedOverride?.status || selected?.status || 'visible');
  }, [selected?.id, selected?.status, selectedOverride?.status]);
  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (!normalizedQuery) return assets;
    return assets.filter((asset) => [asset.title, asset.path, ...(asset.tags || [])].join(' ').toLocaleLowerCase(locale).includes(normalizedQuery));
  }, [assets, locale, query]);
  const filteredAssetIds = useMemo(() => filteredAssets.map((asset) => asset.id), [filteredAssets]);
  const selection = useAdminSelection(filteredAssetIds);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || saving || bulkSaving) return;
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
    setSaving(true);
    setMessage(null);
    try {
      const saved = await adminSaveAssetOverride(token, override);
      const nextOverrides = [saved, ...overrides.filter((item) => item.assetId !== saved.assetId)];
      setOverrides(nextOverrides);
      syncPublicArchiveOverrides(assets, nextOverrides);
      setMessage(translatedMessage('admin.assets.saved'));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.assets.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const applyBulkStatus = async () => {
    if (saving || !selection.selectedIds.length) return;
    const selectedIds = [...selection.selectedIds];
    const updated = new Set<string>();
    const updatedAt = new Date().toISOString();
    const reflectUpdatedOverrides = () => {
      if (!updated.size) return;
      const next = new Map(overrides.map((override) => [override.assetId, override]));
      updated.forEach((assetId) => next.set(assetId, { ...(next.get(assetId) || { assetId }), status: bulkStatus, updatedAt }));
      const nextOverrides = Array.from(next.values());
      setOverrides(nextOverrides);
      syncPublicArchiveOverrides(assets, nextOverrides);
    };
    setBulkSaving(true);
    setMessage(null);
    try {
      for (const ids of mutationBatches(selectedIds)) {
        const result = await adminBulkUpdateAssetOverrides(token, ids, bulkStatus);
        (result.updatedIds || []).forEach((id) => updated.add(id));
      }
      reflectUpdatedOverrides();
      setMessage(translatedMessage('admin.assets.bulkUpdated', { count: updated.size }, { status: { key: GUESTBOOK_STATUS_LABEL_KEYS[bulkStatus] } }));
      selection.clear();
    } catch (err) {
      reflectUpdatedOverrides();
      void adminListAssetOverrides(token).then((nextOverrides) => {
        setOverrides(nextOverrides);
        syncPublicArchiveOverrides(assets, nextOverrides);
      }).catch(() => undefined);
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.assets.bulkUpdateFailed'));
    } finally {
      setBulkSaving(false);
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
        <AdminBulkBar
          scopeIds={filteredAssetIds}
          selection={selection}
          status={bulkStatus}
          statusOptions={([
            ['visible', GUESTBOOK_STATUS_LABEL_KEYS.visible],
            ['hidden', GUESTBOOK_STATUS_LABEL_KEYS.hidden],
            ['deleted', GUESTBOOK_STATUS_LABEL_KEYS.deleted]
          ] as Array<[NonNullable<AssetOverride['status']>, TranslationKey]>).map(([value, key]) => ({ value, label: t(key) }))}
          busy={bulkSaving}
          disabled={saving}
          onStatusChange={(status) => setBulkStatus(status as NonNullable<AssetOverride['status']>)}
          onApply={() => { void applyBulkStatus(); }}
        />
        <div className="admin-asset-list" aria-label={t('admin.assets.list')}>
          {filteredAssets.map((asset) => {
            const status = overrides.find((override) => override.assetId === asset.id)?.status || asset.status;
            return (
              <div className={`admin-asset-row ${selected?.id === asset.id ? 'admin-asset-row--active' : ''}`} key={asset.id}>
                <label className="admin-row-selection">
                  <input
                    type="checkbox"
                    checked={selection.selectedSet.has(asset.id)}
                    onChange={(event) => selection.toggle(asset.id, event.target.checked)}
                    disabled={saving || bulkSaving}
                    aria-label={t('admin.bulk.selectItem', { name: asset.title })}
                  />
                </label>
                <button className="admin-asset-row__content" type="button" onClick={() => setSelectedId(asset.id)} disabled={saving || bulkSaving} aria-pressed={selected?.id === asset.id}>
                  <span className={`status-chip status-chip--${status}`}>{t(GUESTBOOK_STATUS_LABEL_KEYS[status])}</span>
                  <strong>{asset.title}</strong>
                  <span className="meta">{asset.path}</span>
                  <TagList tags={asset.tags} />
                </button>
              </div>
            );
          })}
          {!filteredAssets.length ? <p className="admin-empty-note">{t('admin.assets.noResults')}</p> : null}
        </div>
      </div>
      {selected ? (
        <form className="panel admin-asset-editor" key={selected.id} onSubmit={save} aria-busy={saving || bulkSaving}>
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
          <div className="field"><label>{t('admin.assets.status')}<select name="status" value={assetFormStatus} onChange={(event) => setAssetFormStatus(event.target.value as NonNullable<AssetOverride['status']>)}><option value="visible">{t('admin.status.visible')}</option><option value="hidden">{t('admin.status.hidden')}</option><option value="deleted">{t('admin.status.deleted')}</option></select></label></div>
          <div className="field"><label>{t('admin.assets.sortOrder')}<input name="sortOrder" type="number" defaultValue={selectedOverride?.sortOrder ?? selected.sortOrder ?? 9999} /></label></div>
          {message ? <p className="status-message" role="status">{renderAdminMessage(message, t)}</p> : null}
          <button className="button button--primary" type="submit" disabled={saving || bulkSaving}>{saving ? t('common.saving') : t('common.save')}</button>
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
  const [bulkHideIds, setBulkHideIds] = useState<string[]>([]);
  const [hiddenReason, setHiddenReason] = useState('');
  const [changingId, setChangingId] = useState('');
  const [bulkStatus, setBulkStatus] = useState<'visible' | 'hidden'>('visible');
  const hideDialogRef = useRef<HTMLElement>(null);
  const changingIdRef = useRef(changingId);
  const hideDialogOpen = Boolean(hideTarget || bulkHideIds.length);
  changingIdRef.current = changingId;

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
    if (!hideDialogOpen) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !changingIdRef.current) {
        setHideTarget(null);
        setBulkHideIds([]);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(hideDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeys);
    window.requestAnimationFrame(() => hideDialogRef.current?.querySelector<HTMLElement>('input, button')?.focus());
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [hideDialogOpen]);

  const filteredEntries = useMemo(() => filter === 'all' ? entries : entries.filter((entry) => entry.status === filter), [entries, filter]);
  const filteredEntryIds = useMemo(() => filteredEntries.map((entry) => entry.id), [filteredEntries]);
  const selection = useAdminSelection(filteredEntryIds);
  const { visibleItems, shownCount, totalCount, hasMore, loadMore } = useIncrementalItems(filteredEntries, GUESTBOOK_BATCH_SIZE);

  const statusCount = (status: GuestbookEntry['status']) => entries.filter((entry) => entry.status === status).length;
  const syncPublicGuestbookStatus = (ids: Set<string>, status: 'visible' | 'hidden') => {
    if (!ids.size) return;
    if (status === 'hidden') {
      setPublicGuestbook((current) => current.filter((entry) => !ids.has(entry.id)));
      return;
    }
    const restored = entries
      .filter((entry) => ids.has(entry.id))
      .map((entry) => ({ ...entry, status: 'visible' as const, hiddenReason: '' }));
    setPublicGuestbook((current) => [...restored, ...current.filter((entry) => !ids.has(entry.id))]);
  };

  const hide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ids = bulkHideIds.length ? bulkHideIds : hideTarget ? [hideTarget.id] : [];
    if (!ids.length || !hiddenReason.trim()) return;
    const bulk = bulkHideIds.length > 0;
    const updated = new Set<string>();
    setChangingId(bulk ? 'bulk' : ids[0]);
    try {
      if (bulk) {
        for (const batch of mutationBatches(ids)) {
          const result = await adminBulkUpdateGuestbook(token, batch, 'hidden', hiddenReason.trim());
          (result.updatedIds || []).forEach((id) => updated.add(id));
        }
      } else {
        await adminHideGuestbook(token, ids[0], hiddenReason.trim());
        updated.add(ids[0]);
      }
      setEntries((items) => items.map((item) => updated.has(item.id) ? { ...item, status: 'hidden', hiddenReason: hiddenReason.trim() } : item));
      syncPublicGuestbookStatus(updated, 'hidden');
      setMessage(bulk
        ? translatedMessage('admin.guestbook.bulkUpdated', { count: updated.size }, { status: { key: GUESTBOOK_STATUS_LABEL_KEYS.hidden } })
        : translatedMessage('admin.guestbook.hidden'));
      setHideTarget(null);
      setBulkHideIds([]);
      setHiddenReason('');
      if (bulk) selection.clear();
    } catch (err) {
      if (updated.size) {
        setEntries((items) => items.map((item) => updated.has(item.id) ? { ...item, status: 'hidden', hiddenReason: hiddenReason.trim() } : item));
        syncPublicGuestbookStatus(updated, 'hidden');
      }
      void adminListGuestbook(token).then((items) => setEntries([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))).catch(() => undefined);
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
      syncPublicGuestbookStatus(new Set([entry.id]), 'visible');
      setMessage(translatedMessage('admin.guestbook.restored'));
    } catch (err) {
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.guestbook.restoreFailed'));
    } finally {
      setChangingId('');
    }
  };

  const applyBulkStatus = async () => {
    if (!selection.selectedIds.length) return;
    if (bulkStatus === 'hidden') {
      setBulkHideIds([...selection.selectedIds]);
      setHideTarget(null);
      setHiddenReason('');
      return;
    }

    const ids = [...selection.selectedIds];
    const updated = new Set<string>();
    setChangingId('bulk');
    setMessage(null);
    try {
      for (const batch of mutationBatches(ids)) {
        const result = await adminBulkUpdateGuestbook(token, batch, 'visible');
        (result.updatedIds || []).forEach((id) => updated.add(id));
      }
      setEntries((items) => items.map((item) => updated.has(item.id) ? { ...item, status: 'visible', hiddenReason: '' } : item));
      syncPublicGuestbookStatus(updated, 'visible');
      setMessage(translatedMessage('admin.guestbook.bulkUpdated', { count: updated.size }, { status: { key: GUESTBOOK_STATUS_LABEL_KEYS.visible } }));
      selection.clear();
    } catch (err) {
      if (updated.size) {
        setEntries((items) => items.map((item) => updated.has(item.id) ? { ...item, status: 'visible', hiddenReason: '' } : item));
        syncPublicGuestbookStatus(updated, 'visible');
      }
      void adminListGuestbook(token).then((items) => setEntries([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))).catch(() => undefined);
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.guestbook.bulkUpdateFailed'));
    } finally {
      setChangingId('');
    }
  };

  const deleteGuestbook = async (ids: string[]) => {
    if (!ids.length || !window.confirm(t('admin.guestbook.deleteConfirm', { count: ids.length }))) return;
    const deleted = new Set<string>();
    const reflectDeletedEntries = () => {
      if (!deleted.size) return;
      setEntries((items) => items.filter((item) => !deleted.has(item.id)));
      setPublicGuestbook((current) => current.filter((item) => !deleted.has(item.id)));
    };
    setChangingId('bulk');
    setMessage(null);
    try {
      for (const batch of mutationBatches(ids)) {
        const result = await adminBulkDeleteGuestbook(token, batch);
        [...(result.deletedIds || []), ...(result.alreadyMissingIds || [])].forEach((id) => deleted.add(id));
      }
      reflectDeletedEntries();
      setMessage(translatedMessage('admin.guestbook.deleted', { count: deleted.size }));
      selection.clear();
      void adminListGuestbookIpBans(token).then(setIpBans).catch(() => undefined);
    } catch (err) {
      reflectDeletedEntries();
      void adminListGuestbook(token).then((items) => setEntries([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))).catch(() => undefined);
      if (isAdminSessionError(err)) { onSessionExpired(); return; }
      setMessage(backendErrorMessage(err, 'admin.guestbook.deleteFailed'));
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
              <AdminBulkBar
                scopeIds={filteredEntryIds}
                selection={selection}
                status={bulkStatus}
                statusOptions={([
                  ['visible', GUESTBOOK_STATUS_LABEL_KEYS.visible],
                  ['hidden', GUESTBOOK_STATUS_LABEL_KEYS.hidden]
                ] as Array<['visible' | 'hidden', TranslationKey]>).map(([value, key]) => ({ value, label: t(key) }))}
                busy={Boolean(changingId)}
                disabled={limitedMode}
                onStatusChange={(status) => setBulkStatus(status as 'visible' | 'hidden')}
                onApply={() => { void applyBulkStatus(); }}
                onDelete={() => { void deleteGuestbook(selection.selectedIds); }}
              />
              <p className="result-count">{t('common.showingOf', { total: totalCount, shown: shownCount })}</p>
              {visibleItems.map((entry) => (
                <article className="admin-guestbook-row" key={entry.id}>
                  <div className="admin-guestbook-row__head">
                    <div className="admin-guestbook-row__identity">
                      <label className="admin-row-selection">
                        <input
                          type="checkbox"
                          checked={selection.selectedSet.has(entry.id)}
                          onChange={(event) => selection.toggle(entry.id, event.target.checked)}
                          disabled={limitedMode || Boolean(changingId)}
                          aria-label={t('admin.bulk.selectItem', { name: `${entry.name} · ${formatDate(entry.createdAt)} · ${entry.message.slice(0, 24)}` })}
                        />
                      </label>
                      <strong>{entry.name}</strong>
                    </div>
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
                      <button className="admin-ip-action admin-ip-action--danger" type="button" onClick={() => { void deleteGuestbook([entry.id]); }} disabled={limitedMode || Boolean(changingId)} aria-label={t('admin.guestbook.deleteOne')} title={t('admin.guestbook.deleteOne')}>
                        <TrashIcon />
                      </button>
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

      {hideTarget || bulkHideIds.length ? (
        <div className="modal-backdrop admin-dialog-backdrop" role="presentation" onMouseDown={() => { if (!changingId) { setHideTarget(null); setBulkHideIds([]); } }}>
          <section ref={hideDialogRef} className="modal admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-hide-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-dialog__head">
              <h2 id="admin-hide-title">{bulkHideIds.length ? t('admin.hide.bulkTitle') : t('admin.hide.title')}</h2>
              <button className="admin-dialog__close" type="button" onClick={() => { setHideTarget(null); setBulkHideIds([]); }} aria-label={t('common.close')} disabled={Boolean(changingId)}><CloseIcon /></button>
            </div>
            <p>{bulkHideIds.length
              ? t('admin.hide.bulkDescription', { count: bulkHideIds.length })
              : t('admin.hide.description', { name: hideTarget?.name || '' })}</p>
            <form onSubmit={hide}>
              <div className="field">
                <label htmlFor="guestbook-hidden-reason">{t('admin.hide.reason')}</label>
                <input id="guestbook-hidden-reason" value={hiddenReason} onChange={(event) => setHiddenReason(event.target.value)} maxLength={500} required />
              </div>
              <div className="admin-dialog__actions">
                <button className="button" type="button" onClick={() => { setHideTarget(null); setBulkHideIds([]); }} disabled={Boolean(changingId)}>{t('common.cancel')}</button>
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
  const [sessionRemainingMs, setSessionRemainingMs] = useState(() =>
    session ? getAdminSessionRemainingMs(session) : 0
  );
  const lastServerRefreshAt = useRef(0);
  const lastActivityWriteAt = useRef(0);
  const activitySinceServerRefresh = useRef(false);
  const refreshInFlight = useRef(false);
  const hasSession = Boolean(session);

  const expireSession = () => {
    clearAdminSession();
    activitySinceServerRefresh.current = false;
    setSession(null);
    setSessionRemainingMs(0);
    setSessionMessage(translatedMessage('admin.sessionExpired'));
  };

  useEffect(() => {
    if (!hasSession) {
      activitySinceServerRefresh.current = false;
      setSessionRemainingMs(0);
      return undefined;
    }

    let cancelled = false;

    const applyCurrentSession = (current: NonNullable<ReturnType<typeof loadAdminSession>>) => {
      const remaining = getAdminSessionRemainingMs(current);
      setSessionRemainingMs(remaining);
      setSession((existing) => {
        if (!existing || current.token !== existing.token || current.expiresAt !== existing.expiresAt || current.lastActiveAt !== existing.lastActiveAt) {
          return current;
        }
        return existing;
      });
      return remaining;
    };

    const refreshServerIfNeeded = (
      current: NonNullable<ReturnType<typeof loadAdminSession>>,
      refreshForActiveUse = false
    ) => {
      const now = Date.now();
      const remaining = getAdminSessionRemainingMs(current, now);
      if (
        !activitySinceServerRefresh.current
        || refreshInFlight.current
        || now - lastServerRefreshAt.current < ADMIN_SESSION_REFRESH_THROTTLE_MS
        || (!refreshForActiveUse && remaining > ADMIN_SESSION_REFRESH_LEAD_MS)
      ) return;

      refreshInFlight.current = true;
      lastServerRefreshAt.current = now;
      const tokenBeforeRefresh = current.token;
      adminRefreshSession(tokenBeforeRefresh)
        .then((nextSession) => {
          if (cancelled) return;
          const latest = loadAdminSession();
          if (!latest || latest.token !== tokenBeforeRefresh) return;
          const refreshed = saveAdminSession(nextSession, latest.lastActiveAt);
          activitySinceServerRefresh.current = false;
          applyCurrentSession(refreshed);
          setSessionMessage(null);
        })
        .catch((err) => {
          if (!cancelled && isAdminSessionError(err)) expireSession();
        })
        .finally(() => { refreshInFlight.current = false; });
    };

    const checkSession = () => {
      const current = loadAdminSession();
      if (!current) {
        expireSession();
        return;
      }
      applyCurrentSession(current);
      if (document.visibilityState === 'visible') refreshServerIfNeeded(current);
    };

    const noteActivity = (refreshForActiveUse = false) => {
      const now = Date.now();
      const shouldWriteActivity = now - lastActivityWriteAt.current >= ADMIN_ACTIVITY_WRITE_INTERVAL_MS;
      if (shouldWriteActivity) lastActivityWriteAt.current = now;
      const current = shouldWriteActivity ? refreshAdminSession() : loadAdminSession();
      if (!current) {
        expireSession();
        return;
      }
      activitySinceServerRefresh.current = true;
      if (shouldWriteActivity) applyCurrentSession(current);
      refreshServerIfNeeded(current, refreshForActiveUse);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') noteActivity();
    };
    const noteGeneralActivity = () => noteActivity(false);
    const noteActiveUse = () => noteActivity(true);

    const interval = window.setInterval(checkSession, ADMIN_SESSION_CLOCK_INTERVAL_MS);
    window.addEventListener('pointerdown', noteActiveUse);
    window.addEventListener('pointermove', noteGeneralActivity, { passive: true });
    window.addEventListener('keydown', noteActiveUse);
    window.addEventListener('input', noteActiveUse);
    window.addEventListener('change', noteActiveUse);
    window.addEventListener('scroll', noteGeneralActivity, { passive: true });
    window.addEventListener('focus', noteGeneralActivity);
    document.addEventListener('visibilitychange', handleVisibility);
    checkSession();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('pointerdown', noteActiveUse);
      window.removeEventListener('pointermove', noteGeneralActivity);
      window.removeEventListener('keydown', noteActiveUse);
      window.removeEventListener('input', noteActiveUse);
      window.removeEventListener('change', noteActiveUse);
      window.removeEventListener('scroll', noteGeneralActivity);
      window.removeEventListener('focus', noteGeneralActivity);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hasSession]);

  if (!session) return <LoginPanel initialMessage={sessionMessage} onLogin={() => { setSessionMessage(null); setSession(loadAdminSession()); }} />;

  const logout = () => {
    clearAdminSession();
    activitySinceServerRefresh.current = false;
    setSession(null);
    setSessionRemainingMs(0);
    setSessionMessage(null);
  };
  const handleSessionExpired = () => expireSession();
  return (
    <AppLayout>
      <section className="admin-page-head" aria-labelledby="admin-title">
        <div>
          <h1 id="admin-title" className="page-title">{t('admin.title')}</h1>
          <p className="lead">{t('admin.lead')}</p>
        </div>
        <div className="admin-session-actions">
          <p className="admin-session-status">
            <strong>{t('admin.session.remaining', { time: formatSessionRemaining(sessionRemainingMs) })}</strong>
            <span>{t('admin.session.autoRefresh')}</span>
          </p>
          <button className="button admin-logout" type="button" onClick={logout}><LogOutIcon /> {t('admin.logout')}</button>
        </div>
      </section>

      <div className="tabs admin-tabs" role="tablist" aria-label={t('admin.menu')}>
        {(['posts', 'assets', 'things', 'guestbook'] as Tab[]).map((item) => (
          <button id={`admin-tab-${item}`} className={`button ${tab === item ? 'button--primary' : ''}`} type="button" role="tab" key={item} aria-selected={tab === item} aria-controls={`admin-panel-${item}`} onClick={() => setTab(item)}>{t(TAB_LABEL_KEYS[item])}</button>
        ))}
      </div>

      <div id={`admin-panel-${tab}`} className="admin-tab-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'posts' ? <PostsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
        {tab === 'assets' ? <AssetsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
        {tab === 'things' ? <ThingsAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
        {tab === 'guestbook' ? <GuestbookAdmin token={session.token} onSessionExpired={handleSessionExpired} /> : null}
      </div>
    </AppLayout>
  );
}
