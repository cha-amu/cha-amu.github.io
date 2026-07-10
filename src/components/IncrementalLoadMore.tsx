import { useEffect, useRef } from 'react';

type IncrementalLoadMoreProps = {
  hasMore: boolean;
  label: string;
  onLoadMore: () => void;
};

export function IncrementalLoadMore({ hasMore, label, onLoadMore }: IncrementalLoadMoreProps) {
  const markerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const marker = markerRef.current;
    if (!marker) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { rootMargin: '360px 0px' });

    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (!hasMore) return null;

  return (
    <div className="incremental-loader" ref={markerRef}>
      <button className="incremental-loader__button" type="button" onClick={onLoadMore}>
        {label}
      </button>
    </div>
  );
}
