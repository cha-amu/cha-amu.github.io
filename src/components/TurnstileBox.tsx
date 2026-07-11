import { useEffect, useRef, useState } from 'react';
import { config, isTurnstileConfigured } from '../config';

type TurnstileAction = 'guestbook_create' | 'admin_login';

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const finish = () => window.turnstile
      ? resolve(window.turnstile)
      : reject(new Error('Turnstile API was not initialized.'));
    const fail = () => reject(new Error('Turnstile script failed to load.'));
    const existing = document.querySelector<HTMLScriptElement>('script[data-cha-amu-turnstile]');

    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', fail, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.chaAmuTurnstile = 'true';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.append(script);
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });

  turnstileScriptPromise = promise;
  return promise;
}

export function TurnstileBox({
  action,
  onTokenChange,
  resetKey = 0
}: {
  action: TurnstileAction;
  onTokenChange: (token: string) => void;
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const [error, setError] = useState('');

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    if (!isTurnstileConfigured) return undefined;
    let cancelled = false;

    void loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: config.turnstileSiteKey,
          action,
          size: 'flexible',
          callback: (token: string) => {
            setError('');
            onTokenChangeRef.current(token);
          },
          'expired-callback': () => onTokenChangeRef.current(''),
          'timeout-callback': () => onTokenChangeRef.current(''),
          'error-callback': () => {
            onTokenChangeRef.current('');
            setError('보안 확인을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
          },
          'response-field': false
        });
      })
      .catch(() => {
        if (!cancelled) setError('보안 확인을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
      });

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action]);

  useEffect(() => {
    setError('');
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
  }, [resetKey]);

  if (!isTurnstileConfigured) {
    return (
      <div className="status-message">
        Turnstile site key가 아직 설정되지 않았습니다. 배포 전 `VITE_TURNSTILE_SITE_KEY`를 설정해야 합니다.
      </div>
    );
  }

  return (
    <div className="turnstile-box">
      <div ref={containerRef} aria-label="Cloudflare Turnstile" />
      {error ? <p className="status-message status-message--danger" role="status">{error}</p> : null}
    </div>
  );
}
