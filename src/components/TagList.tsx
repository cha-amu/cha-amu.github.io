import { useI18n } from '../i18n';

export function TagList({ tags }: { tags?: string[] | null }) {
  const { t } = useI18n();
  const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!safeTags.length) return null;
  return (
    <div className="tag-row" aria-label={t('tags.label')}>
      {safeTags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
    </div>
  );
}
