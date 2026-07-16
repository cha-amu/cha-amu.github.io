import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { useI18n } from '../i18n';
import { refreshThings, usePublicResource } from '../stores/publicDataStore';
import type { Thing } from '../types';

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function ThingEntry({ thing, href, hostname, imageUrl }: { thing: Thing; href: string; hostname: string; imageUrl?: string }) {
  const { t } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !imageFailed;
  const titleId = `thing-title-${encodeURIComponent(thing.id)}`;

  return (
    <article className="post-entry post-entry--link" aria-labelledby={titleId}>
      <a
        className={`post-entry__summary ${showImage ? 'thing-entry__summary--with-image' : ''}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {showImage ? (
          <span className="thing-entry__thumbnail" aria-hidden="true">
            <img src={imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          </span>
        ) : null}
        <div className="thing-entry__content">
          <h2 id={titleId}>{thing.title}</h2>
          {thing.description ? <p>{thing.description}</p> : null}
          <p className="meta">
            {hostname} <span aria-hidden="true">↗</span>
            <span className="sr-only">{t('things.open', { title: thing.title })}</span>
          </p>
        </div>
      </a>
    </article>
  );
}

export function ThingsPage() {
  const { t } = useI18n();
  const resource = usePublicResource('things');
  const things = useMemo(() => resource.items.flatMap((thing) => {
    const url = safeHttpUrl(thing.url);
    const imageUrl = thing.imageUrl ? safeHttpUrl(thing.imageUrl)?.href : undefined;
    return url ? [{ thing, href: url.href, hostname: url.hostname.replace(/^www\./i, ''), imageUrl }] : [];
  }), [resource.items]);

  const load = () => {
    void refreshThings({ force: true, silent: resource.items.length > 0 }).catch(() => undefined);
  };

  useEffect(() => {
    void refreshThings({ silent: resource.items.length > 0 }).catch(() => undefined);
  }, []);

  return (
    <AppLayout>
      <h1 className="sr-only">{t('nav.things')}</h1>
      {resource.refreshing ? <p className="meta">{t('things.refreshing')}</p> : null}
      {resource.status === 'loading' ? <LoadingState /> : null}
      {resource.status === 'error' ? <ErrorState message={resource.error} onRetry={load} /> : null}
      {resource.status === 'ready' && !things.length ? <EmptyState label={t('things.empty')} /> : null}
      {things.length ? (
        <section className="post-flow" aria-label={t('things.list')}>
          {things.map(({ thing, href, hostname, imageUrl }) => (
            <ThingEntry
              key={`${thing.id}:${imageUrl || ''}`}
              thing={thing}
              href={href}
              hostname={hostname}
              imageUrl={imageUrl}
            />
          ))}
        </section>
      ) : null}
      <BackToTopButton />
    </AppLayout>
  );
}
