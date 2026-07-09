import type { ReactNode } from 'react';
import { SiteTools } from './SiteTools';
import '../styles/global.css';

const navItems = [
  { href: '/posts/', label: '아무 글', icon: '/assets/ui/posts-icon.png' },
  { href: '/archive/', label: '자료', icon: '/assets/ui/archive-icon.png' }
];

function currentPath(): string {
  return window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
}

export function Header() {
  const path = currentPath();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="topbar-brand" href="/" aria-label="홈으로 이동">
          <img src="/assets/ui/cha-amu-logo.png" alt="" />
          <span>그냥 아무거나 올리는 채널</span>
        </a>
        <div className="header-actions">
          <nav className="main-nav" aria-label="주요 메뉴">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} aria-current={path === item.href ? 'page' : undefined}>
                <img src={item.icon} alt="" />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <SiteTools />
        </div>
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
