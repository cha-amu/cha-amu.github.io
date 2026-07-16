import { SearchForm } from '../components/SearchForm';
import { SiteTools } from '../components/SiteTools';
import { type TranslationKey, useI18n } from '../i18n';

const canonicalRoutes = ['/posts', '/things', '/guestbook', '/archive', '/search', '/privacy', '/admin'];
if (canonicalRoutes.includes(window.location.pathname)) {
  window.location.replace(`${window.location.pathname}/${window.location.search}${window.location.hash}`);
}

const menuItems = [
  { href: '/posts/', labelKey: 'nav.posts', icon: '/assets/ui/posts-icon.png' },
  { href: '/archive/', labelKey: 'nav.archive', icon: '/assets/ui/archive-icon.png' },
  { href: '/things/', labelKey: 'nav.things', icon: 'https://cha-amu.github.io/storage/assets/images/2026/아무거--아이콘+사이트+앱--파스텔_돌_캐릭터.png' }
] satisfies Array<{ href: string; labelKey: TranslationKey; icon: string }>;

export function HomePage() {
  const { t } = useI18n();
  return (
    <main className="home-screen">
      <div className="site-header__tools">
        <SiteTools showSearch={false} />
      </div>
      <section className="home-cluster" aria-labelledby="home-title">
        <div className="home-intro">
          <img className="home-logo" src="/assets/ui/cha-amu-logo.png" alt={t('home.logoAlt')} />
          <p id="home-title" className="home-copy">{t('brand.name')}</p>
        </div>
        <nav className="home-menu" aria-label={t('home.menu')}>
          {menuItems.map((item) => (
            <a className="home-menu-box" href={item.href} key={item.href}>
              <img src={item.icon} alt="" />
              <span>{t(item.labelKey)}</span>
            </a>
          ))}
        </nav>
        <SearchForm variant="home" />
      </section>
    </main>
  );
}
