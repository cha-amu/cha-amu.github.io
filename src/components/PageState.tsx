export function LoadingState({ label = '불러오는 중입니다.' }: { label?: string }) {
  return <div className="state-box" role="status">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="state-box">{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-box status-message--danger" role="alert">
      <p>{message}</p>
      {onRetry ? <button className="button button--danger" type="button" onClick={onRetry}>재시도</button> : null}
    </div>
  );
}
