import { SearchForm } from '../components/SearchForm';
import { SiteTools } from '../components/SiteTools';

const canonicalRoutes = ['/posts', '/guestbook', '/archive', '/search', '/admin'];
if (canonicalRoutes.includes(window.location.pathname)) {
  window.location.replace(`${window.location.pathname}/${window.location.search}${window.location.hash}`);
}

const menuItems = [
  { href: '/posts/', label: '아무 글', icon: '/assets/ui/posts-icon.png' },
  { href: '/archive/', label: '자료', icon: '/assets/ui/archive-icon.png' }
];

export function HomePage() {
  return (
    <main className="home-screen">
      <div className="site-header__tools">
        <SiteTools showSearch={false} />
      </div>
      <section className="home-cluster" aria-labelledby="home-title">
        <div className="home-intro">
          <img className="home-logo" src="/assets/ui/cha-amu-logo.png" alt="채아무 아이콘" />
          <p id="home-title" className="home-copy">그냥 아무거나 올리는 채널</p>
        </div>
        <nav className="home-menu" aria-label="주요 메뉴">
          {menuItems.map((item) => (
            <a className="home-menu-box" href={item.href} key={item.href}>
              <img src={item.icon} alt="" />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <SearchForm variant="home" />
      </section>
    </main>
  );
}
