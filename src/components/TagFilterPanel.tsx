import { useMemo, useState } from 'react';
import { useI18n } from '../i18n';

export interface TagOption {
  name: string;
  count: number;
}

export function countTagOptions(items: Array<{ tags: string[] }>, locale = 'ko-KR'): TagOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, locale));
}

interface TagFilterPanelProps {
  label: string;
  tags: TagOption[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
}

const COLLAPSED_TAG_LIMIT = 12;

export function TagFilterPanel({
  label,
  tags,
  selectedTags,
  onToggleTag,
  onClearTags
}: TagFilterPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const visibleTags = useMemo(() => {
    if (expanded || tags.length <= COLLAPSED_TAG_LIMIT) return tags;
    return tags.filter((tag, index) => index < COLLAPSED_TAG_LIMIT || selectedTagSet.has(tag.name));
  }, [expanded, selectedTagSet, tags]);
  const hiddenCount = tags.length - visibleTags.length;

  return (
    <aside className="tag-panel" aria-label={t('tags.filter', { label })}>
      <div className="tag-panel__head">
        <h2>{t('tags.label')}</h2>
        <span>{t('common.count', { count: tags.length })}</span>
      </div>
      <div className="tag-filter-list">
        <button
          className={`tag-filter ${selectedTags.length === 0 ? 'tag-filter--selected' : ''}`}
          type="button"
          onClick={onClearTags}
          aria-pressed={selectedTags.length === 0}
        >
          <span>{t('common.all')}</span>
        </button>
        {visibleTags.map((tag) => {
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
        {expanded || hiddenCount > 0 ? (
          <button
            className="tag-filter tag-filter--more"
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
          >
            <span>{expanded ? t('tags.collapse') : t('tags.more', { count: hiddenCount })}</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
