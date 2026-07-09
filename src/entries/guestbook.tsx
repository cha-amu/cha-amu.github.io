import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  createGuestbookEntry,
  hideGuestbookEntry
} from '../api/appsScriptClient';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { TurnstileBox } from '../components/TurnstileBox';
import { refreshGuestbook, setPublicGuestbook, usePublicResource } from '../stores/publicDataStore';
import type { GuestbookEntry } from '../types';
import { formatDate } from '../utils/date';

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
    load({ force: true, silent: entriesCount.current > 0 });
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
      setMessage('이름, 메시지, 삭제용 비밀번호를 모두 입력해야 합니다.');
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
    const deletePassword = window.prompt('글을 숨김 처리하려면 작성 시 입력한 삭제용 비밀번호를 입력하세요.');
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
        <form className="panel" onSubmit={submit} aria-labelledby="guestbook-form-title">
          <h2 id="guestbook-form-title">글 남기기</h2>
          <p className="section-note">익명 이름과 삭제용 비밀번호로 남깁니다.</p>
          <div className="field">
            <label htmlFor="guestbook-name">이름</label>
            <input id="guestbook-name" name="name" maxLength={40} required placeholder="아무이름" />
          </div>
          <div className="field">
            <label htmlFor="guestbook-message">메시지</label>
            <textarea id="guestbook-message" name="message" maxLength={1000} required placeholder="남기고 싶은 글" />
          </div>
          <div className="field">
            <label htmlFor="guestbook-password">삭제용 비밀번호</label>
            <input id="guestbook-password" name="deletePassword" type="password" required autoComplete="new-password" />
            <span className="help-text">비밀번호는 서버에서 salt/hash 처리되어 저장됩니다.</span>
          </div>
          <TurnstileBox />
          {message ? <p className="status-message">{message}</p> : null}
          {guestbookResource.refreshing ? <p className="meta">최신 방명록 확인 중</p> : null}
          <button className="button button--primary" type="submit" disabled={saving}>{saving ? '전송 중' : '작성'}</button>
        </form>
        <section className="stack" aria-label="방명록 목록">
          {guestbookResource.status === 'loading' ? <LoadingState /> : null}
          {guestbookResource.status === 'error' ? <ErrorState message={guestbookResource.error} onRetry={() => load({ force: true })} /> : null}
          {guestbookResource.status === 'ready' && !entries.length ? <EmptyState label="아직 방명록이 없습니다." /> : null}
          {entries.map((entry) => {
            const pending = isPendingEntry(entry);
            return (
              <article className="list-item" key={entry.id} aria-busy={pending}>
                <h2>{entry.name}</h2>
                <p>{entry.message}</p>
                <p className="meta">{pending ? '서버 반영 확인 중' : formatDate(entry.createdAt)}</p>
                <button className="button button--danger" type="button" disabled={pending} onClick={() => requestHide(entry)}>삭제/숨김</button>
              </article>
            );
          })}
        </section>
      </section>
    </AppLayout>
  );
}
