function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface MarkdownOptions {
  baseUrl?: string;
  rootUrl?: string;
}

function resolveMarkdownUrl(value: string, options: MarkdownOptions): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  try {
    if (trimmed.startsWith('/') && options.rootUrl) {
      return new URL(trimmed.replace(/^\/+/, ''), `${options.rootUrl.replace(/\/$/, '')}/`).href;
    }
    if (options.baseUrl) return new URL(trimmed, options.baseUrl).href;
  } catch (_) {
    return trimmed;
  }
  return trimmed;
}

function inlineMarkdown(value: string, options: MarkdownOptions): string {
  let output = escapeHtml(value);
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, url: string) => {
    const resolved = escapeHtml(resolveMarkdownUrl(url, options));
    return `<img src="${resolved}" alt="${alt}" loading="lazy" />`;
  });
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const resolved = escapeHtml(resolveMarkdownUrl(url, options));
    return `<a href="${resolved}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  return output;
}

export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listOpen = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      if (listOpen) {
        html.push('</ul>');
        listOpen = false;
      }
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      if (listOpen) {
        html.push('</ul>');
        listOpen = false;
      }
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2], options)}</h${level}>`);
      continue;
    }

    const list = /^[-*]\s+(.+)$/.exec(line);
    if (list) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(list[1], options)}</li>`);
      continue;
    }

    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
    html.push(`<p>${inlineMarkdown(line, options)}</p>`);
  }

  if (listOpen) html.push('</ul>');
  return html.join('\n');
}
