import { config, isTurnstileConfigured } from '../config';

export function TurnstileBox() {
  if (!isTurnstileConfigured) {
    return (
      <div className="status-message">
        Turnstile site key가 아직 설정되지 않았습니다. 배포 전 `VITE_TURNSTILE_SITE_KEY`를 설정해야 합니다.
      </div>
    );
  }

  return <div className="cf-turnstile" data-sitekey={config.turnstileSiteKey} aria-label="Cloudflare Turnstile" />;
}
