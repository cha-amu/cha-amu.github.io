import { useEffect, useRef, useState } from 'react';
import { config, isTurnstileConfigured } from '../config';
import { useI18n } from '../i18n';

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
const TURNSTILE_SCRIPT_SELECTOR = 'script[data-cha-amu-turnstile]';
const TURNSTILE_LOAD_TIMEOUT_MS = 12_000;

function discardUninitializedTurnstileScript(): void {
  if (window.turnstile) return;
  document.querySelectorAll(TURNSTILE_SCRIPT_SELECTOR).forEach((script) => script.remove());
  turnstileScriptPromise = null;
}

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(TURNSTILE_SCRIPT_SELECTOR);
    const script = existing ?? document.createElement('script');
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', finish);
      script.removeEventListener('error', fail);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.dataset.chaAmuTurnstileState = 'loaded';
      if (window.turnstile) resolve(window.turnstile);
      else {
        script.remove();
        reject(new Error('Turnstile API was not initialized.'));
      }
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.dataset.chaAmuTurnstileState = 'failed';
      script.remove();
      reject(new Error('Turnstile script failed to load.'));
    };
    const timeoutId = window.setTimeout(fail, TURNSTILE_LOAD_TIMEOUT_MS);

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });

    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.chaAmuTurnstile = 'true';
      script.dataset.chaAmuTurnstileState = 'loading';
      document.head.append(script);
    }
  }).catch((error) => {
    discardUninitializedTurnstileScript();
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
  const { language, t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const [error, setError] = useState('');
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    onTokenChangeRef.current('');
    if (!isTurnstileConfigured) return undefined;
    let cancelled = false;
    setError('');

    void loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: config.turnstileSiteKey,
          action,
          language,
          size: 'flexible',
          callback: (token: string) => {
            setError('');
            onTokenChangeRef.current(token);
          },
          'expired-callback': () => onTokenChangeRef.current(''),
          'timeout-callback': () => onTokenChangeRef.current(''),
          'error-callback': () => {
            onTokenChangeRef.current('');
            setError(t('turnstile.loadFailed'));
          },
          'response-field': false
        });
      })
      .catch(() => {
        if (!cancelled) setError(t('turnstile.loadFailed'));
      });

    return () => {
      cancelled = true;
      onTokenChangeRef.current('');
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, language, retryAttempt, t]);

  useEffect(() => {
    setError('');
    onTokenChangeRef.current('');
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
  }, [resetKey]);

  if (!isTurnstileConfigured) {
    return (
      <div className="status-message">
        {t('turnstile.missingKey')}
      </div>
    );
  }

  const retry = () => {
    setError('');
    onTokenChangeRef.current('');
    discardUninitializedTurnstileScript();
    setRetryAttempt((attempt) => attempt + 1);
  };

  return (
    <div className="turnstile-box">
      <div ref={containerRef} aria-label={t('turnstile.label')} />
      {error ? (
        <div className="turnstile-box__error">
          <p className="status-message status-message--danger" role="status">{error}</p>
          <button className="button button--ghost" type="button" onClick={retry}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
