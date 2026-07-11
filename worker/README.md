# Cha-amu security gateway

Cloudflare Worker entry point for browser writes, administrator authentication, and guestbook IP blocking. Raw client IP addresses are never stored or sent to Apps Script. D1 stores only an HMAC digest keyed by `IP_HASH_SECRET`.

## First deployment

1. Install Wrangler in this directory with `npm install`.
2. Authenticate with `npx wrangler login`.
3. The checked-in `wrangler.jsonc` is bound to the production `cha-amu-security` D1 database. Create a different database and replace `database_id` only for another Cloudflare account or environment.
4. Run `npm run migrate:remote`.
5. Set the Worker secrets with `npx wrangler secret put NAME` for:
   - `APPS_SCRIPT_URL`
   - `GATEWAY_SHARED_SECRET`
   - `IP_HASH_SECRET`
   - `TURNSTILE_SECRET_KEY`
   - `STORAGE_SYNC_SECRET`
6. Run `npm run deploy`.

`GATEWAY_SHARED_SECRET` must also be stored in Apps Script as a Script Property. `STORAGE_SYNC_SECRET` is only for the noninteractive storage synchronizer. Its `Authorization: Bearer ...` header bypasses Turnstile for `admin.login`; it is never forwarded upstream.

The D1 database ID is a public resource identifier, not a secret. Never commit `.dev.vars` or secret values. Keep `IP_HASH_SECRET` stable: rotating it makes existing mappings and bans unresolvable.

## API contract

- `GET /health`: non-sensitive liveness response.
- `POST /api`: JSON or `text/plain` JSON action envelope.
- Browser CORS is restricted to the exact `ALLOWED_ORIGIN` value.
- `guestbook.create` requires a Turnstile token with action `guestbook_create`.
- Interactive `admin.login` requires a Turnstile token with action `admin_login`.
- `admin.guestbook.ip.ban` and `admin.guestbook.ip.unban` accept `{ token, entryId, reason? }` and create or revoke an indefinite manual ban. The older `id` field is accepted as a compatibility alias.
- `admin.guestbook.list` adds `ipBanAvailable`, `ipBlocked`, and `relatedEntryCount` to every entry.

Existing guestbook entries predate the D1 mapping and therefore report `ipBanAvailable: false`.

Guestbook creation writes a `pending` HMAC mapping before Apps Script. A clear Apps Script rejection removes it. A network-ambiguous response leaves it pending. If Apps Script commits successfully but D1 activation fails, the gateway still returns the successful Apps Script response so a browser retry cannot create a duplicate; the next authenticated `admin.guestbook.list` reconciles pending IDs that are present upstream.
