import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { ArrowUpIcon } from './ToolIcons';

export function BackToTopButton() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 520);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  if (!visible) return null;

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <button
      className="back-to-top"
      type="button"
      onClick={scrollToTop}
      aria-label={t('common.backToTop')}
    >
      <ArrowUpIcon />
    </button>
  );
}
