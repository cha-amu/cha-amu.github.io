import { FormEvent, useState } from 'react';
import { useI18n } from '../i18n';
import { SearchIcon } from './ToolIcons';
import { navigateTo } from '../utils/router';

export function SearchForm({
  initialValue = '',
  compact = false,
  variant = 'default'
}: {
  initialValue?: string;
  compact?: boolean;
  variant?: 'default' | 'home';
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialValue);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigateTo(trimmed ? `/search/?q=${encodeURIComponent(trimmed)}` : '/search/');
  };

  return (
    <form
      className={`search-form ${variant === 'home' ? 'search-form--home' : ''}`}
      onSubmit={submit}
      role="search"
    >
      <input
        aria-label={t('search.query')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('search.inputPlaceholder')}
      />
      <button className="button button--primary search-submit" type="submit" aria-label={t('search.title')}>
        <SearchIcon />
        {compact ? <span className="sr-only">{t('search.title')}</span> : t('search.title')}
      </button>
    </form>
  );
}
