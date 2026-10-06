import { SearchForm } from '../components/SearchForm';
import { SiteTools } from '../components/SiteTools';
import { useI18n } from '../i18n';
import { mainMenuItems } from '../components/mainMenu';

const canonicalRoutes = ['/posts', '/things', '/guestbook', '/archive', '/search', '/privacy', '/admin'];
if (canonicalRoutes.includes(window.location.pathname)) {
  window.location.replace(`${window.location.pathname}/${window.location.search}${window.location.hash}`);
}

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
          {mainMenuItems.map((item) => (
            <a className="home-menu-box" href={item.href} data-native-navigation={item.native || undefined} key={item.href}>
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
