import { getLanguageLocale } from '../i18n';

export function formatDate(value?: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat(getLanguageLocale(), { dateStyle: 'medium' }).format(date);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getLanguageLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
