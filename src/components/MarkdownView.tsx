import 'katex/dist/katex.min.css';
import type { MouseEvent } from 'react';
import { renderMarkdown } from '../utils/markdown';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function activateYoutubeVideo(event: MouseEvent<HTMLDivElement>) {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('.markdown-video__trigger[data-youtube-id]')
    : null;
  if (!target || !event.currentTarget.contains(target)) return;

  const videoId = target.dataset.youtubeId || '';
  if (!YOUTUBE_ID.test(videoId)) return;

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`;
  iframe.title = target.dataset.youtubeTitle || 'YouTube video';
  iframe.loading = 'eager';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  target.replaceWith(iframe);
}

export function MarkdownView({
  markdown,
  baseUrl,
  rootUrl
}: {
  markdown?: string | null;
  baseUrl?: string;
  rootUrl?: string;
}) {
  const html = renderMarkdown(markdown || '', { baseUrl, rootUrl });
  const hasYoutubeVideo = html.includes('class="markdown-video__trigger"');

  return (
    <div
      className="markdown-body"
      onClick={hasYoutubeVideo ? activateYoutubeVideo : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
