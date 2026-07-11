import { useI18n } from '../i18n';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div className="state-box" role="status">{label || t('common.loading')}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="state-box">{label}</div>;
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
