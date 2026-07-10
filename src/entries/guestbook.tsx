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
import { refreshGuestbook, setPublicGuestbook, usePublicResource } from '../stores/publicDataStore';
import type { GuestbookEntry } from '../types';
import { formatDate } from '../utils/date';

const GUESTBOOK_BATCH_SIZE = 10;

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
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

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
    const name = String(form.get('name') || '').trim();
    const body = String(form.get('message') || '').trim();
    const deletePassword = String(form.get('deletePassword') || '');
    const turnstileToken = String(form.get('cf-turnstile-response') || '');

    if (!name || !body || !deletePassword) {
      setMessage('이름, 메시지, 비밀번호를 모두 입력해야 합니다.');
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
    setMessage('전송 중입니다. 글은 먼저 화면에 표시했습니다.');
    formElement.reset();
    setPublicGuestbook((current) => [optimisticEntry, ...current]);

    try {
      const created = normalizeEntry(await createGuestbookEntry({ name, message: body, deletePassword, turnstileToken }));
      setPublicGuestbook((current) => [created, ...current.filter((entry) => entry.id !== optimisticEntry.id && entry.id !== created.id)].sort(byNewestFirst));
      setMessage('방명록을 남겼습니다.');
    } catch (err) {
      setPublicGuestbook((current) => current.filter((entry) => entry.id !== optimisticEntry.id));
      setMessage(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const requestHide = async (entry: GuestbookEntry) => {
    if (isPendingEntry(entry)) return;
    const deletePassword = window.prompt('글을 지우려면 작성할 때 입력한 비밀번호를 입력하세요.');
    if (!deletePassword) return;

    locallyHiddenIds.current.add(entry.id);
    setPublicGuestbook((current) => current.filter((item) => item.id !== entry.id));

    try {
      await hideGuestbookEntry({ id: entry.id, deletePassword });
      setPublicGuestbook((current) => current.filter((item) => item.id !== entry.id));
    } catch (err) {
      locallyHiddenIds.current.delete(entry.id);
      setPublicGuestbook((current) => [entry, ...current.filter((item) => item.id !== entry.id)].sort(byNewestFirst));
      window.alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <AppLayout>
      <h1 className="sr-only">방명록</h1>
      <section className="guestbook-flow">
        <details className="panel guestbook-composer">
          <summary className="guestbook-composer__summary">
            <span>글 남기기</span>
            <ChevronDownIcon className="guestbook-composer__icon" />
          </summary>
          <form className="guestbook-form" onSubmit={submit} aria-label="방명록 글 남기기">
            <div className="guestbook-form__content">
              <div className="guestbook-form__fields">
                <div className="field guestbook-field">
                  <label className="sr-only" htmlFor="guestbook-name">이름</label>
                  <input id="guestbook-name" name="name" maxLength={40} required placeholder="이름" />
                </div>
                <div className="field guestbook-field">
                  <label className="sr-only" htmlFor="guestbook-password">비밀번호</label>
                  <input
                    id="guestbook-password"
                    name="deletePassword"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="비밀번호"
                    aria-describedby="guestbook-password-help"
                  />
                  <span className="help-text" id="guestbook-password-help">방명록을 지울 때 사용해요.</span>
                </div>
                <div className="field guestbook-field guestbook-field--message">
                  <label className="sr-only" htmlFor="guestbook-message">메시지</label>
                  <textarea id="guestbook-message" name="message" maxLength={1000} required placeholder="메시지" />
                </div>
              </div>
              <TurnstileBox />
              {message ? <p className="status-message">{message}</p> : null}
              <div className="guestbook-form__actions">
                <button className="button button--primary" type="submit" disabled={saving}>{saving ? '전송 중' : '작성'}</button>
              </div>
            </div>
          </form>
        </details>
        <section className="stack" aria-label="방명록 목록">
          {guestbookResource.status === 'loading' ? <LoadingState /> : null}
          {guestbookResource.status === 'error' ? <ErrorState message={guestbookResource.error} onRetry={() => load({ force: true })} /> : null}
          {guestbookResource.status === 'ready' && !entries.length ? <EmptyState label="아직 방명록이 없습니다." /> : null}
          {visibleEntries.map((entry) => {
            const pending = isPendingEntry(entry);
            return (
              <article className="list-item guestbook-entry" key={entry.id} aria-busy={pending}>
                <header className="guestbook-entry__head">
                  <h2>{entry.name}</h2>
                  <div className="guestbook-entry__meta">
                    <p className="meta">{pending ? '서버 반영 확인 중' : formatDate(entry.createdAt)}</p>
                    <button
                      className="button guestbook-entry__delete"
                      type="button"
                      disabled={pending}
                      onClick={() => requestHide(entry)}
                      aria-label={`${entry.name}님의 방명록 글 지우기`}
                      title="글 지우기"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </header>
                <p className="guestbook-entry__message">{entry.message}</p>
              </article>
            );
          })}
          <IncrementalLoadMore
            hasMore={hasMore}
            label={`방명록 ${Math.min(GUESTBOOK_BATCH_SIZE, totalCount - shownCount)}개 더보기`}
            onLoadMore={loadMore}
          />
        </section>
      </section>
      <BackToTopButton />
    </AppLayout>
  );
}
