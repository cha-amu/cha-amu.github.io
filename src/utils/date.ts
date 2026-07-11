import { getLanguageLocale } from '../i18n';

export function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getLanguageLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
