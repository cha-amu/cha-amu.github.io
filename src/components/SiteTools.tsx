import { useEffect, useId, useState } from 'react';
import { SearchForm } from './SearchForm';
import { GuestbookIcon, SettingsIcon } from './ToolIcons';

function currentPath(): string {
  return window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
}

export function SiteTools({ showSearch = true }: { showSearch?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const titleId = useId();
  const path = currentPath();
  const isGuestbook = path === '/guestbook/';

  useEffect(() => {
    if (!settingsOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  return (
    <>
      <div className="site-tools" aria-label="공통 도구">
        {showSearch ? <SearchForm compact variant="toolbar" /> : null}
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
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon />
        </button>
      </div>

      {settingsOpen ? (
        <div className="settings-layer" role="presentation">
          <button className="settings-backdrop" type="button" aria-label="설정 닫기" onClick={() => setSettingsOpen(false)} />
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="settings-panel__head">
              <h2 id={titleId}>설정</h2>
              <button className="button" type="button" onClick={() => setSettingsOpen(false)}>
                닫기
              </button>
            </div>

            <section className="settings-section" aria-labelledby={`${titleId}-language`}>
              <h3 id={`${titleId}-language`}>언어</h3>
              <p className="help-text">현재는 한국어만 제공합니다.</p>
              <button className="button button--primary" type="button" disabled>
                한국어
              </button>
            </section>

            <section className="settings-section" aria-labelledby={`${titleId}-theme`}>
              <h3 id={`${titleId}-theme`}>테마</h3>
              <p className="help-text">지금은 밝은 테마 고정입니다. 어두운 테마는 나중에 추가합니다.</p>
              <button className="button button--primary" type="button" disabled>
                밝은 테마
              </button>
            </section>

            <p className="help-text">이 설정은 방문자용 표시 설정입니다. 관리자 페이지 설정과는 분리합니다.</p>
          </aside>
        </div>
      ) : null}
    </>
  );
}
