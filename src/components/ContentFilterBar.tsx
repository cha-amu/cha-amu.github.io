import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

export function siteSearchHref(query: string) {
  return `/search/?q=${encodeURIComponent(query.trim())}`;
}

/**
 * The list filter shared by posts, archive and wiki. It narrows the current
 * section only, so once a query is typed it also offers the same query across
 * the whole site through the header search.
 */
export function ContentFilterBar({
  label,
  query,
  placeholder,
  queryLabel,
  shownCount,
  totalCount,
  filtered,
  ready = true,
  onQueryChange,
  onReset,
  children
}: {
  label: string;
  query: string;
  placeholder: string;
  queryLabel: string;
  shownCount: number;
  totalCount: number;
  filtered: boolean;
  /** False while the list is still loading, so no count of 0 is announced. */
  ready?: boolean;
  onQueryChange: (value: string) => void;
  onReset: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const trimmed = query.trim();
  return (
    <section className="content-filter-bar" aria-label={label}>
      <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} aria-label={queryLabel} />
      {children}
      <div className="content-filter-bar__status">
        <span className="result-count" aria-live="polite">
          {!ready ? '' : shownCount === totalCount ? t('common.showing', { count: totalCount }) : t('common.showingOf', { total: totalCount, shown: shownCount })}
        </span>
        {filtered ? <button className="filter-reset" type="button" onClick={onReset}>{t('common.reset')}</button> : null}
        {trimmed ? <a className="filter-link" href={siteSearchHref(trimmed)}>{t('search.everywhere')}</a> : null}
      </div>
    </section>
  );
}

/** Shown when a section filter finds nothing: run the same query everywhere. */
export function SiteSearchLink({ query }: { query: string }) {
  const { t } = useI18n();
  const trimmed = query.trim();
  return trimmed ? <a className="filter-link" href={siteSearchHref(trimmed)}>{t('search.everywhereFor', { query: trimmed })}</a> : null;
}
