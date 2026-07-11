import { getLanguageLocale } from '../i18n';

export function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase(getLanguageLocale());
}

export function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function uniqueTags(items: Array<{ tags: string[] }>): string[] {
  return Array.from(new Set(items.flatMap((item) => item.tags))).sort((a, b) => a.localeCompare(b, getLanguageLocale()));
}

export function excerpt(value: unknown, maxLength = 120): string {
  const compact = String(value || '').replace(/[#>*_`\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength).trim()}…`;
}
