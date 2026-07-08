import { renderMarkdown } from '../utils/markdown';

export function MarkdownView({ markdown }: { markdown?: string | null }) {
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown || '') }} />;
}
