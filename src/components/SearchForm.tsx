import { FormEvent, useState } from 'react';

export function SearchForm({
  initialValue = '',
  compact = false,
  variant = 'default'
}: {
  initialValue?: string;
  compact?: boolean;
  variant?: 'default' | 'home';
}) {
  const [query, setQuery] = useState(initialValue);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    window.location.href = trimmed ? `/search/?q=${encodeURIComponent(trimmed)}` : '/search/';
  };

  return (
    <form className={`search-form ${variant === 'home' ? 'search-form--home' : ''}`} onSubmit={submit} role="search">
      <input
        aria-label="통합 검색어"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="검색창"
      />
      <button className="button button--primary search-submit" type="submit" aria-label="검색">
        {compact ? '검색' : <><span className="search-icon-vector" aria-hidden="true" />검색</>}
      </button>
    </form>
  );
}
