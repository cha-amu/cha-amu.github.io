# Cha-amu security gateway

Cloudflare Worker entry point for browser writes, administrator authentication, and guestbook IP blocking. Raw client IP addresses are never stored or sent to Apps Script. D1 stores only an HMAC digest keyed by `IP_HASH_SECRET`.

The blog reads its four public lists (`post.listPublic`, `guestbook.listPublic`, `assetOverride.listPublic`, `thing.listPublic`) from the Apps Script web app directly and uses this gateway for them only when that fails. The gateway still accepts them, for example for the amuknowl publication catalog.

## Apps Script responses

Apps Script answers every web app POST with a redirect to a one-time echo URL on `script.googleusercontent.com`. The first GET there returns the result; later GETs redirect back to `/exec`. From Cloudflare's Tokyo and Hong Kong egress this echo request is often slow or answered with 404, while the same calls from a browser succeed. The gateway therefore follows the redirect by hand:

- It reads the echo exactly once and never follows a redirect back to `/exec`, which would run `doGet` and return its health payload in place of the result.
- Read-only actions whose result is lost run again, up to three attempts within 30 seconds, with 15-second and 8-second limits for the two requests.
- Writes never run twice, because Apps Script may already have committed them. A lost write result is reported as such.

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

`GATEWAY_SHARED_SECRET` must also be stored in Apps Script as a Script Property. `STORAGE_SYNC_SECRET` is only for the noninteractive storage synchronizer. It authorizes the seven `storage.sync.*` actions directly, is checked on every request, and is never forwarded upstream. It cannot create an administrator session or bypass interactive login verification.

The D1 database ID is a public resource identifier, not a secret. Never commit `.dev.vars` or secret values. Keep `IP_HASH_SECRET` stable: rotating it makes existing mappings and bans unresolvable.

## API contract

- `GET /health`: non-sensitive liveness response.
- `POST /api`: JSON or `text/plain` JSON action envelope.
- Browser CORS is restricted to the exact `ALLOWED_ORIGIN` value.
- `guestbook.create` requires a Turnstile token with action `guestbook_create`.
- Interactive `admin.login` requires a Turnstile token with action `admin_login`.
- Storage synchronization requires `Authorization: Bearer <STORAGE_SYNC_SECRET>` and is limited to the explicit `storage.sync.*` allowlist. These requests never carry an administrator password or session token.
- `admin.guestbook.ip.ban` and `admin.guestbook.ip.unban` accept `{ token, entryId, reason? }` and create or revoke an indefinite manual ban. The older `id` field is accepted as a compatibility alias.
- `admin.guestbook.list` adds `ipBanAvailable`, `ipBlocked`, and `relatedEntryCount` to every entry.

Existing guestbook entries predate the D1 mapping and therefore report `ipBanAvailable: false`.

Guestbook creation writes a `pending` HMAC mapping before Apps Script. A clear Apps Script rejection removes it. A network-ambiguous response leaves it pending. If Apps Script commits successfully but D1 activation fails, the gateway still returns the successful Apps Script response so a browser retry cannot create a duplicate; the next authenticated `admin.guestbook.list` reconciles pending IDs that are present upstream.
