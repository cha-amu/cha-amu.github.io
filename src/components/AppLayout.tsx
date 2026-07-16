import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { type TranslationKey, useI18n } from '../i18n';
import { SiteTools } from './SiteTools';
import '../styles/global.css';

const navItems = [
  { href: '/posts/', labelKey: 'nav.posts', icon: '/assets/ui/posts-icon.png' },
  { href: '/archive/', labelKey: 'nav.archive', icon: '/assets/ui/archive-icon.png' },
  { href: '/things/', labelKey: 'nav.things', icon: 'https://cha-amu.github.io/storage/assets/images/2026/아무거--아이콘+사이트+앱--파스텔_돌_캐릭터.png' }
] satisfies Array<{ href: string; labelKey: TranslationKey; icon: string }>;

const HEADER_COMPACT_DISTANCE = 112;

function currentPath(): string {
  return window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
}

function MainNav({ className = '', label }: { className?: string; label?: string }) {
  const { t } = useI18n();
  const path = currentPath();
  return (
    <nav className={`main-nav ${className}`.trim()} aria-label={label || t('aria.mainMenu')}>
      {navItems.map((item) => (
        <a key={item.href} href={item.href} aria-label={t(item.labelKey)} aria-current={path === item.href ? 'page' : undefined}>
          <img src={item.icon} alt="" />
          <span>{t(item.labelKey)}</span>
        </a>
      ))}
    </nav>
  );
}

export function Header() {
  const { t } = useI18n();
  const [scrollProgress, setScrollProgress] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return Math.min(1, window.scrollY / HEADER_COMPACT_DISTANCE);
  });

  useEffect(() => {
    let frame = 0;
    const updateProgress = () => {
      frame = 0;
      setScrollProgress(Math.min(1, window.scrollY / HEADER_COMPACT_DISTANCE));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const compactProgress = Math.max(0, Math.min(1, (scrollProgress - 0.12) / 0.88));
  const headerStyle = {
    '--header-main-nav-y': `${Math.round(scrollProgress * -88)}px`,
    '--header-main-nav-scale': String(1 - scrollProgress * 0.34),
    '--header-main-nav-opacity': String(Math.max(0, 1 - scrollProgress * 1.9)),
    '--header-compact-nav-y': `${Math.round((1 - compactProgress) * 42)}px`,
    '--header-compact-nav-scale': String(0.72 + compactProgress * 0.28),
    '--header-compact-nav-opacity': String(compactProgress),
    '--header-brand-text-opacity': String(Math.max(0, 1 - scrollProgress * 1.8))
  } as CSSProperties;

  return (
    <header className={`site-header ${scrollProgress > 0.82 ? 'site-header--compact' : ''}`} style={headerStyle}>
      <div className="site-header__tools">
        <a className="topbar-brand" href="/" aria-label={t('aria.home')}>
          <img src="/assets/ui/cha-amu-logo.png" alt="" />
          <span>{t('brand.name')}</span>
        </a>
        <MainNav className="main-nav--compact" label={t('aria.topMenu')} />
        <SiteTools />
      </div>
      <div className="site-header__inner">
        <MainNav />
      </div>
    </header>
  );
}

export function AppLayout({ children, narrow = false, variant }: { children: ReactNode; narrow?: boolean; variant?: 'admin' }) {
  const className = ['page', narrow ? 'page-narrow' : '', variant === 'admin' ? 'page--admin' : ''].filter(Boolean).join(' ');

  return (
    <div className="app-shell">
      <Header />
      <main className={className}>
        <div className="page__inner">{children}</div>
      </main>
    </div>
  );
}
