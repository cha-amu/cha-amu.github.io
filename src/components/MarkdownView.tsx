import 'katex/dist/katex.min.css';
import { renderMarkdown } from '../utils/markdown';

export function MarkdownView({
  markdown,
  baseUrl,
  rootUrl
}: {
  markdown?: string | null;
  baseUrl?: string;
  rootUrl?: string;
}) {
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown || '', { baseUrl, rootUrl }) }} />;
}
