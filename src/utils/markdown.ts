import katex from 'katex';

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

const INLINE_TOKEN_OPEN = '\uE000';
const INLINE_TOKEN_CLOSE = '\uE001';

function renderMath(expression: string, displayMode: boolean): string {
  const rendered = katex.renderToString(expression.trim(), {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml'
  });
  const mode = displayMode ? 'block' : 'inline';
  const tag = displayMode ? 'div' : 'span';
  return `<${tag} class="markdown-math markdown-math--${mode}">${rendered}</${tag}>`;
}

function inlineMarkdown(value: string, options: MarkdownOptions): string {
  const protectedTokens: string[] = [];
  const protect = (html: string): string => {
    const token = `${INLINE_TOKEN_OPEN}${protectedTokens.length}${INLINE_TOKEN_CLOSE}`;
    protectedTokens.push(html);
    return token;
  };

  let source = value.replace(/`([^`]+)`/g, (_match, code: string) =>
    protect(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/\\\$/g, () => protect('$'));
  source = source.replace(/\\\((.+?)\\\)/g, (_match, expression: string) =>
    protect(renderMath(expression, false)));
  source = source.replace(/\$(?!\s)([^$\n]*?\S)\$/g, (_match, expression: string) =>
    protect(renderMath(expression, false)));

  let output = escapeHtml(source);
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
  output = output.replace(
    new RegExp(`${INLINE_TOKEN_OPEN}(\\d+)${INLINE_TOKEN_CLOSE}`, 'g'),
    (_match, index: string) => protectedTokens[Number(index)] ?? ''
  );
  return output;
}

type ListTag = 'ul' | 'ol';
type TableAlignment = 'left' | 'center' | 'right' | null;

function splitTableRow(value: string): string[] {
  const row = value.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  let inlineCode = false;

  for (const character of row) {
    if (escaped) {
      cell += character === '|' ? '|' : `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '`') inlineCode = !inlineCode;
    if (character === '|' && !inlineCode) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }

  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(value: string): TableAlignment[] | null {
  if (!value.includes('|')) return null;
  const cells = splitTableRow(value);
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))) return null;
  return cells.map((cell) => {
    const marker = cell.replace(/\s/g, '');
    if (marker.startsWith(':') && marker.endsWith(':')) return 'center';
    if (marker.endsWith(':')) return 'right';
    if (marker.startsWith(':')) return 'left';
    return null;
  });
}

function tableCell(tag: 'th' | 'td', value: string, alignment: TableAlignment, options: MarkdownOptions): string {
  const alignmentClass = alignment ? ` class="markdown-align-${alignment}"` : '';
  return `<${tag}${alignmentClass}>${inlineMarkdown(value, options)}</${tag}>`;
}

function normalizedTableRow(value: string, columnCount: number): string[] {
  const cells = splitTableRow(value).slice(0, columnCount);
  while (cells.length < columnCount) cells.push('');
  return cells;
}

export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listTag: ListTag | null = null;

  const closeList = () => {
    if (!listTag) return;
    html.push(`</${listTag}>`);
    listTag = null;
  };

  const openList = (nextTag: ListTag) => {
    if (listTag === nextTag) return;
    closeList();
    html.push(`<${nextTag}>`);
    listTag = nextTag;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(line);
    if (fence) {
      closeList();
      const marker = fence[1][0];
      const closingFence = new RegExp(`^\\s{0,3}${marker}{${fence[1].length},}\\s*$`);
      const language = fence[2].replace(/[^A-Za-z0-9_-]/g, '');
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !closingFence.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      const languageClass = language ? ` class="language-${language}"` : '';
      html.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const singleLineBlockMath = /^\s*(?:\$\$(.+)\$\$|\\\[(.+)\\\])\s*$/.exec(line);
    if (singleLineBlockMath) {
      closeList();
      html.push(renderMath(singleLineBlockMath[1] ?? singleLineBlockMath[2], true));
      continue;
    }

    const blockMathDelimiter = line.trim() === '$$'
      ? '$$'
      : line.trim() === '\\['
        ? '\\]'
        : null;
    if (blockMathDelimiter) {
      const expression: string[] = [];
      let closingIndex = index + 1;
      while (
        closingIndex < lines.length &&
        lines[closingIndex].trim() !== blockMathDelimiter
      ) {
        expression.push(lines[closingIndex]);
        closingIndex += 1;
      }
      if (closingIndex < lines.length && expression.some((part) => part.trim())) {
        closeList();
        html.push(renderMath(expression.join('\n'), true));
        index = closingIndex;
        continue;
      }
    }

    const alignments = index + 1 < lines.length ? tableAlignments(lines[index + 1]) : null;
    if (alignments) {
      const headers = splitTableRow(line);
      if (headers.length === alignments.length) {
        closeList();
        const bodyRows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          bodyRows.push(normalizedTableRow(lines[index], headers.length));
          index += 1;
        }
        index -= 1;
        html.push('<div class="markdown-table-wrap"><table>');
        html.push(`<thead><tr>${headers.map((cell, cellIndex) => tableCell('th', cell, alignments[cellIndex], options)).join('')}</tr></thead>`);
        if (bodyRows.length) {
          html.push(`<tbody>${bodyRows.map((row) => `<tr>${row.map((cell, cellIndex) => tableCell('td', cell, alignments[cellIndex], options)).join('')}</tr>`).join('')}</tbody>`);
        }
        html.push('</table></div>');
        continue;
      }
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2], options)}</h${level}>`);
      continue;
    }

    const unorderedList = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unorderedList) {
      openList('ul');
      html.push(`<li>${inlineMarkdown(unorderedList[1], options)}</li>`);
      continue;
    }

    const orderedList = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (orderedList) {
      openList('ol');
      html.push(`<li>${inlineMarkdown(orderedList[1], options)}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line, options)}</p>`);
  }

  closeList();
  return html.join('\n');
}
