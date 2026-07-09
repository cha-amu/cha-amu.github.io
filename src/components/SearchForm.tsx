import { FormEvent, useState } from 'react';
import { SearchIcon } from './ToolIcons';

export function SearchForm({
  initialValue = '',
  compact = false,
  variant = 'default'
}: {
  initialValue?: string;
  compact?: boolean;
  variant?: 'default' | 'home' | 'toolbar';
}) {
  const [query, setQuery] = useState(initialValue);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    window.location.href = trimmed ? `/search/?q=${encodeURIComponent(trimmed)}` : '/search/';
  };

  return (
    <form
      className={`search-form ${variant === 'home' ? 'search-form--home' : ''} ${variant === 'toolbar' ? 'search-form--toolbar' : ''}`}
      onSubmit={submit}
      role="search"
    >
      <input
        aria-label="통합 검색어"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={variant === 'toolbar' ? '검색' : '검색창'}
      />
      <button className="button button--primary search-submit" type="submit" aria-label="검색">
        <SearchIcon />
        {compact ? <span className="sr-only">검색</span> : '검색'}
      </button>
    </form>
  );
}
