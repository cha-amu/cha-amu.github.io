import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { navigateTo } from '../utils/router';
import { CloseIcon, GuestbookIcon, SearchIcon, SettingsIcon } from './ToolIcons';

function currentPath(): string {
  return window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
}

export function SiteTools({ showSearch = true }: { showSearch?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const settingsTitleId = useId();
  const searchDialogId = useId();
  const searchTitleId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const path = currentPath();
  const isGuestbook = path === '/guestbook/';

  useEffect(() => {
    if (!settingsOpen && !searchOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setSearchOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, searchOpen]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const openSearch = () => {
    setSettingsOpen(false);
    setSearchOpen(true);
  };

  const openSettings = () => {
    setSearchOpen(false);
    setSettingsOpen(true);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    setSearchOpen(false);
    navigateTo(trimmed ? `/search/?q=${encodeURIComponent(trimmed)}` : '/search/');
  };

  return (
    <>
      <div className="site-tools" aria-label="공통 도구">
        {showSearch ? (
          <button
            className="tool-icon-link"
            type="button"
            aria-label="검색 열기"
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? searchDialogId : undefined}
            onClick={openSearch}
          >
            <SearchIcon />
          </button>
        ) : null}
        <a
          className={`tool-icon-link ${isGuestbook ? 'tool-icon-link--active' : ''}`}
          href="/guestbook/"
          aria-label="방명록"
          aria-current={isGuestbook ? 'page' : undefined}
        >
          <GuestbookIcon />
        </a>
        <button
          className="tool-icon-link"
          type="button"
          aria-label="설정 열기"
          aria-expanded={settingsOpen}
          onClick={openSettings}
        >
          <SettingsIcon />
        </button>
      </div>

      {searchOpen ? createPortal(
        <div className="search-layer" role="presentation">
          <button className="search-backdrop" type="button" aria-label="검색 닫기" onClick={() => setSearchOpen(false)} />
          <section id={searchDialogId} className="global-search-panel" role="dialog" aria-modal="true" aria-labelledby={searchTitleId}>
            <div className="global-search-panel__head">
              <h2 id={searchTitleId}>검색</h2>
              <button className="global-search-panel__close" type="button" onClick={() => setSearchOpen(false)} aria-label="검색 닫기">
                <CloseIcon />
              </button>
            </div>
            <form className="global-search-panel__form" role="search" onSubmit={submitSearch}>
              <input
                ref={searchInputRef}
                aria-label="통합 검색어"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="검색어"
              />
              <button className="global-search-panel__submit" type="submit" aria-label="검색">
                <SearchIcon />
              </button>
            </form>
          </section>
        </div>,
        document.body
      ) : null}

      {settingsOpen ? createPortal(
        <div className="settings-layer" role="presentation">
          <button className="settings-backdrop" type="button" aria-label="설정 닫기" onClick={() => setSettingsOpen(false)} />
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby={settingsTitleId}>
            <div className="settings-panel__head">
              <h2 id={settingsTitleId}>설정</h2>
              <button className="settings-panel__close" type="button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">
                <CloseIcon />
              </button>
            </div>

            <section className="settings-section" aria-labelledby={`${settingsTitleId}-language`}>
              <h3 id={`${settingsTitleId}-language`}>언어</h3>
              <p className="help-text">현재는 한국어만 제공합니다.</p>
              <button className="button button--primary" type="button" disabled>
                한국어
              </button>
            </section>

            <section className="settings-section" aria-labelledby={`${settingsTitleId}-theme`}>
              <h3 id={`${settingsTitleId}-theme`}>테마</h3>
              <p className="help-text">지금은 밝은 테마 고정입니다. 어두운 테마는 나중에 추가합니다.</p>
              <button className="button button--primary" type="button" disabled>
                밝은 테마
              </button>
            </section>

            <p className="help-text">이 설정은 방문자용 표시 설정입니다. 관리자 페이지 설정과는 분리합니다.</p>
          </aside>
        </div>,
        document.body
      ) : null}
    </>
  );
}
