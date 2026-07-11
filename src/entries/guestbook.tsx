import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  createGuestbookEntry,
  hideGuestbookEntry
} from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { ChevronDownIcon, TrashIcon } from '../components/ToolIcons';
import { TurnstileBox } from '../components/TurnstileBox';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { type TranslationKey, useI18n } from '../i18n';
import { refreshGuestbook, setPublicGuestbook, usePublicResource } from '../stores/publicDataStore';
import type { GuestbookEntry } from '../types';
import { formatDate } from '../utils/date';

const GUESTBOOK_BATCH_SIZE = 10;
const DEFAULT_GUESTBOOK_NAME = 'ㅇㅁ';

type GuestbookNotice = { key: TranslationKey } | { text: string };

function isPendingEntry(entry: GuestbookEntry) {
  return entry.id.startsWith('temp-');
}

function byNewestFirst(a: GuestbookEntry, b: GuestbookEntry) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function normalizeEntry(entry: GuestbookEntry): GuestbookEntry {
  return {
    ...entry,
    id: String(entry.id),
    name: String(entry.name || ''),
    message: String(entry.message || ''),
    createdAt: String(entry.createdAt || new Date().toISOString())
  };
}

function mergeGuestbookEntries(serverEntries: GuestbookEntry[], currentEntries: GuestbookEntry[], locallyHiddenIds: Set<string>) {
  const pendingEntries = currentEntries.filter(isPendingEntry).map(normalizeEntry);
  const serverVisibleEntries = serverEntries
    .filter((entry) => entry.status === 'visible' && !locallyHiddenIds.has(String(entry.id)))
    .map(normalizeEntry)
    .sort(byNewestFirst);
  const serverIds = new Set(serverVisibleEntries.map((entry) => entry.id));
  return [...pendingEntries.filter((entry) => !serverIds.has(entry.id)), ...serverVisibleEntries];
}

export function GuestbookPage() {
  const { t } = useI18n();
  const guestbookResource = usePublicResource('guestbook');
  const entries = guestbookResource.items;
  const {
    visibleItems: visibleEntries,
    shownCount,
    totalCount,
    hasMore,
    loadMore
  } = useIncrementalItems(entries, GUESTBOOK_BATCH_SIZE);
  const entriesCount = useRef(entries.length);
  const locallyHiddenIds = useRef(new Set<string>());
  const [notice, setNotice] = useState<GuestbookNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const noticeText = notice ? ('key' in notice ? t(notice.key) : notice.text) : '';

  useEffect(() => {
    entriesCount.current = entries.length;
  }, [entries.length]);

  const load = useCallback((options: { force?: boolean; silent?: boolean } = {}) => {
    void refreshGuestbook({ force: options.force, silent: options.silent ?? entriesCount.current > 0 })
      .then((serverEntries) => {
        setPublicGuestbook((current) => mergeGuestbookEntries(serverEntries, current, locallyHiddenIds.current));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load({ silent: entriesCount.current > 0 });
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim() || DEFAULT_GUESTBOOK_NAME;
    const body = String(form.get('message') || '').trim();
    const deletePassword = String(form.get('deletePassword') || '');
    const website = String(form.get('website') || '');

    if (!body || !deletePassword) {
      setNotice({ key: 'guestbook.required' });
      return;
    }
    if (!turnstileToken) {
      setNotice({ key: 'guestbook.humanRequired' });
      return;
    }

    const optimisticEntry: GuestbookEntry = {
      id: `temp-${Date.now()}`,
      name,
      message: body,
      status: 'visible',
      createdAt: new Date().toISOString()
    };

    setSaving(true);
    setNotice({ key: 'guestbook.optimistic' });
    formElement.reset();
    setPublicGuestbook((current) => [optimisticEntry, ...current]);

    try {
      const created = normalizeEntry(await createGuestbookEntry({ name, message: body, deletePassword, turnstileToken, website }));
      setPublicGuestbook((current) => [created, ...current.filter((entry) => entry.id !== optimisticEntry.id && entry.id !== created.id)].sort(byNewestFirst));
      setNotice({ key: 'guestbook.saved' });
    } catch (err) {
      setPublicGuestbook((current) => current.filter((entry) => entry.id !== optimisticEntry.id));
      setNotice(err instanceof Error ? { text: err.message } : { key: 'guestbook.saveFailed' });
    } finally {
      setSaving(false);
      setTurnstileToken('');
      setTurnstileResetKey((key) => key + 1);
    }
  };

  const requestHide = async (entry: GuestbookEntry) => {
    if (isPendingEntry(entry)) return;
    const deletePassword = window.prompt(t('guestbook.deletePrompt'));
    if (!deletePassword) return;

    locallyHiddenIds.current.add(entry.id);
    setPublicGuestbook((current) => current.filter((item) => item.id !== entry.id));

    try {
      await hideGuestbookEntry({ id: entry.id, deletePassword });
      setPublicGuestbook((current) => current.filter((item) => item.id !== entry.id));
    } catch (err) {
      locallyHiddenIds.current.delete(entry.id);
      setPublicGuestbook((current) => [entry, ...current.filter((item) => item.id !== entry.id)].sort(byNewestFirst));
      window.alert(err instanceof Error ? err.message : t('guestbook.deleteFailed'));
    }
  };

  return (
    <AppLayout>
      <h1 className="sr-only">{t('guestbook.title')}</h1>
      <section className="guestbook-flow">
        <details
          className="panel guestbook-composer"
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setComposerOpen(open);
            if (!open) setTurnstileToken('');
          }}
        >
          <summary className="guestbook-composer__summary">
            <span>{t('guestbook.open')}</span>
            <ChevronDownIcon className="guestbook-composer__icon" />
          </summary>
          <form className="guestbook-form" onSubmit={submit} aria-label={t('guestbook.form')}>
            <div className="guestbook-form__content">
              <div className="guestbook-form__fields">
                <div className="field guestbook-field guestbook-field--message">
                  <label className="sr-only" htmlFor="guestbook-message">{t('guestbook.message')}</label>
                  <textarea id="guestbook-message" name="message" maxLength={1000} required placeholder={t('guestbook.message')} />
                </div>
                <div className="field guestbook-field">
                  <label className="sr-only" htmlFor="guestbook-name">{t('guestbook.name')}</label>
                  <input
                    id="guestbook-name"
                    name="name"
                    maxLength={40}
                    placeholder={t('guestbook.nameOptional')}
                    aria-describedby="guestbook-name-help"
                  />
                  <span className="help-text" id="guestbook-name-help">{t('guestbook.nameHelp')}</span>
                </div>
                <div className="field guestbook-field">
                  <label className="sr-only" htmlFor="guestbook-password">{t('guestbook.password')}</label>
                  <input
                    id="guestbook-password"
                    name="deletePassword"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder={t('guestbook.password')}
                    aria-describedby="guestbook-password-help"
                  />
                  <span className="help-text" id="guestbook-password-help">{t('guestbook.passwordHelp')}</span>
                </div>
              </div>
              <div className="guestbook-contact-field" aria-hidden="true">
                <label htmlFor="guestbook-website">{t('guestbook.website')}</label>
                <input id="guestbook-website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              {composerOpen ? (
                <TurnstileBox
                  action="guestbook_create"
                  onTokenChange={setTurnstileToken}
                  resetKey={turnstileResetKey}
                />
              ) : null}
              {noticeText ? <p className="status-message">{noticeText}</p> : null}
              <div className="guestbook-form__actions">
                <button className="button button--primary" type="submit" disabled={saving}>{saving ? t('guestbook.sending') : t('guestbook.write')}</button>
              </div>
            </div>
          </form>
        </details>
        <section className="stack" aria-label={t('guestbook.list')}>
          {guestbookResource.status === 'loading' ? <LoadingState /> : null}
          {guestbookResource.status === 'error' ? <ErrorState message={guestbookResource.error} onRetry={() => load({ force: true })} /> : null}
          {guestbookResource.status === 'ready' && !entries.length ? <EmptyState label={t('guestbook.empty')} /> : null}
          {visibleEntries.map((entry) => {
            const pending = isPendingEntry(entry);
            const displayName = entry.name.trim() || DEFAULT_GUESTBOOK_NAME;
            return (
              <article className="list-item guestbook-entry" key={entry.id} aria-busy={pending}>
                <p className="guestbook-entry__message">{entry.message}</p>
                <footer className="guestbook-entry__footer">
                  <div className="guestbook-entry__byline">
                    <strong className="guestbook-entry__name">{displayName}</strong>
                    <p className="meta">{pending ? t('guestbook.pending') : formatDate(entry.createdAt)}</p>
                  </div>
                  <button
                    className="button guestbook-entry__delete"
                    type="button"
                    disabled={pending}
                    onClick={() => requestHide(entry)}
                    aria-label={t('guestbook.deleteBy', { name: displayName })}
                    title={t('guestbook.delete')}
                  >
                    <TrashIcon />
                  </button>
                </footer>
              </article>
            );
          })}
          <IncrementalLoadMore
            hasMore={hasMore}
            label={t('guestbook.loadMore', { count: Math.min(GUESTBOOK_BATCH_SIZE, totalCount - shownCount) })}
            onLoadMore={loadMore}
          />
        </section>
      </section>
      <BackToTopButton />
    </AppLayout>
  );
}
