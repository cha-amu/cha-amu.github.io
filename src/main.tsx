import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './entries/admin';
import { ArchivePage } from './entries/archive';
import { GuestbookPage } from './entries/guestbook';
import { HomePage } from './entries/home';
import { PostsErrorBoundary, PostsPage } from './entries/posts';
import { SearchPage } from './entries/search';
import { AppLayout } from './components/AppLayout';
import { EmptyState } from './components/PageState';
import { preloadPublicData } from './stores/publicDataStore';
import { canonicalizeCurrentUrl, isPlainInternalNavigation, navigateTo, readAppLocation } from './utils/router';
import './styles/global.css';

const PAGE_TITLES: Record<string, string> = {
  '/': '채아무',
  '/posts/': '채아무 - 아무글',
  '/archive/': '채아무 - 자료',
  '/guestbook/': '채아무 - 방명록',
  '/search/': '채아무 - 검색',
  '/admin/': '채아무 - 관리자'
};

function NotFoundPage() {
  return (
    <AppLayout>
      <EmptyState label="없는 페이지입니다." />
      <a className="button button--primary" href="/">홈으로 이동</a>
    </AppLayout>
  );
}

function RouteView({ pathname, routeKey }: { pathname: string; routeKey: string }) {
  if (pathname === '/') return <HomePage key={routeKey} />;
  if (pathname === '/posts/') return <PostsErrorBoundary key={routeKey}><PostsPage /></PostsErrorBoundary>;
  if (pathname === '/archive/') return <ArchivePage key={routeKey} />;
  if (pathname === '/guestbook/') return <GuestbookPage key={routeKey} />;
  if (pathname === '/search/') return <SearchPage key={routeKey} />;
  if (pathname === '/admin/') return <AdminApp key={routeKey} />;
  return <NotFoundPage key={routeKey} />;
}

function App() {
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
    document.title = PAGE_TITLES[location.pathname] || '채아무';
  }, [location.pathname]);

  return <RouteView pathname={location.pathname} routeKey={`${location.pathname}${location.search}`} />;
}

createRoot(document.getElementById('root')!).render(<App />);
