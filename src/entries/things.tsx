import { useEffect, useMemo } from 'react';
import { AppLayout } from '../components/AppLayout';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { useI18n } from '../i18n';
import { refreshThings, usePublicResource } from '../stores/publicDataStore';

const THINGS_ICON_URL = 'https://cha-amu.github.io/storage/ui/things-icon.png';

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url;
  } catch (_) {
    return null;
  }
}

export function ThingsPage() {
  const { t } = useI18n();
  const resource = usePublicResource('things');
  const things = useMemo(() => resource.items.flatMap((thing) => {
    const url = safeHttpUrl(thing.url);
    return url ? [{ thing, href: url.href, hostname: url.hostname.replace(/^www\./i, '') }] : [];
  }), [resource.items]);

  const load = () => {
    void refreshThings({ force: true, silent: resource.items.length > 0 }).catch(() => undefined);
  };

  useEffect(() => {
    void refreshThings({ silent: resource.items.length > 0 }).catch(() => undefined);
  }, []);

  return (
    <AppLayout>
      <header className="things-head">
        <img src={THINGS_ICON_URL} alt="" />
        <div>
          <h1 className="page-title">{t('things.title')}</h1>
          <p className="lead">{t('things.lead')}</p>
        </div>
      </header>
      {resource.refreshing ? <p className="meta">{t('things.refreshing')}</p> : null}
      {resource.status === 'loading' ? <LoadingState /> : null}
      {resource.status === 'error' ? <ErrorState message={resource.error} onRetry={load} /> : null}
      {resource.status === 'ready' && !things.length ? <EmptyState label={t('things.empty')} /> : null}
      {things.length ? (
        <section className="things-grid" aria-label={t('things.list')}>
          {things.map(({ thing, href, hostname }) => (
            <a className="thing-card" href={href} target="_blank" rel="noopener noreferrer" key={thing.id}>
              <span className="thing-card__icon" aria-hidden="true">
                <img src={THINGS_ICON_URL} alt="" loading="lazy" />
              </span>
              <span className="thing-card__body">
                <strong>{thing.title}</strong>
                {thing.description ? <span className="thing-card__description">{thing.description}</span> : null}
                <span className="thing-card__url">
                  {hostname}
                  <span aria-hidden="true">↗</span>
                </span>
              </span>
              <span className="sr-only">{t('things.open', { title: thing.title })}</span>
            </a>
          ))}
        </section>
      ) : null}
    </AppLayout>
  );
}
