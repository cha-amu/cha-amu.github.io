export function TagList({ tags }: { tags?: string[] | null }) {
  const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!safeTags.length) return null;
  return (
    <div className="tag-row" aria-label="태그">
      {safeTags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
    </div>
  );
}
