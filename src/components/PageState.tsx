import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div className="state-box" role="status">{label || t('common.loading')}</div>;
}

export function EmptyState({ label, action }: { label: string; action?: ReactNode }) {
  if (!action) return <div className="state-box">{label}</div>;
  return (
    <div className="state-box state-box--action">
      <p>{label}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state-box status-message--danger" role="alert">
      <p>{message}</p>
      {onRetry ? <button className="button button--danger" type="button" onClick={onRetry}>{t('common.retry')}</button> : null}
    </div>
  );
}
