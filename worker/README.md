# Cha-amu Worker and D1 backend

`POST /api` serves all content directly from the **existing** `SECURITY_DB` binding (`cha-amu-security`, database ID `250bb811-d3fc-4ac8-b502-0d8b4d36ef1c`). No additional database is needed. The only outbound request is Turnstile verification. There is no Apps Script relay, echo redirect, fallback backend, or public-list cache.

The frontend, storage repository synchronizer and amuknowl catalog keep the same action names and response envelopes. JSON and `text/plain` JSON are accepted, with the existing 64 KiB request limit. Business validation, password and session errors retain HTTP **200** with `{ "ok": false, "error": "..." }`, as Apps Script returned them. Gateway errors retain their 400/401/403/404/413/415/429/503 statuses. Successful calls return `{ "ok": true, "data": ... }`. D1 infrastructure failures use the gateway's generic Korean 503 response; upstream transport/echo 502 failures no longer exist. `GET /` and `/health` remain non-sensitive liveness endpoints.

## Storage and modules

- `src/index.js`: routing, request allowlists, CORS, Turnstile, Cloudflare rate-limit bindings, storage bearer authentication, IP HMACs, IP bans and admin guestbook enrichment.
- `src/content-api.js`: content projections, validation, writes, tombstones, bulk operations and best-effort audit events.
- `src/content-auth.js`: copied-secret authentication, session creation/verification, SHA-256 and legacy PBKDF2 guestbook hashes.
- `src/content-rate-limits.js`: the eight original Apps Script windows, implemented with atomic D1 counters.
- `src/content-schema.js`: header names, empty-cell defaults, JSON list cells and import/read serialization.
- `scripts/import-sheets-export.mjs`: offline JSON-to-SQL snapshot converter; never contacts Google or Cloudflare.

Migration `0001_security.sql` remains unchanged. `0002_content.sql` adds:

| Table | Key and notable columns |
| --- | --- |
| `posts` | `id`; all Sheets post fields, including `markdownBaseUrl` and `markdownRootUrl`; JSON-encoded `tags` |
| `post_deletions` | `id`, `storagePath`, `nonce`, `deletedAt`, `finalizedAt` |
| `guestbook_entries` | `id`, content/status/time, salt/hash/algorithm/iteration count, hidden reason |
| `things` | `id`, title/description, URL and image URL, status, numeric sort order, updated time |
| `asset_overrides` | `assetId`, display metadata, JSON-encoded tags, status, numeric sort order, updated time |
| `audit_log` | `id`, action, target type/id, created time |
| `rate_limit_windows` | `key`, atomic integer count, expiry in epoch milliseconds |

Text timestamps retain the exported ISO strings (or legacy empty/date-only values); no timezone conversion is applied. Missing cells default to `''`. Tags preserve arrays, legacy strings and empty cells distinctly as JSON text. Post/asset/thing extension columns are retained in an internal JSON `extra` column and projected back at the top level, without exposing the storage column. Reads preserve insertion order via SQLite rowid, except the existing public thing sort by order, title and id. Indexes cover public statuses, pending deletions, audit times/targets and counter expiry. The unused Sheets `settings` tab is omitted.

Guestbook creation writes the entry and its **active** IP mapping in one `db.batch()`. Bulk deletion removes requested entries and their mappings in one batch; existing bans and ban events survive. Existing `pending` mappings remain readable when their entry exists. Orphans are excluded from enrichment, related counts and ban targets; listing no longer needs reconciliation writes. Imported entries without a mapping report `ipBanAvailable: false`.

Post deletion creates/repairs tombstones and deletes posts in one batch. Missing post IDs also receive tombstones. Retries preserve the nonce and deletion time. Finalize checks the complete request before changing anything; a wrong pending nonce prevents every update. Finalized tombstones **remain permanently**, continue suppressing public content and prevent both editor and storage saves from reviving their IDs. Guarded SQL upserts prevent a save/delete race from reviving a post.

Bulk operations pass IDs as one JSON parameter, avoiding D1's 100-bound-parameter ceiling. Audit events retain the original names and target types and are best effort after successful mutation. D1 batches provide transactional rollback on statement failure; see [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Action mapping

`token` means an admin session token. `bearer` means `Authorization: Bearer <STORAGE_SYNC_SECRET>`, independently of browser origin. This bearer never bypasses interactive admin login or authorizes other namespaces.

| Action | Authentication and D1 behavior / result |
| --- | --- |
| `post.listPublic` | Public. Published rows retain all fields. Other statuses expose only `id/status/updatedAt`. Tombstones override posts and expose `status: deleted`; no nonce/path leaks. |
| `guestbook.listPublic` | Public. Visible entries only; `id/name/message/status/createdAt`; blank names become `ㅇㅁ`. |
| `assetOverride.listPublic` | Public. All overrides, including hidden/deleted metadata, as before. |
| `thing.listPublic` | Public. Visible rows with id/title/description/url/imageUrl/status/sortOrder/updatedAt, sorted by order/title/id. |
| `guestbook.create` | Turnstile `guestbook_create`, IP ban and both Cloudflare/D1 limits. Gateway-generated UUID; atomic entry + IP mapping; returns public entry. |
| `guestbook.hideByPassword` | Cloudflare/D1 limits, stored salt/hash/algorithm/iterations. Sets hidden, retains reason/hash/mapping; returns `{ id }`. |
| `admin.login` | Turnstile `admin_login`, Cloudflare/D1 limits, copied admin password hash + pepper. Returns `{ token, expiresAt }`. |
| `admin.session.verify` | Token. Returns `{ valid: true }`. Now routed explicitly, matching the existing Apps Script action. |
| `admin.session.refresh` | Valid unexpired token. New token/nonce and expiry. |
| `admin.post.list` | Token. All complete post rows in insertion order. |
| `admin.post.save` | Token. Generates id when omitted, normalizes tags/dates, replaces row cells; tombstoned ids rejected. Returns saved object. |
| `admin.post.bulkStatus` | Token. Patches status/updatedAt and missing publishedAt only; `{ updatedIds, missingIds }`. |
| `admin.post.bulkDelete` | Token. Atomic tombstone + removal; `{ deletedIds, alreadyMissingIds }`. |
| `admin.guestbook.list` | Token. No password material; adds `hiddenReason`, `ipBanAvailable`, `ipBlocked`, `relatedEntryCount`. |
| `admin.guestbook.hide` | Token. Sets hidden/reason; `{ id }`. |
| `admin.guestbook.restore` | Token. Sets visible and clears reason; `{ id }`. |
| `admin.guestbook.bulkStatus` | Token. Patches status/reason, preserves credentials/content/mappings; `{ updatedIds, missingIds }`. |
| `admin.guestbook.bulkDelete` | Token. Atomic entry/mapping deletion; `{ deletedIds, alreadyMissingIds }`. |
| `admin.guestbook.ip.ban` | Token. Existing indefinite IP ban/event logic; `{ entryId, ipBlocked, relatedEntryCount }`. `id` remains an alias. |
| `admin.guestbook.ip.unban` | Token. Revokes by entry mapping or stored source entry after deletion; same response fields. |
| `admin.guestbook.ip.bans.list` | Token. `{ bans }` with sourceEntryId/reason/bannedAt/relatedEntryIds/relatedEntryCount, never raw IPs/hashes. |
| `admin.assetOverride.list` | Token. All overrides. |
| `admin.assetOverride.save` | Token. Requires assetId, replaces cells, updates timestamp; saved object. |
| `admin.assetOverride.bulkStatus` | Token. Patches existing metadata or creates minimal overrides; `{ updatedIds, missingIds: [] }`. |
| `admin.assetOverride.delete` | Token. Reset/removal, idempotent; `{ deletedIds, alreadyMissingIds }`. |
| `admin.thing.list` | Token. All thing rows, including hidden rows. |
| `admin.thing.save` | Token. Existing field/URL validation and canonicalization, replace/create; saved object. |
| `admin.thing.delete` | Token. Idempotent removal; `{ deletedIds, alreadyMissingIds }`. |
| `storage.sync.post.list` | Bearer. Same complete rows as admin list. |
| `storage.sync.post.save` | Bearer. Existing storage field validation; retains supplied dates/fallbacks, sets source=storage and syncStatus=synced; rejects every tombstoned id. |
| `storage.sync.postDeletion.list` | Bearer. Unfinalized tombstones with id/storagePath/nonce/deletedAt. |
| `storage.sync.postDeletion.finalize` | Bearer. Id+nonce pairs, all-or-nothing validation; `{ finalizedIds, alreadyMissingIds }`. |
| `storage.sync.assetOverride.list` | Bearer. All overrides. |
| `storage.sync.assetOverride.save` | Bearer. Existing storage field validation, same replace/update semantics as admin save. |
| `storage.sync.assetOverride.delete` | Bearer. Same idempotent reset/removal as admin. |

Existing bulk gateway behavior remains: trim and deduplicate IDs, maximum 100 **unique** IDs, reject unknown fields, validate statuses and hidden reasons. The original Sheets control-character validation still runs after gateway normalization. Gateway-only fields, client-selected entry IDs and shared secrets are never trusted as content inputs.

## Secrets and vars

Copy these values **unchanged** from Apps Script Script Properties into Worker secrets:

| Secret | Semantics |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | Existing lowercase hex SHA-256 of UTF-8 `password + ADMIN_PASSWORD_PEPPER`; the Worker does not need an `ADMIN_PASSWORD` secret. |
| `ADMIN_PASSWORD_PEPPER` | Same pepper used to produce the stored admin hash. |
| `ADMIN_SESSION_SECRET` | HMAC-SHA256 session signing secret. |
| `GUESTBOOK_SERVER_PEPPER` | Same pepper for existing guestbook hashes and per-client rate scopes. |

Preserve the already configured `IP_HASH_SECRET`, `TURNSTILE_SECRET_KEY` and `STORAGE_SYNC_SECRET`. In particular, keep `IP_HASH_SECRET` stable so existing mappings and bans continue working. All content secrets must contain at least 32 characters, matching Apps Script.

Non-secret vars in `wrangler.jsonc`:

- `ALLOWED_ORIGIN=https://cha-amu.github.io`
- `TURNSTILE_EXPECTED_HOSTNAME=cha-amu.github.io`
- `ADMIN_SESSION_TTL_MS=600000` (10 minutes; copy a different existing property value if configured)
- `GUESTBOOK_PASSWORD_ITERATIONS=1` (fallback for legacy PBKDF2 entries missing their per-entry iteration cell)

New guestbook entries retain `SHA-256+salt+pepper` with one iteration, irrespective of the fallback setting. Verification selects PBKDF2 when the stored algorithm begins `PBKDF2-HMAC-SHA256`; otherwise it uses SHA-256 of `salt:password:pepper`. PBKDF2 uses UTF-8 `password + pepper` as the HMAC key and UTF-8 salt with block index `[0,0,0,1]`, XORing U1 through Un. WebCrypto `deriveBits(..., 256)` reproduces that construction. The reported production snapshot contains 36 SHA-256 entries and four PBKDF2 entries at 50,000 iterations; both paths are covered, including Korean/emoji and signed Apps Script byte arrays.

`APPS_SCRIPT_URL` and `GATEWAY_SHARED_SECRET` are unused by this version. Keep old secret values available through the rollback window if the previous deployed Worker needs them; they can be removed afterward. Re-login at cutover rather than relying on old session tokens.

## Migration and import cutover (owner-run commands)

This work does not execute deployment, secret changes or remote D1 commands. Coordinate a write freeze for the gateway and storage sync, obtain the final export, and keep writers paused through import verification and Worker/frontend cutover. Applying a snapshot replaces existing content; it is not a live merge. Export format:

```json
{
  "exportedAt": "2026-10-07T00:00:00.000Z",
  "sheets": {
    "posts": [], "postDeletions": [], "guestbook": [],
    "things": [], "assetOverrides": [], "auditLog": []
  }
}
```

Rows use the exact exported sheet header names and parsed cell values; dates are ISO strings. All six sheet arrays are required, and duplicate/missing IDs fail conversion before overwriting the output. Missing columns become empty cells. No export is fetched by the converter.

Generate SQL locally, outside tracked files:

```sh
node worker/scripts/import-sheets-export.mjs /absolute/path/export.json /absolute/path/content-import.sql
```

The converter prints per-table counts and writes a private SQL file containing password hashes. INSERTs combine multiple rows up to **64 KiB per statement**, measured in UTF-8 bytes, below D1's 100 KB ceiling. Quotes, Korean text, newlines and NUL are preserved. A single oversized row is assembled through a temporary-use `content_import_chunks` staging table and inserted whole, then that table is dropped. The generated SQL is safe to rerun: it replaces only the six content tables and never changes `guestbook_entry_ips`, `ip_bans`, `ip_ban_events` or rate windows. It ends with SELECT counts. Applying a remote file is not assumed to be one transaction; if interrupted, keep writers frozen and reapply the complete file.

Apply the existing migration sequence to the **same** database, then import:

```sh
cd worker
npx wrangler d1 migrations apply cha-amu-security --remote
npx wrangler d1 execute cha-amu-security --remote --file=/absolute/path/content-import.sql
```

Set the four copied content secrets interactively, supplying stored values rather than regenerating them:

```sh
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put ADMIN_PASSWORD_PEPPER
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put GUESTBOOK_SERVER_PEPPER
```

The other three existing Worker secrets remain in place. Confirm both non-secret auth vars match Script Properties before publishing. The owner then deploys this Worker and completes the frontend cutover:

```sh
npx wrangler deploy
```

Verify counts against the **final** export. The snapshot reported during implementation was posts=13, postDeletions=12, guestbook=40 (13 visible / 27 hidden), things=9, assetOverrides=179, auditLog=8307. The implementation never fetched this production export. The generated file prints all six DB counts; this additional query checks the guestbook distribution:

```sh
npx wrangler d1 execute cha-amu-security --remote --command="SELECT status, COUNT(*) AS count FROM guestbook_entries GROUP BY status; SELECT passwordHashAlgorithm, passwordHashIterations, COUNT(*) AS count FROM guestbook_entries GROUP BY passwordHashAlgorithm, passwordHashIterations;"
```

Before unfreezing writers, check public lists, admin login/list, password hides for an existing entry, IP bans and one storage sync run. Rollback uses `npx wrangler rollback <previous-version-id>`; there is no dual backend flag. Rollback changes Worker code, not D1 data, and D1-era writes are not mirrored back to Sheets. Retain the export and coordinate any rollback of writes with the owner.

## Tests and parity limits

From the repository root, `npm test` runs every existing test plus the new Worker suites; no root script changes are required. Worker-only command:

```sh
node --test tests/worker-gateway.test.mjs tests/worker-content.test.mjs tests/worker-import.test.mjs tests/worker-runtime.test.mjs
```

The tests use the installed **Miniflare v4 D1**, with both migrations applied to isolated local databases. No string-matching FakeD1 remains. The test-only helper fills in `String.prototype.toWellFormed` / `isWellFormed` on Node 20.18 for Miniflare's Undici dependency; Node 24 uses its native methods. Install the Worker dependencies once with npm ci in worker/. The runtime test runs the actual Worker module graph inside workerd with its WebCrypto and rate bindings. The import test uses Wrangler's SQL-file parser, reapplies the generated file, exercises 8,307 audit rows and an oversized Unicode body, and checks security tables byte-for-byte.

Gateway coverage retains CORS/Turnstile/rate/auth/IP-ban/validation contracts. Obsolete echo retry, upstream response validation and pending reconciliation cases are replaced by real SQL failure/rollback and legacy pending-read cases. Both unchanged Apps Script suites still run as reference tests. Their behavioral intent is ported to Worker tests; cache namespace and ScriptLock implementation assertions become immediate-read and D1 atomicity/concurrency assertions.

Intentional infrastructure changes are durable D1 rate counters instead of evictable CacheService entries, atomic entry/mapping and deletion commits, direct uncached public reads, and the explicit session verify route. Limits, scopes, messages, expiry boundaries, duplicate normalization and audit events are preserved. Expired counters are pruned on subsequent attempts. Guestbook and thing text is stored exactly as typed. Code.js prefixed text starting with = + - @ with an apostrophe so Sheets would not evaluate it, and Sheets dropped that apostrophe on read; D1 would keep it, so it is not added. Thing titles sort with the Korean collation, as Apps Script did.

Remaining verification limits: no remote migration, production import, real Turnstile call or deployment has been performed. Hash parity assumes Apps Script's UTF-8 encoding as specified; tests compare unchanged Code.js with signed-byte Utilities against both Node and workerd, including 50,000-round PBKDF2, but no real guestbook passwords were available or fetched. Malformed legacy cells outside the declared text/numeric field contract, or PBKDF2 iteration counts other than the reported production settings, should be checked before cutover. D1's real plan/storage/query quotas and production request timing remain unmeasured locally.
