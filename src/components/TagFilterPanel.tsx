export interface TagOption {
  name: string;
  count: number;
}

export function countTagOptions(items: Array<{ tags: string[] }>): TagOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko-KR'));
}

interface TagFilterPanelProps {
  label: string;
  totalCount: number;
  visibleCount: number;
  tags: TagOption[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
}

export function TagFilterPanel({ label, totalCount, visibleCount, tags, selectedTags, onToggleTag, onClearTags }: TagFilterPanelProps) {
  const selectedTagSet = new Set(selectedTags);

  return (
    <aside className="tag-panel" aria-label={`${label} 태그 필터`}>
      <div className="tag-panel__head">
        <h2>태그</h2>
        <span>{visibleCount}/{totalCount}</span>
      </div>
      <div className="tag-filter-list">
        <button
          className={`tag-filter ${selectedTags.length === 0 ? 'tag-filter--selected' : ''}`}
          type="button"
          onClick={onClearTags}
          aria-pressed={selectedTags.length === 0}
        >
          <span>전체</span>
          <span>{totalCount}</span>
        </button>
        {tags.map((tag) => {
          const selected = selectedTagSet.has(tag.name);
          return (
            <button
              className={`tag-filter ${selected ? 'tag-filter--selected' : ''}`}
              type="button"
              key={tag.name}
              onClick={() => onToggleTag(tag.name)}
              aria-pressed={selected}
            >
              <span>{tag.name}</span>
              <span>{tag.count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
