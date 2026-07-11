import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './entries/admin';
import { ArchivePage } from './entries/archive';
import { GuestbookPage } from './entries/guestbook';
import { HomePage } from './entries/home';
import { PostsErrorBoundary, PostsPage } from './entries/posts';
import { PrivacyPage } from './entries/privacy';
import { SearchPage } from './entries/search';
import { AppLayout } from './components/AppLayout';
import { EmptyState } from './components/PageState';
import { type TranslationKey, useI18n } from './i18n';
import { preloadPublicData } from './stores/publicDataStore';
import { canonicalizeCurrentUrl, isPlainInternalNavigation, navigateTo, readAppLocation } from './utils/router';
import './styles/global.css';

const PAGE_TITLE_KEYS: Record<string, TranslationKey> = {
  '/posts/': 'nav.posts',
  '/archive/': 'nav.archive',
  '/guestbook/': 'nav.guestbook',
  '/search/': 'nav.search',
  '/privacy/': 'nav.privacy',
  '/admin/': 'nav.admin'
};

const BROWSER_TITLE = '채아무';

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <AppLayout>
      <EmptyState label={t('page.notFound')} />
      <a className="button button--primary" href="/">{t('page.goHome')}</a>
    </AppLayout>
  );
}

function RouteView({ pathname, routeKey }: { pathname: string; routeKey: string }) {
  if (pathname === '/') return <HomePage key={routeKey} />;
  if (pathname === '/posts/') return <PostsErrorBoundary key={routeKey}><PostsPage /></PostsErrorBoundary>;
  if (pathname === '/archive/') return <ArchivePage key={routeKey} />;
  if (pathname === '/guestbook/') return <GuestbookPage key={routeKey} />;
  if (pathname === '/search/') return <SearchPage key={routeKey} />;
  if (pathname === '/privacy/') return <PrivacyPage key={routeKey} />;
  if (pathname === '/admin/') return <AdminApp key={routeKey} />;
  return <NotFoundPage key={routeKey} />;
}

function App() {
  const { language, t } = useI18n();
  const [location, setLocation] = useState(() => {
    canonicalizeCurrentUrl();
    return readAppLocation();
  });

  useEffect(() => {
    preloadPublicData();

    const syncLocation = () => {
      canonicalizeCurrentUrl();
      setLocation(readAppLocation());
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (!isPlainInternalNavigation(event, target)) return;
      event.preventDefault();
      navigateTo(target.href);
    };

    window.addEventListener('popstate', syncLocation);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      document.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const pageTitleKey = PAGE_TITLE_KEYS[location.pathname];
    document.title = pageTitleKey ? `${BROWSER_TITLE} - ${t(pageTitleKey)}` : BROWSER_TITLE;
  }, [language, location.pathname, t]);

  return <RouteView pathname={location.pathname} routeKey={`${location.pathname}${location.search}`} />;
}

createRoot(document.getElementById('root')!).render(<App />);
