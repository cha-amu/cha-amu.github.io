import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type LanguagePreference, useI18n } from '../i18n';
import { navigateTo } from '../utils/router';
import { CloseIcon, GuestbookIcon, SearchIcon, SettingsIcon } from './ToolIcons';

function currentPath(): string {
  return window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
}

export function SiteTools({ showSearch = true }: { showSearch?: boolean }) {
  const { preference, setLanguagePreference, t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const settingsTitleId = useId();
  const searchDialogId = useId();
  const searchTitleId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const path = currentPath();
  const isGuestbook = path === '/guestbook/';
  const languageOptions: Array<{ value: LanguagePreference; label: string }> = [
    { value: 'auto', label: t('settings.auto') },
    { value: 'ko', label: t('settings.korean') },
    { value: 'en', label: t('settings.english') }
  ];

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
      <div className="site-tools" aria-label={t('aria.tools')}>
        {showSearch ? (
          <button
            className="tool-icon-link"
            type="button"
            aria-label={t('search.open')}
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
          aria-label={t('nav.guestbook')}
          aria-current={isGuestbook ? 'page' : undefined}
        >
          <GuestbookIcon />
        </a>
        <button
          className="tool-icon-link"
          type="button"
          aria-label={t('settings.open')}
          aria-expanded={settingsOpen}
          onClick={openSettings}
        >
          <SettingsIcon />
        </button>
      </div>

      {searchOpen ? createPortal(
        <div className="search-layer" role="presentation">
          <button className="search-backdrop" type="button" aria-label={t('search.close')} onClick={() => setSearchOpen(false)} />
          <section id={searchDialogId} className="global-search-panel" role="dialog" aria-modal="true" aria-labelledby={searchTitleId}>
            <div className="global-search-panel__head">
              <h2 id={searchTitleId}>{t('search.title')}</h2>
              <button className="global-search-panel__close" type="button" onClick={() => setSearchOpen(false)} aria-label={t('search.close')}>
                <CloseIcon />
              </button>
            </div>
            <form className="global-search-panel__form" role="search" onSubmit={submitSearch}>
              <input
                ref={searchInputRef}
                aria-label={t('search.query')}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('search.placeholder')}
              />
              <button className="global-search-panel__submit" type="submit" aria-label={t('search.title')}>
                <SearchIcon />
              </button>
            </form>
          </section>
        </div>,
        document.body
      ) : null}

      {settingsOpen ? createPortal(
        <div className="settings-layer" role="presentation">
          <button className="settings-backdrop" type="button" aria-label={t('settings.close')} onClick={() => setSettingsOpen(false)} />
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby={settingsTitleId}>
            <div className="settings-panel__head">
              <h2 id={settingsTitleId}>{t('settings.title')}</h2>
              <button className="settings-panel__close" type="button" onClick={() => setSettingsOpen(false)} aria-label={t('settings.close')}>
                <CloseIcon />
              </button>
            </div>

            <section className="settings-section" aria-labelledby={`${settingsTitleId}-language`}>
              <h3 id={`${settingsTitleId}-language`}>{t('settings.language')}</h3>
              <fieldset className="language-options">
                <legend className="sr-only">{t('settings.language')}</legend>
                {languageOptions.map((option) => (
                  <label key={option.value}>
                    <input
                      type="radio"
                      name={`${settingsTitleId}-language-preference`}
                      value={option.value}
                      checked={preference === option.value}
                      onChange={() => setLanguagePreference(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            </section>

            <footer className="settings-panel__footer">
              <a href="/privacy/" onClick={() => setSettingsOpen(false)}>{t('nav.privacy')}</a>
            </footer>
          </aside>
        </div>,
        document.body
      ) : null}
    </>
  );
}
