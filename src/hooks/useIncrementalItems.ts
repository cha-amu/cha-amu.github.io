import { useCallback, useEffect, useMemo, useState } from 'react';

export function useIncrementalItems<T>(items: T[], batchSize: number) {
  const [visibleCount, setVisibleCount] = useState(batchSize);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [items, batchSize]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const shownCount = visibleItems.length;
  const hasMore = shownCount < items.length;

  const loadMore = useCallback(() => {
    setVisibleCount((current) => Math.min(current + batchSize, items.length));
  }, [batchSize, items.length]);

  const ensureVisible = useCallback((index: number) => {
    if (index < 0) return;
    setVisibleCount((current) => {
      const needed = Math.ceil((index + 1) / batchSize) * batchSize;
      return Math.max(current, Math.min(needed, items.length));
    });
  }, [batchSize, items.length]);

  return {
    visibleItems,
    shownCount,
    totalCount: items.length,
    hasMore,
    loadMore,
    ensureVisible
  };
}
